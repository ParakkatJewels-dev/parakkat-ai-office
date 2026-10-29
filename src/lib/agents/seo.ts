import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chatJSON } from '@/lib/llm/openai';
import { googleTrends, change } from '@/lib/connectors/trends';
import { keywordIdeas, googleAdsReady, type KeywordIdea } from '@/lib/connectors/google';
import { emit } from './events';
import { loadMemory } from './memory';
import { persona } from './people';
import { fileReport } from './review';
import { errText } from '@/lib/errors';
import { withUsage } from '@/lib/usage';
import { checkPause } from '@/lib/pause';
import { seoFailureSummary, trackSeoJob } from './seo-status.mjs';
import { withAgentWork } from './agent-work';

const BASE_SEEDS = ['gold necklace', 'temple jewellery', 'bridal jewellery', 'diamond ring', 'gold bangles', 'kerala jewellery'];
const msg = errText;

/** Search terms to study: SEO_SEED_KEYWORDS if set, else what the store sells most plus a few jewellery staples. */
async function seeds(db: SupabaseClient) {
  if (process.env.SEO_SEED_KEYWORDS) return process.env.SEO_SEED_KEYWORDS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const { data } = await db.from('products').select('product_type').not('product_type', 'is', null).limit(500);
  const counts = new Map<string, number>(); (data || []).forEach(p => { const t = String(p.product_type).trim().toLowerCase(); if (t) counts.set(t, (counts.get(t) || 0) + 1); });
  const types = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t.includes('jewel') || t.includes('gold') ? t : `gold ${t}`);
  return [...new Set([...BASE_SEEDS.slice(0, 3), ...types, ...BASE_SEEDS.slice(3)])].slice(0, 12);
}

/**
 * The SEO Desk's weekly check. The Google Trends Analyst reads what Kerala is searching more or less for,
 * the Keyword Researcher pulls volumes and bids from Keyword Planner, and the SEO Content Writer turns both into
 * product title and description fixes. Each report goes through the SEO Lead before the E-com Manager sees it.
 */
export async function runSeo(db: SupabaseClient) {
  return withUsage({ feature: 'seo' }, () => trackSeoJob({
    run: started => seoCheck(db, started),
    readPrevious: async () => {
      const { data, error } = await db.from('autopilot_jobs').select('last_run_at,last_result').eq('name', 'seo').maybeSingle();
      if (error) throw error;
      return data;
    },
    writeStarted: async job => {
      const { error } = await db.from('autopilot_jobs').upsert(job);
      if (error) throw error;
    },
    writeFinished: async (ownedStart, job) => {
      const { error } = await db.from('autopilot_jobs').update(job).eq('name', 'seo').eq('last_run_at', ownedStart);
      if (error) throw error;
    },
  }));
}
async function seoCheck(db: SupabaseClient, started: (at: string) => Promise<void>) {
  await checkPause();
  // one check at a time: a second press while one runs would race it on the same keywords
  const { count: busy, error: busyError } = await db.from('agent_runs').select('id', { count: 'exact', head: true }).eq('kind', 'seo').eq('status', 'running').gte('started_at', new Date(Date.now() - 10 * 6e4).toISOString());
  if (busyError) throw busyError;
  if (busy) throw new Error('An SEO check is already running. It finishes in a few minutes.');
  const { data: run, error } = await db.from('agent_runs').insert({ kind: 'seo', occasion: 'Weekly SEO check', stage: 'seo' }).select().single();
  if (error) throw error;
  return withUsage({ run_id: run.id }, async () => {
  try {
  await started(run.started_at);
  await loadMemory(db);
  const terms = await seeds(db), now = new Date().toISOString(), rows = new Map<string, Record<string, unknown>>();
  const row = (k: string) => { const key = k.toLowerCase(); if (!rows.has(key)) rows.set(key, { keyword: key, source: [] as string[], rising: false, updated_at: now }); return rows.get(key)!; };
  const problems: string[] = [];
    await emit(db, run.id, 'say', 'seoLead', `Weekly SEO check on ${terms.length} search terms. Trends and Keyword Planner, you are up.`);

    // Google Trends: interest over 3 months and rising related searches
    let trendLines: string[] = [];
    try {
      await emit(db, run.id, 'think', 'trendsAnalyst', `Reading Google Trends for ${terms.slice(0, 5).join(', ')}`);
      const t = await withAgentWork({agentId:'trendsAnalyst',kind:'seo_trends',timeoutMs:120_000},()=>googleTrends(terms.slice(0, 5)));
      for (const [k, pts] of Object.entries(t.series)) {
        const r = row(k), c = change(pts);
        Object.assign(r, { trend_interest: pts.at(-1)?.value ?? null, trend_change: c, trend_series: pts }); (r.source as string[]).push('google_trends');
        trendLines.push(`${k}: interest now ${pts.at(-1)?.value ?? '?'} of 100, ${c == null ? 'change unknown' : `${c >= 0 ? '+' : ''}${c}% vs the 4 weeks before`}`);
      }
      for (const [k, list] of Object.entries(t.rising)) for (const q of list) {
        const r = row(q.query); r.rising = true; if (!(r.source as string[]).includes('google_trends')) (r.source as string[]).push('google_trends');
        trendLines.push(`rising with "${k}": ${q.query} (${q.value})`);
      }
      await db.from('connections').upsert({ provider: 'google_trends', status: 'connected', account_ref: process.env.SERPAPI_KEY ? 'via SerpApi' : 'public endpoints', last_synced_at: now, last_error: null });
    } catch (e) {
      if (e instanceof Error && e.name === 'Paused') throw e;
      problems.push(`Google Trends: ${msg(e)}`); trendLines = [];
      await db.from('connections').upsert({ provider: 'google_trends', status: 'error', last_error: msg(e).slice(0, 500) });
      await emit(db, run.id, 'feedback', 'trendsAnalyst', `Could not read Google Trends: ${msg(e).slice(0, 140)}`, 'seoLead');
    }

    // Keyword Planner: monthly searches, competition and bids
    let ideas: KeywordIdea[] = [];
    const ads = await googleAdsReady();
    if (ads) {
      try {
        await emit(db, run.id, 'think', 'keywordResearcher', 'Pulling search volumes from Keyword Planner');
        ideas = (await withAgentWork({agentId:'keywordResearcher',kind:'seo_keywords',timeoutMs:120_000},()=>keywordIdeas(terms))).filter(i => i.avg_monthly_searches).sort((a, b) => (b.avg_monthly_searches || 0) - (a.avg_monthly_searches || 0)).slice(0, 150);
        for (const i of ideas) { const r = row(i.keyword); const { keyword: _k, ...rest } = i; Object.assign(r, rest); (r.source as string[]).push('keyword_planner'); }
        await db.from('connections').upsert({ provider: 'keyword_planner', status: 'connected', account_ref: ads.customer, last_synced_at: now, last_error: null });
      } catch (e) {
        if (e instanceof Error && e.name === 'Paused') throw e;
        // Explorer access (the default for a new Cloud project) cannot use Keyword Planner; that is a setting to change, not a fault
        const access = /NOT_APPROVED|PERMISSION_DENIED|access level|Basic access|USER_PERMISSION|developer token/i.test(msg(e));
        problems.push(access ? 'Keyword Planner: needs Basic access on the Google Cloud project; using Google Trends only' : `Keyword Planner: ${msg(e)}`);
        await db.from('connections').upsert({ provider: 'keyword_planner', status: access ? 'not_connected' : 'error',
          last_error: access ? 'Needs Basic access on the Google Cloud project (brand verification). Google Trends still runs.' : msg(e).slice(0, 500) });
        await emit(db, run.id, access ? 'say' : 'feedback', 'keywordResearcher', access ? 'Keyword Planner needs Basic access, so this week I worked from Google Trends only.' : `Keyword Planner failed: ${msg(e).slice(0, 140)}`, 'seoLead');
      }
    } else problems.push('Keyword Planner: Google is not connected yet');

    if (!rows.size) throw new Error(`No SEO data came back. ${problems.join(' · ')}`);
    // rows carry different columns (Trends only, Keyword Planner only); missing ones take the column default, not null
    const { error: upErr } = await db.from('seo_keywords').upsert([...rows.values()].map(r => ({ ...r, source: [...new Set(r.source as string[])] })), { defaultToNull: false });
    if (upErr) throw upErr;

    const ask = async (who: string, data: string, focus: string) => chatJSON<{ title: string; body: string }>('worker',
      await persona(db, who, `Write a short SEO report for parakkatjewels.com. Focus: ${focus}. Use only the numbers given. Shape: {"title": "one-line finding", "body": "4 to 6 bullet lines"}`), data,{useCase:'reviewed_draft'});
    const kwLines = ideas.slice(0, 40).map(i => `${i.keyword}: ${i.avg_monthly_searches?.toLocaleString('en-IN')} searches a month, competition ${i.competition || '?'}, top-of-page bid ₹${Math.round(i.bid_low || 0)} to ₹${Math.round(i.bid_high || 0)}`).join('\n');

    const jobs: Promise<unknown>[] = [];
    if (trendLines.length) jobs.push(ask('trendsAnalyst', trendLines.join('\n'), 'what Kerala is searching for more or less, and what to act on this month').then(r => fileReport(db, run.id, 'trendsAnalyst', r, trendLines.join('\n'))));
    if (kwLines) jobs.push(ask('keywordResearcher', kwLines, 'keywords with real volume and low or medium competition we should target, on the site and in Google Ads').then(r => fileReport(db, run.id, 'keywordResearcher', r, kwLines)));
    await Promise.all(jobs);

    // product titles and descriptions against the terms people actually search
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const { data: sold } = await db.rpc('sales_by_product', { p_since: since, p_limit: 10 });
    let top = ((sold || []) as { product_id: number; title: string | null; product_type: string | null }[]).filter(p => p.title).map(p => ({ id: p.product_id, title: p.title!, product_type: p.product_type }));
    if (!top.length) top = (await db.from('products').select('id, title, product_type').eq('status', 'ACTIVE').order('updated_at', { ascending: false }).limit(10)).data || [];
    if (top.length) {
      await emit(db, run.id, 'think', 'seoWriter', 'Matching product titles to what people search');
      const ctx = `Top searches:\n${kwLines || trendLines.join('\n')}\n\nBest-selling products:\n${top.map(p => `${p.id} | ${p.title} | ${p.product_type || ''}`).join('\n')}`;
      const w = await chatJSON<{ title: string; body: string }>('worker', await persona(db, 'seoWriter', `Suggest better Shopify product titles and meta descriptions using the search terms above, keeping them truthful to the product.
Then suggest 3 blog or collection-page topics. Body format: one line per product "Old title → New title | meta description (max 155 characters)", then "Topics:" with 3 lines.
Shape: {"title": "one-line summary", "body": "..."}`), ctx,{useCase:'reviewed_draft'});
      await fileReport(db, run.id, 'seoWriter', w, ctx);
    }
    await emit(db, run.id, 'walk', 'seoLead', `SEO check done. ${rows.size} search terms saved${problems.length ? `; ${problems.length} source(s) failed` : ''}.`, 'strategist');
    const { error: finishError } = await db.from('agent_runs').update({ status: 'done', stage: 'done', finished_at: new Date().toISOString(), state: { keywords: rows.size, problems } }).eq('id', run.id);
    if (finishError) throw finishError;
    return { keywords: rows.size, problems };
  } catch (e) {
    const paused = e instanceof Error && e.name === 'Paused';
    await db.from('agent_runs').update({ status: paused ? 'waiting' : 'failed', ...(paused ? { stage: 'paused' } : {}),
      error: seoFailureSummary(e), finished_at: new Date().toISOString() }).eq('id', run.id);
    throw e;
  }
  });
}

/** Lines the Campaign Strategist reads when planning: rising searches and the biggest terms. */
export async function seoBrief(db: SupabaseClient) {
  const [{ data: rising }, { data: big }] = await Promise.all([
    db.from('seo_keywords').select('keyword, trend_change, rising').or('rising.eq.true,trend_change.gt.20').order('trend_change', { ascending: false, nullsFirst: false }).limit(10),
    db.from('seo_keywords').select('keyword, avg_monthly_searches, competition').not('avg_monthly_searches', 'is', null).order('avg_monthly_searches', { ascending: false }).limit(10),
  ]);
  return [
    ...(rising || []).map(r => `rising: ${r.keyword}${r.trend_change != null ? ` (${r.trend_change > 0 ? '+' : ''}${r.trend_change}%)` : ''}`),
    ...(big || []).map(r => `${r.keyword}: ${r.avg_monthly_searches} searches a month, competition ${r.competition || '?'}`),
  ];
}
