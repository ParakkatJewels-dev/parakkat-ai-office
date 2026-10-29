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
import { syncAll, continueOdooSales } from './sync';
import { odooContinuationDue } from '@/lib/connectors/odoo-core.mjs';
import { upcoming, covered } from './occasions.mjs';
import { runSeo } from './seo';
import { scanLibrary } from './library';
import { branchBrief } from './branches';
import { runOpportunityReview } from './opportunities';
import { chooseDueJob, OPPORTUNITY_SCHEDULE } from './autopilot-core.mjs';
import { seoSuccessSummary } from './seo-status.mjs';
import { withAgentWork, type AgentWorkKind } from './agent-work';
import { runAutomationQueue } from '@/lib/automation/runner';
import { syncInstagramInbox } from '@/lib/connectors/instagram-inbox';

/**
 * The agents' own schedule. The every-minute tick calls runAutopilot(), which runs the one job most overdue:
 * fresh data every few hours, watchers that read sales, stock, ads and competitors through the day, and once a day
 * the CMO's planner, which opens campaigns by itself when the calendar or the numbers call for one.
 * Campaigns it opens go through the same AI team leads and human approvals as any other; nothing publishes on its own.
 */

const H = 36e5, inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const MAX_OPEN = 3; // campaigns the planner keeps going at once, so the heads are not flooded

type Job = { name: string; every: number; hours?: [number, number]; recordsOutcome?: boolean; run: (db: SupabaseClient) => Promise<string> };
const JOB_AGENTS:Record<string,{agentId:string;kind:AgentWorkKind}>={planner:{agentId:'cmo',kind:'planner'},festivals:{agentId:'festivalKeeper',kind:'festivals'},stock:{agentId:'picker',kind:'stock'},sales:{agentId:'sales',kind:'sales'},ads:{agentId:'adsAnalyst',kind:'ads'},rivals:{agentId:'scout',kind:'rivals'},budget:{agentId:'budgetGuard',kind:'budget'}};

const JOBS: Job[] = [
  { name: 'business_automation', every: 2 * 60_000, run: async db => JSON.stringify(await runAutomationQueue(db)) },
  { name: 'instagram_inbox', every: 3 * 60_000, run: async db => {
    const settings=await db.from('automation_settings').select('customer_channel').eq('id',1).maybeSingle();
    if(settings.error)throw new Error('Could not read the inbox settings.');
    if(settings.data?.customer_channel!=='instagram')return 'Instagram inbox is not enabled.';
    return JSON.stringify(await syncInstagramInbox(db));
  } },
  { name: 'opportunities', ...OPPORTUNITY_SCHEDULE, recordsOutcome: true, run: async db => (await runOpportunityReview(db, { trigger: 'scheduled' })).summary },
  { name: 'planner', every: 20 * H, hours: [9, 20], run: planner },
  { name: 'sync', every: 6 * H, run: async db => Object.entries(await syncAll(db)).map(([k, v]) => `${k}: ${v}`).join(' · ') },
  { name: 'odoo_sales', every: 2 * 60_000, run: continueOdooSales },
  { name: 'festivals', every: 20 * H, hours: [8, 21], run: festivals },
  { name: 'stock', every: 1 * H, hours: [8, 22], run: stock },
  { name: 'sales', every: 1.5 * H, hours: [8, 22], run: sales },
  { name: 'ads', every: 1.5 * H, hours: [8, 22], run: ads },
  { name: 'rivals', every: 3 * H, hours: [9, 21], run: rivals },
  { name: 'seo', every: 7 * 24 * H, hours: [6, 22], recordsOutcome: true, run: async db => seoSuccessSummary(await runSeo(db)) },
  { name: 'budget', every: 20 * H, hours: [9, 21], run: budget },
  // The library owns its manual/scheduled outcome and resumes bounded discovery and study batches under one lease.
  { name: 'library', every: 0.15 * H, recordsOutcome: true, run: scanLibrary },
];

/** Run the most overdue job, if any is due. One at a time, so a slow sync never overlaps the next tick. */
export async function runAutopilot(db: SupabaseClient, now = new Date()) {
  if (await isPaused(true)) return 'paused';
  const holder = randomUUID();
  const { data: got, error: lockError } = await db.rpc('acquire_job_lock', { p_name: 'autopilot', p_holder: holder, p_seconds: 290 });
  if (lockError) throw new Error('Could not check the agents’ schedule.');
  if (!got) return null;
  try {
    // Re-read after acquiring the lease: another tick may have finished while this one waited.
    const [{ data: rows, error: jobsError }, { data: odooSales, error: cursorError }] = await Promise.all([
      db.from('autopilot_jobs').select('name, last_run_at'),
      db.from('sync_cursors').select('state,updated_at').eq('name', 'odoo_sales').maybeSingle(),
    ]);
    if (jobsError || cursorError) throw new Error('Could not read the agents’ latest job progress.');
    const last = Object.fromEntries((rows || []).map(r => [r.name, r.last_run_at ? Date.parse(r.last_run_at) : 0]));
    const eligible = JOBS.filter(j => j.name !== 'odoo_sales' || odooContinuationDue(odooSales?.state, odooSales?.updated_at, last.odoo_sales, now.getTime()));
    const job = chooseDueJob(eligible, last, now);
    if (!job) return null;
    // These runners share outcome ownership with their manual/API entry points. A busy caller must not
    // overwrite the winning run or advance its schedule; a pause must retain the earlier due time.
    if (job.recordsOutcome) {
      await loadMemory(db);
      return { job: job.name, result: await withUsage({ feature: `autopilot:${job.name}` }, () => job.run(db)) };
    }
    let result: string;
    try {
      // Mark it first: a failed job waits for its next turn instead of retrying every minute.
      const { error } = await db.from('autopilot_jobs').upsert({ name: job.name, last_run_at: now.toISOString(), last_result: 'running' });
      if (error) throw new Error('Could not record the job start.');
      await loadMemory(db);
      result = await withUsage({ feature: `autopilot:${job.name}` }, () => withAgentWork({...JOB_AGENTS[job.name],timeoutMs:270_000},()=>job.run(db)));
    } catch (e) {
      if (e instanceof Paused) {
        // A paused job counts as not run, so it is due again after Resume.
        await db.from('autopilot_jobs').upsert({ name: job.name, last_run_at: last[job.name] ? new Date(last[job.name]).toISOString() : null, last_result: 'paused' });
        return { job: job.name, result: 'paused' };
      }
      result = `failed: ${errText(e)}`;
    }
    await db.from('autopilot_jobs').upsert({ name: job.name, last_run_at: now.toISOString(), last_result: result.slice(0, 500) });
    return { job: job.name, result };
  } finally { await db.rpc('release_job_lock', { p_name: 'autopilot', p_holder: holder }); }
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
  // best sellers in the showrooms come from Odoo, with Odoo's stock; Shopify's best sellers already read Odoo's stock where matched
  const { data: shop } = await db.rpc('odoo_top_products', { p_since: daysAgo(30), p_limit: 40 });
  const rows = [
    ...(data || []) as { title: string | null; inventory: number | null; units: number }[],
    ...((shop || []) as any[]).map(p => ({ title: p.product || p.sku, inventory: p.stock == null ? null : Math.floor(+p.stock), units: +p.units })),
  ].filter((r, i, all) => all.findIndex(x => x.title === r.title) === i);
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
  await emit(db, null, 'think', 'sales', 'Reading yesterday\'s orders from Shopify and the branches');
  const { data } = await db.from('orders_daily').select('day, revenue').gte('day', daysAgo(15)).limit(20000);
  const by = new Map<string, number>(); (data || []).forEach(r => by.set(r.day, (by.get(r.day) || 0) + Number(r.revenue)));
  const y = daysAgo(1), yRev = by.get(y) || 0, prev = [...by].filter(([d]) => d < y), avg = prev.length ? prev.reduce((s, [, v]) => s + v, 0) / prev.length : 0;
  if (!by.size) {
    const b = await branchDays(db, y);
    if (b) { await emit(db, null, b.moved.length ? 'feedback' : 'say', 'sales', b.text, 'analyticsLead'); return `branches ${b.summary}`; }
    await emit(db, null, 'say', 'sales', 'No orders synced in the last two weeks.', 'analyticsLead'); return 'no orders';
  }
  const pct = avg ? Math.round(((yRev - avg) / avg) * 100) : 0;
  await emit(db, null, Math.abs(pct) >= 30 ? 'feedback' : 'say', 'sales',
    `Online store yesterday ${inr(yRev)} in orders, ${pct >= 0 ? '+' : ''}${pct}% against the daily average of ${inr(avg)} over the two weeks before.`, 'analyticsLead');
  const b = await branchDays(db, y);
  if (b) await emit(db, null, b.moved.length ? 'feedback' : 'say', 'sales', b.text, 'analyticsLead');
  return `${inr(yRev)} (${pct}%)${b ? `; branches ${b.summary}` : ''}`;
}

/** Each branch in Odoo yesterday against its own daily average over the two weeks before; big moves are flagged. */
async function branchDays(db: SupabaseClient, y: string) {
  const { data } = await db.from('odoo_branch_daily').select('day, branch, revenue').gte('day', daysAgo(15)).lte('day', y).limit(20000);
  if (!(data || []).length) return null;
  // a branch has no row on a day it sold nothing, so the average is over the days any branch has, not that branch's own
  const by = new Map<string, { y: number; before: number }>(), days = new Set<string>();
  for (const r of data!) {
    const x = by.get(r.branch) || { y: 0, before: 0 };
    if (r.day === y) x.y += Number(r.revenue); else { x.before += Number(r.revenue); days.add(r.day); }
    by.set(r.branch, x);
  }
  const all = [...by].map(([branch, x]) => {
    const avg = days.size ? x.before / days.size : 0, p = avg ? Math.round(((x.y - avg) / avg) * 100) : 0;
    return { branch, y: x.y, avg, p };
  }).sort((a, b) => b.y - a.y);
  const total = all.reduce((t, r) => t + r.y, 0);
  const moved = all.filter(r => r.avg >= 5000 && Math.abs(r.p) >= 40);
  const text = `All branches yesterday ${inr(total)}: ${all.slice(0, 8).map(r => `${r.branch} ${inr(r.y)} (${r.p >= 0 ? '+' : ''}${r.p}%)`).join(', ')}.`
    + (moved.length ? ` Worth a look: ${moved.map(r => `${r.branch} ${r.p >= 0 ? 'up' : 'down'} ${Math.abs(r.p)}%`).join(', ')}.` : '');
  return { text, moved, summary: inr(total) };
}

/** Shared outcome monitoring owns campaign health; this watcher performs no model calls. */
async function ads(db: SupabaseClient) {
  const {error}=await db.from('campaign_sync_coverage').select('provider,account_id,status,complete,last_success_at').eq('selected',true);
  if(error)throw new Error('Campaign monitoring coverage is unavailable.');
  // The shared monitor creates one durable incident per finding. It replaces the
  // old repeated fixed-ROAS alerts and does not duplicate investigations as chats.
  const {refreshOutcomeMonitoring}=await import('@/lib/outcomes/service');
  await refreshOutcomeMonitoring(db);
  return 'Campaign evidence and follow-through refreshed in Outcomes; no automatic ad changes.';
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
  if (await canWrite()) {
    const [{ data: sold }, { data: before }, { data: adRows }, { data: posts }, { data: moves }, { data: rising }, branches] = await Promise.all([
      db.rpc('sales_by_product', { p_since: daysAgo(14), p_limit: 15 }),
      db.rpc('sales_by_product', { p_since: daysAgo(28), p_limit: 40 }),
      db.rpc('ad_rollup', { p_since: daysAgo(14), p_limit: 10 }),
      db.from('social_posts').select('caption, media_type, saves, reach').gte('posted_at', daysAgo(30)).order('saves', { ascending: false, nullsFirst: false }).limit(5),
      db.from('competitor_moves').select('kind, summary, competitors(name)').gte('seen_at', daysAgo(14)).limit(8),
      db.from('seo_keywords').select('keyword, trend_change').eq('rising', true).order('updated_at', { ascending: false }).limit(10),
      branchBrief(db, 14).catch(() => [] as string[]),
    ]);
    const prevUnits = new Map(((before || []) as any[]).map(p => [p.product_id, Number(p.units)]));
    const data = [
      `Today: ${new Date().toISOString().slice(0, 10)}`,
      `Calendar: ${cal.map(o => `${o.name} on ${o.date} (${o.left} days; ${o.why}; planning should start ${o.lead} days before)`).join('\n') || 'nothing in 75 days'}`,
      `Online store best sellers, last 14 days (units, revenue, stock, units in the 28 days):\n${((sold || []) as any[]).map(p => `${p.title} | ${p.product_type || ''} | ${p.units} | ${inr(+p.revenue)} | stock ${p.inventory ?? '?'} | ${prevUnits.get(p.product_id) ?? 0}`).join('\n') || 'none'}`,
      ...(branches.length ? [branches.join('\n')] : []),
      `Ads, last 14 days:\n${((adRows || []) as any[]).map(a => `${a.platform} ${a.campaign_name}: spend ${inr(+a.spend)}, revenue ${inr(+a.revenue)}`).join('\n') || 'none'}`,
      `Most saved posts:\n${(posts || []).map(p => `${p.media_type} saves ${p.saves ?? '?'}: ${(p.caption || '').slice(0, 70)}`).join('\n') || 'none'}`,
      `Competitor moves:\n${(moves || []).map(m => `${(m.competitors as any)?.name} ${m.kind}: ${m.summary.slice(0, 90)}`).join('\n') || 'none'}`,
      `Rising searches in Kerala: ${(rising || []).map(r => r.keyword).join(', ') || 'none'}`,
      `Campaigns already open or run in the last 45 days (do not repeat): ${existing.join('; ') || 'none'}`,
    ].join('\n\n');
    const r = await chatJSON<{ proposals?: { occasion: string; why: string }[]; note?: string }>('manager', await persona(db, 'cmo',
      `You decide which campaigns the team starts today for Parakkat Jewels. Propose at most ${Math.min(2, room)}, and only when the calendar
(an occasion whose planning window has started) or the numbers (a product or category picking up, a branch growing or slowing, stock to move, a rival's offer to answer,
a rising search) give a clear reason. Proposing none is fine. Never repeat one already open or run recently.
Shape: {"proposals": [{"occasion": "short campaign name, e.g. Dhanteras gold coins", "why": "one sentence with the date or numbers behind it"}], "note": "one line on what you looked at"}`), data,{useCase:'decision'});
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
