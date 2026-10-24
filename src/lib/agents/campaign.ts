import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chatJSON } from '@/lib/llm/openai';
import { bannerImage } from '@/lib/llm/gemini';
import { classify } from '@/lib/llm/jev';
import { competitorInstagram, metaConfig } from '@/lib/connectors/meta';
import { has } from '@/lib/env';
import { emit } from './events';
import { persona } from './people';
import { fileReport } from './review';
import { seoBrief } from './seo';
import { loadMemory, pastResults } from './memory';
import type { AppRole } from '@/lib/roles';
import { errText } from '@/lib/errors';
import { withUsage } from '@/lib/usage';

/** A campaign run moves one stage per call to advance(), so each step fits in a single serverless call. */
export const STAGES = ['analyse', 'competitors', 'plan', 'create', 'review', 'approval', 'done'] as const;
type Stage = (typeof STAGES)[number];

/** What the heads read before deciding: why, for what, the data behind it, how it runs, and what it should bring in. */
export type Proposal = {
  why: string; goal: string; data_used: { source: string; finding: string }[]; how: string[]; risks: string[]; measure: string;
  impact: { budget_total: number; roas_basis: number | null; revenue_low: number | null; revenue_high: number | null; units: number | null; basis: string };
};
type Plan = {
  name: string; occasion: string; headline: string; sub: string; product_ids: number[]; budget_daily: number; days: number;
  channels: string[]; split: string; audiences: string; reasons: string[]; report?: Proposal;
};
type RunState = { origin?: { by: string; why: string }; insights?: string[]; competitors?: string[]; plan?: Plan; campaign_id?: string; creative_ids?: string[]; review?: string };
type Run = { id: string; occasion: string | null; stage: Stage; state: RunState };

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/**
 * Start a campaign run for an occasion (Diwali, wedding season, a new collection...).
 * A person starts one from the Admin page; the CMO's daily planner starts them on its own, with the reason in origin.
 */
export async function startCampaign(db: SupabaseClient, occasion: string, origin?: { by: string; why: string }) {
  const { data, error } = await db.from('agent_runs').insert({ kind: 'campaign', occasion, stage: 'analyse', state: origin ? { origin } : {} }).select().single();
  if (error) throw error;
  await emit(db, data.id, 'say', 'cmo', origin
    ? `I am opening a ${occasion} campaign: ${origin.why} Insights Lab and the War Room, you are up. The plan comes to the heads for approval before anything goes live.`
    : `New mission: plan the ${occasion} campaign. Insights Lab and the War Room, you are up.`);
  return data.id as string;
}

/** Run the current stage of a campaign and move it on. Safe to call repeatedly (cron or the office page). */
export async function advance(db: SupabaseClient, runId: string) {
  const { data: run, error } = await db.from('agent_runs').select().eq('id', runId).single<Run>();
  if (error) throw error;
  if (!STAGES.includes(run.stage) || run.stage === 'done') return run.stage;
  const state = { ...run.state };
  try {
    await loadMemory(db);
    const step = STEP[run.stage];
    await withUsage({ run_id: runId, feature: 'campaign' }, () => step(db, run, state));
    const next = STAGES[STAGES.indexOf(run.stage) + 1];
    await db.from('agent_runs').update({ stage: next, state, status: next === 'done' ? 'waiting' : 'running' }).eq('id', runId);
    return next;
  } catch (e) {
    const msg = errText(e);
    await db.from('agent_runs').update({ status: 'failed', error: msg, state }).eq('id', runId);
    await emit(db, runId, 'feedback', 'cmo', `The ${run.stage} step failed: ${msg.slice(0, 180)}`);
    throw e;
  }
}

/**
 * The proposal report. The money is worked out here from Parakkat's own last 30 days (return on ad spend and the
 * average value of an item sold), so the forecast is never a number the model made up; the Budget Forecaster explains it
 * and the Strategist writes why, for what, which data it rests on, how it runs and what could go wrong.
 */
async function proposal(db: SupabaseClient, run: Run, s: RunState, plan: Plan, picked: { title: string; price: number | null; inventory: number | null }[]): Promise<Proposal> {
  const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const { data: r } = await db.rpc('dashboard_report', { p_from: from, p_to: to, p_platform: null, p_account: null });
  const spend = Number(r?.spend || 0), adRev = Number(r?.ad_revenue || 0), rev = Number(r?.revenue || 0), units = Number(r?.units || 0);
  const roas = spend > 0 ? adRev / spend : null, perUnit = units > 0 ? rev / units : null;
  const total = Math.round(plan.budget_daily * plan.days);
  const low = roas ? Math.round(total * roas * 0.75) : null, high = roas ? Math.round(total * roas * 1.25) : null;
  const basis = roas
    ? `Our ads returned ${roas.toFixed(1)}x over the last 30 days (${inr(adRev)} from ${inr(spend)}). At ${inr(total)} that is about ${inr(low!)} to ${inr(high!)}, allowing 25% either way.${perUnit ? ` At our average of ${inr(perUnit)} per item sold, about ${Math.round(((low! + high!) / 2) / perUnit)} pieces.` : ''}`
    : 'No ad results synced for the last 30 days, so there is no return to forecast from yet. Connect Meta or Google Ads and sync.';
  const facts = [
    `Occasion: ${run.occasion}${s.origin ? ` (opened by the AI CMO: ${s.origin.why})` : ''}`,
    `Plan: ${JSON.stringify({ ...plan, report: undefined })}`,
    `Products picked: ${picked.map(p => `${p.title} ${p.price ? inr(p.price) : ''} (${p.inventory ?? '?'} in stock)`).join('; ')}`,
    `Last 30 days: Shopify ${inr(rev)} from ${units} items; ads ${inr(spend)} spent, ${inr(adRev)} back${roas ? ` (${roas.toFixed(1)}x)` : ''}`,
    `Forecast (already worked out, quote it, do not change it): ${basis}`,
    `Reports from Insights Lab:\n${(s.insights || []).join('\n\n') || 'none forwarded'}`,
    `War Room:\n${(s.competitors || []).join('\n') || 'none'}`,
  ].join('\n\n');
  const w = await chatJSON<Omit<Proposal, 'impact'>>('manager', persona('strategist', `Write the proposal report the department heads read before approving this campaign.
Every claim must come from the facts given; name the source of each (Shopify, Meta Ads, Google Ads, Instagram, War Room, SEO Desk, festival calendar).
Shape: {"why": "2 sentences: the reason to run this now", "goal": "what it is for, in one sentence with a number where possible",
"data_used": [{"source": "...", "finding": "the number or fact used"}], "how": ["4 to 6 steps: channels, audiences, creatives, timeline, budget split"],
"risks": ["2 or 3 things that could go wrong and how we would notice"], "measure": "how we will judge it after it runs"}`), facts);
  return {
    why: w.why || '', goal: w.goal || '', data_used: (w.data_used || []).slice(0, 8), how: (w.how || []).slice(0, 8), risks: (w.risks || []).slice(0, 4), measure: w.measure || '',
    impact: { budget_total: total, roas_basis: roas, revenue_low: low, revenue_high: high, units: roas && perUnit ? Math.round(((low! + high!) / 2) / perUnit) : null, basis },
  };
}

const STEP: Record<Exclude<Stage, 'done'>, (db: SupabaseClient, run: Run, s: RunState) => Promise<void>> = {
  // Insights Lab reads sales, ads and posts. Each analyst's report goes through the Analytics Lead or Social Media Manager.
  async analyse(db, run, s) {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    // summed in the database: raw order and ad rows run far past what one request returns
    const [{ data: sold }, { data: ads }, { data: posts }] = await Promise.all([
      db.rpc('sales_by_product', { p_since: since, p_limit: 15 }),
      db.rpc('ad_rollup', { p_since: since, p_limit: 15 }),
      db.from('social_posts').select('caption, media_type, reach, saves, likes, posted_at').order('posted_at', { ascending: false }).limit(30),
    ]);
    const top = ((sold || []) as { product_id: number; title: string | null; units: number; revenue: number }[]).map(a => `${a.title || a.product_id}: ${a.units} units, ${inr(Number(a.revenue))}`).join('\n');
    const adLines = ((ads || []) as { platform: string; campaign_name: string; ad_name: string; spend: number; purchases: number; revenue: number }[])
      .map(a => `${a.platform} ${a.campaign_name} / ${a.ad_name}: spend ${inr(+a.spend)}, ${+a.purchases} purchases, revenue ${inr(+a.revenue)}, ROAS ${+a.spend ? (+a.revenue / +a.spend).toFixed(1) : '-'}x`).join('\n');
    const postLines = (posts || []).map(p => `${p.posted_at?.slice(0, 10)} ${p.media_type}: reach ${p.reach ?? '?'}, saves ${p.saves ?? '?'}, likes ${p.likes ?? '?'} — ${(p.caption || '').slice(0, 80)}`).join('\n');

    const ask = (who: string, data: string, focus: string) => chatJSON<{ title: string; body: string }>('worker',
      persona(who, `Write a short report for the ${run.occasion} campaign. Focus: ${focus}. Shape: {"title": "one-line finding", "body": "3 to 5 bullet lines"}`), data);
    await emit(db, run.id, 'think', 'sales', 'Reading Shopify orders and products');
    await emit(db, run.id, 'think', 'adsAnalyst', 'Reading Meta and Google results');
    await emit(db, run.id, 'think', 'postAnalyst', 'Checking which posts led to sales');
    const [sales, adsR, postR] = await Promise.all([
      ask('sales', top || 'No orders synced yet.', 'which products and price bands sell, and what to feature'),
      ask('adsAnalyst', adLines || 'No ad results synced yet.', 'which ads and channels return the most per rupee'),
      ask('postAnalyst', postLines || 'No posts synced yet.', 'which post formats and themes get saves and clicks'),
    ]);
    const reports = await Promise.all([fileReport(db, run.id, 'sales', sales, top), fileReport(db, run.id, 'adsAnalyst', adsR, adLines), fileReport(db, run.id, 'postAnalyst', postR, postLines)]);
    s.insights = reports.filter(r => r.status === 'with_head').map(r => `${r.title}\n${r.body}`);
  },

  // The War Room reads competitors' Instagram, scores how much each move matters, and reports through the War Room Lead.
  async competitors(db, run, s) {
    const { data: rivals } = await db.from('competitors').select('id, name, instagram_handle').not('instagram_handle', 'is', null).limit(8);
    if (!rivals?.length || !(await metaConfig())?.ig) { s.competitors = []; await emit(db, run.id, 'say', 'warLead', 'No competitors to scan yet. Add them on the Competitors page.', 'intelLead'); return; }
    await emit(db, run.id, 'think', 'igScout', `Reading ${rivals.length} competitors' latest posts`);
    const lines: string[] = [];
    for (const c of rivals) {
      try {
        const ig = await competitorInstagram(c.instagram_handle!);
        const recent = (ig.media?.data || []).map((m: any) => `${m.timestamp?.slice(0, 10)} ${m.media_type} likes ${m.like_count}: ${(m.caption || '').slice(0, 140)}`).join('\n');
        const move = await chatJSON<{ kind: string; summary: string }>('worker', persona('igScout', 'Name the single most important move in these posts. kind is one of offer, creative, product, price, channel. Shape: {"kind": "...", "summary": "one sentence"}'), `${c.name} (@${c.instagram_handle}), ${ig.followers_count} followers:\n${recent}`);
        const score = await withUsage({ agent: 'igScout' }, () => classify(`${c.name}: ${move.summary}`, { impact: { instructions: 'How much should Parakkat Jewels react to this competitor move this week?', criteria: { high: 'directly targets our customers or festival', medium: 'worth watching', low: 'no action needed' } } }));
        await db.from('competitor_moves').insert({ competitor_id: c.id, kind: move.kind, summary: move.summary, score: score.impact.confidence, raw: { impact: score.impact.choice } });
        lines.push(`${c.name} [${score.impact.choice}]: ${move.summary}`);
      } catch (e) { lines.push(`${c.name}: could not read (${e instanceof Error ? e.message.slice(0, 80) : 'error'})`); }
    }
    const r = await fileReport(db, run.id, 'igScout', { title: `Competitor moves before ${run.occasion}`, body: lines.join('\n') }, lines.join('\n'));
    s.competitors = r.status === 'with_head' ? lines : [];
    await emit(db, run.id, 'walk', 'warLead', 'Competitor brief for Strategy', 'strategist');
  },

  // Strategy turns the forwarded reports into one plan, picking only in-stock products.
  async plan(db, run, s) {
    const [{ data: stock }, search, past] = await Promise.all([
      db.from('products').select('id, title, product_type, price, inventory, image_url').eq('status', 'ACTIVE').gt('inventory', 0).limit(200),
      seoBrief(db).catch(() => [] as string[]),
      pastResults(db).catch(() => [] as string[]),
    ]);
    await emit(db, run.id, 'think', 'strategist', `Drafting the ${run.occasion} plan`);
    const plan = await chatJSON<Plan>('manager', persona('strategist', `Plan one campaign. Use only product ids from the in-stock list. Keep the daily budget realistic for a regional jewellery brand unless the data says otherwise.
Shape: {"name": "...", "occasion": "...", "headline": "max 5 words", "sub": "max 8 words", "product_ids": [ids], "budget_daily": rupees, "days": n, "channels": ["meta","google"], "split": "one line", "audiences": "one line", "reasons": ["3 short reasons tied to the data"]}`),
      `Occasion: ${run.occasion}\n\nInsights:\n${(s.insights || []).join('\n\n') || 'none forwarded'}\n\nCompetitors:\n${(s.competitors || []).join('\n') || 'none'}\n\nPast campaigns and what the heads said (learn from these):\n${past.join('\n') || 'none yet'}\n\nWhat people search (SEO Desk):\n${search.join('\n') || 'no SEO data yet'}\n\nIn stock:\n${(stock || []).map(p => `${p.id} | ${p.title} | ${p.product_type} | ${inr(p.price)} | ${p.inventory} left`).join('\n')}`);
    const ok = new Set((stock || []).map(p => p.id));
    plan.product_ids = (plan.product_ids || []).filter(id => ok.has(id)).slice(0, 6);
    if (!plan.product_ids.length) throw new Error('The plan picked no in-stock products. Sync Shopify first.');
    s.plan = plan;
    await emit(db, run.id, 'think', 'budgetForecaster', 'Working out what this plan should bring in, from our own last 30 days');
    plan.report = await proposal(db, run, s, plan, (stock || []).filter(p => plan.product_ids.includes(p.id)));
    await emit(db, run.id, 'walk', 'strategist', `Brief: ${plan.name}. ${plan.split}`, 'creativeDirector');
  },

  // Creative House: copy in English and Malayalam, banners from the real product photos, a Creative Director check.
  async create(db, run, s) {
    const p = s.plan!;
    const { data: prods } = await db.from('products').select('id, title, price, image_url').in('id', p.product_ids);
    const { data: camp, error } = await db.from('campaigns').insert({ run_id: run.id, name: p.name, occasion: p.occasion, plan: p, budget_daily: p.budget_daily, channels: p.channels,
      start_date: new Date().toISOString().slice(0, 10), end_date: new Date(Date.now() + p.days * 864e5).toISOString().slice(0, 10) }).select().single();
    if (error) throw error;
    s.campaign_id = camp.id;
    await emit(db, run.id, 'think', 'copywriter', 'Writing headlines and captions');
    const copy = await chatJSON<{ en: { headline: string; body: string }; ml: { headline: string; body: string } }>('worker', persona('copywriter', 'Write ad copy. Malayalam must be natural Kerala Malayalam. Mention prices only if given. Shape: {"en": {"headline": "...", "body": "..."}, "ml": {"headline": "...", "body": "..."}}'),
      `${p.name} for ${p.occasion}. Headline idea: ${p.headline}. Products: ${(prods || []).map(x => `${x.title} ${inr(x.price)}`).join(', ')}`);
    await emit(db, run.id, 'say', 'malayalam', `Malayalam headline: ${copy.ml.headline}`, 'creativeDirector');
    const photos = (prods || []).map(x => x.image_url).filter(Boolean) as string[];
    s.creative_ids = [];
    if (photos.length && has('GEMINI_API_KEY')) {
      await emit(db, run.id, 'think', 'designer', 'Generating banners from the Shopify photos');
      const img = await withUsage({ agent: 'designer' }, () => bannerImage(`Luxury ${p.occasion} jewellery banner for Parakkat Jewels, 1080x1080. Elegant black and warm champagne palette, soft studio light, festive Kerala touches. Space for the headline "${p.headline}".`, photos));
      const path = `${camp.id}/banner-1.${img.mimeType.split('/')[1] || 'png'}`;
      const up = await db.storage.from('creatives').upload(path, img.data, { contentType: img.mimeType, upsert: true });
      if (up.error) throw up.error;
      const { data: cr } = await db.from('creatives').insert({ campaign_id: camp.id, kind: 'banner', language: 'en', headline: copy.en.headline, body: copy.en.body, image_path: path, product_ids: p.product_ids }).select().single();
      s.creative_ids.push(cr!.id);
    } else {
      await emit(db, run.id, 'feedback', 'designer', 'No product photos or Gemini key, so this plan has copy only.', 'creativeDirector');
    }
    const { data: ml } = await db.from('creatives').insert({ campaign_id: camp.id, kind: 'banner', language: 'ml', headline: copy.ml.headline, body: copy.ml.body, product_ids: p.product_ids }).select().single();
    s.creative_ids.push(ml!.id);
    await emit(db, run.id, 'walk', 'designer', 'Banner set is ready.', 'creativeDirector');
  },

  // Quality and Compliance, Budget Guard and the AI CMO check everything before any human sees it.
  async review(db, run, s) {
    const p = s.plan!;
    const { data: crs } = await db.from('creatives').select('id, headline, body').eq('campaign_id', s.campaign_id!);
    const text = (crs || []).map(c => `${c.headline}\n${c.body}`).join('\n---\n');
    await emit(db, run.id, 'think', 'compliance', 'Checking hallmark, purity and price claims');
    const q = await withUsage({ agent: 'compliance' }, () => classify(text, {
      claims: { instructions: 'Do these jewellery ads make any unverifiable claim (purity, hallmark, discount, "lowest price")?', criteria: { clean: 'no risky claims', risky: 'at least one claim needs proof or rewording' } },
      policy: { instructions: 'Would Meta or Google ad policy likely reject this copy?', criteria: { ok: 'likely approved', reject: 'likely rejected' } },
    }));
    const flags = [q.claims.choice === 'risky' && 'a claim needs proof or rewording', q.policy.choice === 'reject' && 'ad policy risk'].filter(Boolean);
    await emit(db, run.id, flags.length ? 'feedback' : 'say', 'compliance', flags.length ? `Flagged: ${flags.join(', ')}` : 'Compliance checks pass.', 'creativeDirector');
    await emit(db, run.id, 'say', 'budgetGuard', `Daily cap ${inr(p.budget_daily)} for ${p.days} days, total ${inr(p.budget_daily * p.days)}.`, 'perfLead');
    await emit(db, run.id, 'think', 'cmo', 'Reviewing the plan against goals and budget');
    const cmo = await chatJSON<{ ok: boolean; note: string }>('manager', persona('cmo', 'Final AI check before the human heads. Shape: {"ok": true|false, "note": "one sentence for the heads"}'),
      `Plan: ${JSON.stringify(p)}\nCompliance flags: ${flags.join(', ') || 'none'}\nCopy:\n${text}`);
    s.review = `${cmo.note}${flags.length ? ` Compliance flagged: ${flags.join(', ')}.` : ''}`;
  },

  // Send the plan to the heads it touches; the Super Admin signs last (decide_approval in the database).
  async approval(db, run, s) {
    const p = s.plan!;
    const roles: AppRole[] = ['creative_head', 'ecom_manager'];
    if (p.budget_daily > 0) roles.push('perf_marketer');
    await db.from('approvals').insert({ campaign_id: s.campaign_id, required_roles: roles });
    await db.from('campaigns').update({ status: 'in_approval', plan: { ...p, ai_review: s.review } }).eq('id', s.campaign_id!);
    await emit(db, run.id, 'approval', 'cmo', `${p.name} is ready for the department heads. ${s.review || ''}`, 'creativeHead');
  },
};
