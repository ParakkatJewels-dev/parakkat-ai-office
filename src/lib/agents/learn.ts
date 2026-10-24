import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

type Lesson = { department_id: string; lesson: string; decision: string; source_id?: string | null };
const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const inr = (n: number) => n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`;
const roas = (rev: number, spend: number) => spend ? rev / spend : 0;

/**
 * The memory teaching itself from Parakkat's own numbers, after every data sync. Nobody has to type these in:
 * - results: how each published campaign did on Meta, kept up to date, for Strategy and Performance;
 * - analytics: this month's best sellers, best and worst ads, post formats that get saved, and rising searches,
 *   replaced each time so agents never act on an old month.
 * Heads' decisions and the AI team leads' rejections are learned in the database as they happen (see the lessons triggers).
 */
export async function learnFromData(db: SupabaseClient) {
  const since = day(30);
  const [{ data: camps }, { data: sold }, { data: ads }, { data: posts }, { data: rising }] = await Promise.all([
    db.from('campaigns').select('id, name, occasion, budget_daily, external_ids').not('external_ids', 'is', null).order('created_at', { ascending: false }).limit(50),
    db.rpc('sales_by_product', { p_since: since, p_limit: 5 }),
    db.rpc('ad_rollup', { p_since: since, p_limit: 60 }),
    db.from('social_posts').select('media_type, saves, reach').order('posted_at', { ascending: false, nullsFirst: false }).limit(60),
    db.from('seo_keywords').select('keyword, trend_change').or('rising.eq.true,trend_change.gt.25').order('trend_change', { ascending: false, nullsFirst: false }).limit(5),
  ]);

  // ---- results: one lesson per published campaign, rewritten as its numbers grow ----
  const metaIds = (camps || []).map(c => c.external_ids?.meta?.campaign_id).filter(Boolean).map(String);
  const { data: res } = metaIds.length ? await db.rpc('campaign_results', { p_ids: metaIds }) : { data: [] };
  const byId = new Map(((res || []) as { campaign_id: string; spend: number; revenue: number; purchases: number }[]).map(r => [r.campaign_id, r]));
  const results: Lesson[] = [];
  for (const c of camps || []) {
    const r = byId.get(String(c.external_ids?.meta?.campaign_id || '')); if (!r || !Number(r.spend)) continue;
    const x = roas(Number(r.revenue), Number(r.spend));
    const verdict = x >= 3 ? 'Worth repeating.' : x >= 1.5 ? 'Paid back; improve before repeating.' : 'Lost money; do not repeat this approach unchanged.';
    const lesson = `"${c.name}" (${c.occasion || 'campaign'}) returned ${x.toFixed(1)}x on Meta: ${inr(Number(r.spend))} spent, ${Number(r.purchases)} purchases, ${inr(Number(r.revenue))} revenue. ${verdict}`;
    for (const d of ['strategy', 'perf']) results.push({ department_id: d, lesson, decision: x >= 1.5 ? 'worked' : 'failed', source_id: c.id });
  }
  for (const l of results) {
    const { data: had } = await db.from('lessons').select('id').eq('source', 'results').eq('source_id', l.source_id!).eq('department_id', l.department_id).limit(1);
    if (had?.length) await db.from('lessons').update({ lesson: l.lesson, decision: l.decision, active: true, created_at: new Date().toISOString() }).eq('id', had[0].id);
    else await db.from('lessons').insert({ ...l, source: 'results' });
  }

  // ---- analytics: this month's picture, replacing last time's ----
  const fresh: Lesson[] = [];
  const top = ((sold || []) as { title: string | null; units: number; revenue: number }[]).filter(p => p.title);
  if (top.length) {
    const lesson = `Best sellers in the last 30 days: ${top.slice(0, 3).map(p => `${p.title} (${inr(Number(p.revenue))}, ${p.units} sold)`).join('; ')}. Feature these first.`;
    for (const d of ['insights', 'strategy', 'creative']) fresh.push({ department_id: d, lesson, decision: 'data' });
  }
  const rated = ((ads || []) as { platform: string; campaign_name: string; ad_name: string; spend: number; revenue: number }[])
    .map(a => ({ ...a, x: roas(Number(a.revenue), Number(a.spend)) })).filter(a => Number(a.spend) >= 2000);
  if (rated.length >= 2) {
    const best = [...rated].sort((a, b) => b.x - a.x)[0], worst = [...rated].sort((a, b) => a.x - b.x)[0];
    fresh.push({ department_id: 'perf', decision: 'data', lesson: `Best ad this month: ${best.platform} "${best.ad_name || best.campaign_name}" at ${best.x.toFixed(1)}x. Weakest: "${worst.ad_name || worst.campaign_name}" at ${worst.x.toFixed(1)}x on ${inr(Number(worst.spend))}. Move budget towards the first.` });
    fresh.push({ department_id: 'creative', decision: 'data', lesson: `The ad creative that earned most per rupee this month was "${best.ad_name || best.campaign_name}" (${best.x.toFixed(1)}x). Learn from its style.` });
  }
  const fmt = new Map<string, { saves: number; n: number }>();
  (posts || []).forEach(p => { if (p.saves == null) return; const k = (p.media_type || 'post').toLowerCase().replace('_album', '').replace('_', ' '); const f = fmt.get(k) || { saves: 0, n: 0 }; f.saves += Number(p.saves); f.n++; fmt.set(k, f); });
  const fmts = [...fmt].filter(([, f]) => f.n >= 3).map(([k, f]) => [k, f.saves / f.n] as const).sort((a, b) => b[1] - a[1]);
  if (fmts.length >= 2) fresh.push({ department_id: 'social', decision: 'data', lesson: `On Instagram, ${fmts[0][0]} posts get the most saves (${Math.round(fmts[0][1])} on average) against ${Math.round(fmts.at(-1)![1])} for ${fmts.at(-1)![0]}. Lean on ${fmts[0][0]}.` });
  if (rising?.length) fresh.push({ department_id: 'strategy', decision: 'data', lesson: `Searches rising in Kerala: ${rising.map(r => r.keyword + (r.trend_change != null ? ` (${r.trend_change > 0 ? '+' : ''}${r.trend_change}%)` : '')).join(', ')}. Plan around them.` });

  if (fresh.length) {
    await db.from('lessons').update({ active: false }).eq('source', 'analytics').eq('active', true);
    await db.from('lessons').insert(fresh.map(l => ({ ...l, source: 'analytics' })));
  }
  return { results: results.length, analytics: fresh.length };
}
