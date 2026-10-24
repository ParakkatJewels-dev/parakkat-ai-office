import 'server-only';
import { opt } from '@/lib/env';

export type Point = { date: string; value: number };
export type TrendResult = { series: Record<string, Point[]>; rising: Record<string, { query: string; value: string }[]> };

/**
 * Search interest over the last 3 months for up to 5 terms, plus rising related searches for each.
 * With SERPAPI_KEY set it goes through SerpApi (reliable from servers); without it, through Google Trends' own
 * public endpoints, which work but can rate-limit cloud servers. Google's official Trends API is still a closed alpha.
 * Region defaults to Kerala (SEO_TRENDS_GEO=IN-KL).
 */
export async function googleTrends(terms: string[]): Promise<TrendResult> {
  const kw = terms.slice(0, 5), geo = opt('SEO_TRENDS_GEO', 'IN-KL');
  return process.env.SERPAPI_KEY ? viaSerpApi(kw, geo, process.env.SERPAPI_KEY) : viaGoogle(kw, geo);
}

async function viaSerpApi(kw: string[], geo: string, key: string): Promise<TrendResult> {
  const call = async (p: Record<string, string>) => {
    const r = await fetch(`https://serpapi.com/search.json?${new URLSearchParams({ engine: 'google_trends', geo, date: 'today 3-m', api_key: key, ...p })}`);
    const d = await r.json(); if (!r.ok || d.error) throw new Error(`SerpApi ${r.status}: ${d.error || 'error'}`);
    return d;
  };
  const ts = await call({ q: kw.join(','), data_type: 'TIMESERIES' });
  const series: TrendResult['series'] = Object.fromEntries(kw.map(k => [k, []]));
  for (const t of ts.interest_over_time?.timeline_data || []) for (const v of t.values || []) series[v.query]?.push({ date: new Date(Number(t.timestamp) * 1000).toISOString().slice(0, 10), value: Number(v.extracted_value) || 0 });
  const rising: TrendResult['rising'] = {};
  for (const k of kw) {
    try { const rq = await call({ q: k, data_type: 'RELATED_QUERIES' }); rising[k] = (rq.related_queries?.rising || []).slice(0, 10).map((x: any) => ({ query: x.query, value: String(x.value ?? x.extracted_value) })); }
    catch { rising[k] = []; }
  }
  return { series, rising };
}

// Google Trends answers with a ")]}'" guard before the JSON.
const unguard = (t: string) => JSON.parse(t.slice(t.indexOf('{')));

async function viaGoogle(kw: string[], geo: string): Promise<TrendResult> {
  const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' };
  // a visit to the home page hands out the cookie the API expects
  const home = await fetch(`https://trends.google.com/trends/?geo=${geo.split('-')[0]}`, { headers: UA });
  const cookie = (home.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const H = { ...UA, ...(cookie ? { cookie } : {}) };
  const get = async (path: string, q: Record<string, string>) => {
    const r = await fetch(`https://trends.google.com/trends/api/${path}?${new URLSearchParams({ hl: 'en-US', tz: '-330', ...q })}`, { headers: H });
    if (!r.ok) throw new Error(`Google Trends ${r.status}${r.status === 429 ? ': rate limited. Add SERPAPI_KEY for a reliable feed.' : ''}`);
    return unguard(await r.text());
  };
  const explore = await get('explore', { req: JSON.stringify({ comparisonItem: kw.map(k => ({ keyword: k, geo, time: 'today 3-m' })), category: 0, property: '' }) });
  const widgets: any[] = explore.widgets || [];
  const series: TrendResult['series'] = Object.fromEntries(kw.map(k => [k, []]));
  const tw = widgets.find(w => w.id === 'TIMESERIES');
  if (tw) {
    const d = await get('widgetdata/multiline', { req: JSON.stringify(tw.request), token: tw.token });
    for (const t of d.default?.timelineData || []) kw.forEach((k, i) => series[k].push({ date: new Date(Number(t.time) * 1000).toISOString().slice(0, 10), value: Number(t.value?.[i]) || 0 }));
  }
  const rising: TrendResult['rising'] = {};
  for (const w of widgets.filter(w => w.id.startsWith('RELATED_QUERIES'))) {
    const k = w.request?.restriction?.complexKeywordsRestriction?.keyword?.[0]?.value || kw[0];
    try {
      const d = await get('widgetdata/relatedsearches', { req: JSON.stringify(w.request), token: w.token });
      rising[k] = (d.default?.rankedList?.[1]?.rankedKeyword || []).slice(0, 10).map((x: any) => ({ query: x.query, value: x.formattedValue }));
    } catch { rising[k] = []; }
  }
  return { series, rising };
}

/** Last 4 weeks of interest against the 4 weeks before, in percent. */
export function change(points: Point[]) {
  if (points.length < 8) return null;
  const n = Math.max(4, Math.round(points.length * 28 / 90)), recent = points.slice(-n), before = points.slice(-2 * n, -n);
  const avg = (xs: Point[]) => xs.reduce((s, p) => s + p.value, 0) / Math.max(1, xs.length);
  const b = avg(before); return b ? Math.round(((avg(recent) - b) / b) * 100) : null;
}
