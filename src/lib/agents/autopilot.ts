import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canWrite, chatJSON } from '@/lib/llm/openai';
import { isPaused, Paused } from '@/lib/pause';
import { errText } from '@/lib/errors';
import { withUsage } from '@/lib/usage';
import { emit } from './events';
import { persona } from './people';
import { loadMemory } from './memory';
import { startCampaign } from './campaign';
import { syncAll } from './sync';
import { upcoming, covered } from './occasions.mjs';
import { runSeo } from './seo';

/**
 * The agents' own schedule. The every-minute tick calls runAutopilot(), which runs the one job most overdue:
 * fresh data every few hours, watchers that read sales, stock, ads and competitors through the day, and once a day
 * the CMO's planner, which opens campaigns by itself when the calendar or the numbers call for one.
 * Campaigns it opens go through the same AI team leads and human approvals as any other; nothing publishes on its own.
 */

const H = 36e5, inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
/** Hour of the day in India, where the team works. */
const istHour = (d = new Date()) => (d.getUTCHours() + d.getUTCMinutes() / 60 + 5.5) % 24;
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const MAX_OPEN = 3; // campaigns the planner keeps going at once, so the heads are not flooded

type Job = { name: string; every: number; hours?: [number, number]; run: (db: SupabaseClient) => Promise<string> };

const JOBS: Job[] = [
  { name: 'planner', every: 20 * H, hours: [9, 20], run: planner },
  { name: 'sync', every: 6 * H, run: async db => Object.entries(await syncAll(db)).map(([k, v]) => `${k}: ${v}`).join(' · ') },
  { name: 'festivals', every: 20 * H, hours: [8, 21], run: festivals },
  { name: 'stock', every: 1 * H, hours: [8, 22], run: stock },
  { name: 'sales', every: 1.5 * H, hours: [8, 22], run: sales },
  { name: 'ads', every: 1.5 * H, hours: [8, 22], run: ads },
  { name: 'rivals', every: 3 * H, hours: [9, 21], run: rivals },
  { name: 'seo', every: 7 * 24 * H, hours: [6, 22], run: async db => { const r = await runSeo(db); return `${r.keywords} search terms${r.problems.length ? `; ${r.problems.join('; ')}` : ''}`; } },
  { name: 'budget', every: 20 * H, hours: [9, 21], run: budget },
];

/** Run the most overdue job, if any is due. One at a time, so a slow sync never overlaps the next tick. */
export async function runAutopilot(db: SupabaseClient, now = new Date()) {
  if (await isPaused(true)) return 'paused';
  const { data: rows } = await db.from('autopilot_jobs').select('name, last_run_at');
  const last = Object.fromEntries((rows || []).map(r => [r.name, r.last_run_at ? Date.parse(r.last_run_at) : 0]));
  const h = istHour(now);
  const due = JOBS.filter(j => (!j.hours || (h >= j.hours[0] && h < j.hours[1])) && now.getTime() - (last[j.name] || 0) >= j.every)
    .sort((a, b) => (now.getTime() - (last[b.name] || 0)) / b.every - (now.getTime() - (last[a.name] || 0)) / a.every);
  const job = due[0];
  if (!job) return null;

  const holder = randomUUID();
  const { data: got } = await db.rpc('acquire_job_lock', { p_name: 'autopilot', p_holder: holder, p_seconds: 290 });
  if (!got) return null;
  let result: string;
  try {
    // mark it first: a job that fails waits for its next turn instead of retrying every minute
    await db.from('autopilot_jobs').upsert({ name: job.name, last_run_at: now.toISOString(), last_result: 'running' });
    await loadMemory(db);
    result = await withUsage({ feature: `autopilot:${job.name}` }, () => job.run(db));
  } catch (e) {
    if (e instanceof Paused) {
      // stopped by the pause switch: the job counts as not run, so it is due again after Resume
      await db.from('autopilot_jobs').upsert({ name: job.name, last_run_at: last[job.name] ? new Date(last[job.name]).toISOString() : null, last_result: 'paused' });
      return { job: job.name, result: 'paused' };
    }
    result = `failed: ${errText(e)}`;
  }
  finally { await db.rpc('release_job_lock', { p_name: 'autopilot', p_holder: holder }); }
  await db.from('autopilot_jobs').upsert({ name: job.name, last_run_at: now.toISOString(), last_result: result.slice(0, 500) });
  return { job: job.name, result };
}

/** Festival Calendar Keeper: what is coming and how long the team has. */
async function festivals(db: SupabaseClient) {
  const next = upcoming(new Date(), 75);
  if (!next.length) { await emit(db, null, 'say', 'festivalKeeper', 'No festivals in the next 75 days. Good time for evergreen and daily-wear campaigns.', 'cmo'); return 'none ahead'; }
  const line = next.slice(0, 4).map(o => `${o.name} in ${o.left} day${o.left === 1 ? '' : 's'}${o.due ? ' (plan now)' : ''}`).join(', ');
  await emit(db, null, 'say', 'festivalKeeper', `Coming up: ${line}.`, 'cmo');
  return line;
}

/** Product Picker: best sellers that are running out, so plans do not push what cannot ship. */
async function stock(db: SupabaseClient) {
  await emit(db, null, 'think', 'picker', 'Checking stock on this month\'s best sellers');
  const { data } = await db.rpc('sales_by_product', { p_since: daysAgo(30), p_limit: 40 });
  const rows = (data || []) as { title: string | null; inventory: number | null; units: number }[];
  if (!rows.length) { await emit(db, null, 'say', 'picker', 'No sales synced yet, so no stock to check.', 'strategist'); return 'no sales'; }
  // jewellery is often one of a kind, so a single piece left is normal; flag sold-out best sellers and last pieces of repeat sellers
  const out = rows.filter(r => r.inventory != null && r.inventory <= 0), last = rows.filter(r => r.inventory === 1 && Number(r.units) >= 3);
  const low = [...out, ...last];
  if (low.length) await emit(db, null, 'feedback', 'picker', [out.length && `Sold out: ${out.slice(0, 4).map(r => `${r.title} (${r.units} sold this month)`).join('; ')}`,
    last.length && `Last piece of a repeat seller: ${last.slice(0, 3).map(r => `${r.title} (${r.units} sold)`).join('; ')}`].filter(Boolean).join('. ') + '. I will keep these out of new plans until restocked.', 'ecomManager');
  else await emit(db, null, 'say', 'picker', `Stock is fine on all ${rows.length} best sellers.`, 'strategist');
  return `${out.length} sold out, ${last.length} last pieces, of ${rows.length}`;
}

/** Sales Analyst: yesterday against the two weeks before. */
async function sales(db: SupabaseClient) {
  await emit(db, null, 'think', 'sales', 'Reading yesterday\'s Shopify orders');
  const { data } = await db.from('orders_daily').select('day, revenue').gte('day', daysAgo(15)).limit(20000);
  const by = new Map<string, number>(); (data || []).forEach(r => by.set(r.day, (by.get(r.day) || 0) + Number(r.revenue)));
  const y = daysAgo(1), yRev = by.get(y) || 0, prev = [...by].filter(([d]) => d < y), avg = prev.length ? prev.reduce((s, [, v]) => s + v, 0) / prev.length : 0;
  if (!by.size) { await emit(db, null, 'say', 'sales', 'No orders synced in the last two weeks.', 'analyticsLead'); return 'no orders'; }
  const pct = avg ? Math.round(((yRev - avg) / avg) * 100) : 0;
  await emit(db, null, Math.abs(pct) >= 30 ? 'feedback' : 'say', 'sales',
    `Yesterday ${inr(yRev)} in orders, ${pct >= 0 ? '+' : ''}${pct}% against the daily average of ${inr(avg)} over the two weeks before.`, 'analyticsLead');
  return `${inr(yRev)} (${pct}%)`;
}

/** Ads Analyst and Budget Guard: ads that spend without returning. */
async function ads(db: SupabaseClient) {
  await emit(db, null, 'think', 'adsAnalyst', 'Reading the last 7 days of Meta and Google results');
  const { data } = await db.rpc('ad_rollup', { p_since: daysAgo(7), p_limit: 50 });
  const rows = (data || []) as { platform: string; campaign_name: string; ad_name: string; spend: number; revenue: number }[];
  if (!rows.length) { await emit(db, null, 'say', 'adsAnalyst', 'No ad results in the last 7 days. Connect Meta or Google Ads, or nothing is running.', 'perfLead'); return 'no ads'; }
  const spend = rows.reduce((s, r) => s + Number(r.spend), 0), rev = rows.reduce((s, r) => s + Number(r.revenue), 0);
  const weak = rows.filter(r => Number(r.spend) >= 1000 && Number(r.revenue) / Number(r.spend) < 1).slice(0, 3);
  await emit(db, null, 'say', 'adsAnalyst', `Last 7 days: ${inr(spend)} spent, ${inr(rev)} back (${spend ? (rev / spend).toFixed(1) : '-'}x).`, 'perfLead');
  if (weak.length) await emit(db, null, 'feedback', 'budgetGuard', `Spending without return: ${weak.map(r => `${r.platform} ${r.campaign_name} / ${r.ad_name}: ${inr(+r.spend)} for ${inr(+r.revenue)}`).join('; ')}. Worth pausing or changing the creative.`, 'perfMarketer');
  return `${inr(spend)} → ${inr(rev)}, ${weak.length} weak`;
}

/** Competitor Scout: what rivals did this week, from the War Room's log. */
async function rivals(db: SupabaseClient) {
  await emit(db, null, 'think', 'scout', 'Going through competitor moves from this week');
  const { data } = await db.from('competitor_moves').select('kind, summary, competitors(name)').gte('seen_at', daysAgo(7)).order('seen_at', { ascending: false }).limit(5);
  if (!(data || []).length) { await emit(db, null, 'say', 'scout', 'No new competitor moves this week. Add competitors on the Admin page so the War Room can watch them.', 'intelLead'); return 'none'; }
  await emit(db, null, 'say', 'scout', `This week: ${data!.map(m => `${(m.competitors as any)?.name} ${m.kind}: ${m.summary.slice(0, 80)}`).join('; ')}.`, 'intelLead');
  return `${data!.length} moves`;
}

/**
 * The CMO's daily planner. Reads the calendar, sales, stock, ads, posts, rivals and searches, then opens up to two
 * campaigns that something in the data or the calendar calls for. Without an OpenAI key it opens one for any festival
 * whose planning window has started.
 */
async function planner(db: SupabaseClient) {
  await emit(db, null, 'think', 'cmo', 'Morning planning: reading the calendar, sales, ads, posts, rivals and searches');
  const [{ data: open }, { data: recent }] = await Promise.all([
    db.from('agent_runs').select('occasion').eq('kind', 'campaign').in('status', ['running', 'waiting']),
    db.from('agent_runs').select('occasion').eq('kind', 'campaign').gte('started_at', new Date(Date.now() - 45 * 864e5).toISOString()),
  ]);
  const existing = [...(open || []), ...(recent || [])].map(r => r.occasion || '').filter(Boolean);
  const room = MAX_OPEN - (open || []).length;
  if (room <= 0) { await emit(db, null, 'say', 'cmo', `${(open || []).length} campaigns are already with the team or the heads. I will open more once those are decided.`); return 'full'; }

  const cal = upcoming(new Date(), 75);
  let picks: { occasion: string; why: string }[] = [];
  if (canWrite()) {
    const [{ data: sold }, { data: before }, { data: adRows }, { data: posts }, { data: moves }, { data: rising }] = await Promise.all([
      db.rpc('sales_by_product', { p_since: daysAgo(14), p_limit: 15 }),
      db.rpc('sales_by_product', { p_since: daysAgo(28), p_limit: 40 }),
      db.rpc('ad_rollup', { p_since: daysAgo(14), p_limit: 10 }),
      db.from('social_posts').select('caption, media_type, saves, reach').gte('posted_at', daysAgo(30)).order('saves', { ascending: false, nullsFirst: false }).limit(5),
      db.from('competitor_moves').select('kind, summary, competitors(name)').gte('seen_at', daysAgo(14)).limit(8),
      db.from('seo_keywords').select('keyword, trend_change').eq('rising', true).order('updated_at', { ascending: false }).limit(10),
    ]);
    const prevUnits = new Map(((before || []) as any[]).map(p => [p.product_id, Number(p.units)]));
    const data = [
      `Today: ${new Date().toISOString().slice(0, 10)}`,
      `Calendar: ${cal.map(o => `${o.name} on ${o.date} (${o.left} days; ${o.why}; planning should start ${o.lead} days before)`).join('\n') || 'nothing in 75 days'}`,
      `Best sellers, last 14 days (units, revenue, stock, units in the 28 days):\n${((sold || []) as any[]).map(p => `${p.title} | ${p.product_type || ''} | ${p.units} | ${inr(+p.revenue)} | stock ${p.inventory ?? '?'} | ${prevUnits.get(p.product_id) ?? 0}`).join('\n') || 'none'}`,
      `Ads, last 14 days:\n${((adRows || []) as any[]).map(a => `${a.platform} ${a.campaign_name}: spend ${inr(+a.spend)}, revenue ${inr(+a.revenue)}`).join('\n') || 'none'}`,
      `Most saved posts:\n${(posts || []).map(p => `${p.media_type} saves ${p.saves ?? '?'}: ${(p.caption || '').slice(0, 70)}`).join('\n') || 'none'}`,
      `Competitor moves:\n${(moves || []).map(m => `${(m.competitors as any)?.name} ${m.kind}: ${m.summary.slice(0, 90)}`).join('\n') || 'none'}`,
      `Rising searches in Kerala: ${(rising || []).map(r => r.keyword).join(', ') || 'none'}`,
      `Campaigns already open or run in the last 45 days (do not repeat): ${existing.join('; ') || 'none'}`,
    ].join('\n\n');
    const r = await chatJSON<{ proposals?: { occasion: string; why: string }[]; note?: string }>('manager', persona('cmo',
      `You decide which campaigns the team starts today for Parakkat Jewels. Propose at most ${Math.min(2, room)}, and only when the calendar
(an occasion whose planning window has started) or the numbers (a product or category picking up, stock to move, a rival's offer to answer,
a rising search) give a clear reason. Proposing none is fine. Never repeat one already open or run recently.
Shape: {"proposals": [{"occasion": "short campaign name, e.g. Dhanteras gold coins", "why": "one sentence with the date or numbers behind it"}], "note": "one line on what you looked at"}`), data);
    picks = (r.proposals || []).filter(p => p?.occasion && p?.why);
    if (r.note) await emit(db, null, 'say', 'cmo', r.note.slice(0, 300));
  } else {
    picks = cal.filter(o => o.due).map(o => ({ occasion: o.name, why: `${o.name} is ${o.left} days away (${o.why}).` }));
  }

  const opened: string[] = [];
  for (const p of picks) {
    if (opened.length >= Math.min(2, room)) break;
    if (covered(p.occasion, [...existing, ...opened])) continue;
    await startCampaign(db, p.occasion.slice(0, 120), { by: 'cmo', why: p.why.slice(0, 300) });
    opened.push(p.occasion);
  }
  if (!opened.length) await emit(db, null, 'say', 'cmo', 'Nothing new to open today. The open campaigns and the calendar are covered.');
  return opened.length ? `opened: ${opened.join(', ')}` : 'nothing new';
}

/** Budget Guard: the month's AI and API spend plus plans against the budget set on the Usage page. Warns once a month. */
async function budget(db: SupabaseClient) {
  const { data: b } = await db.from('billing_settings').select('usd_inr, monthly_budget_inr, alert_pct, alerted_month').eq('id', 1).maybeSingle();
  if (!b?.monthly_budget_inr) return 'no budget set';
  const now = new Date(), month = now.toISOString().slice(0, 7), dim = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate(), dom = now.getUTCDate();
  const [{ data: u }, { data: f }] = await Promise.all([
    db.rpc('usage_report', { p_from: `${month}-01`, p_to: now.toISOString().slice(0, 10) }),
    db.from('fixed_costs').select('monthly_usd').eq('active', true),
  ]);
  const fixed = (f || []).reduce((s, x) => s + Number(x.monthly_usd), 0), fx = Number(b.usd_inr), usage = Number(u?.cost_usd || 0);
  const spent = (usage + fixed * dom / dim) * fx, projected = ((usage / dom) * dim + fixed) * fx, cap = Number(b.monthly_budget_inr);
  const line = `${inr(spent)} spent this month of ${inr(cap)}, heading for ${inr(projected)}`;
  if ((spent >= cap * b.alert_pct / 100 || projected > cap) && b.alerted_month !== month) {
    await emit(db, null, 'feedback', 'budgetGuard', `Running costs: ${line}. See Usage and billing.`, 'superAdmin');
    await db.from('billing_settings').update({ alerted_month: month }).eq('id', 1);
    return `alerted: ${line}`;
  }
  return line;
}
