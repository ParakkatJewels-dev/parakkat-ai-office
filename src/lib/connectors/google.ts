import 'server-only';
import { env, opt } from '@/lib/env';
import type { SupabaseClient } from '@supabase/supabase-js';

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
    client_id: env('GOOGLE_OAUTH_CLIENT_ID'), client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'), refresh_token: env('GOOGLE_OAUTH_REFRESH_TOKEN'), grant_type: 'refresh_token' }) });
  const d = await res.json(); if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${d.error_description || d.error}`);
  return d.access_token as string;
}

/** Headers for any Google Ads API call: OAuth token, developer token and the manager account when there is one. */
async function adsHeaders() {
  return { authorization: `Bearer ${await accessToken()}`, 'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN'), 'content-type': 'application/json',
    ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { 'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, '') } : {}) };
}
const adsUrl = (path: string) => `https://googleads.googleapis.com/${opt('GOOGLE_ADS_API_VERSION', 'v21')}/customers/${env('GOOGLE_ADS_CUSTOMER_ID').replace(/-/g, '')}${path}`;

/** Daily results per ad for the last 30 days (Google Ads API, GAQL). */
export async function syncGoogleAds(db: SupabaseClient) {
  const res = await fetch(adsUrl('/googleAds:searchStream'), {
    method: 'POST',
    headers: await adsHeaders(),
    body: JSON.stringify({ query: `SELECT segments.date, campaign.id, campaign.name, ad_group_ad.ad.id, ad_group_ad.ad.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM ad_group_ad WHERE segments.date DURING LAST_30_DAYS` }),
  });
  const chunks = await res.json(); if (!res.ok) throw new Error(`Google Ads ${res.status}: ${JSON.stringify(chunks).slice(0, 300)}`);
  const rows = (chunks as any[]).flatMap(c => c.results || []).map((r: any) => ({
    day: r.segments.date, platform: 'google', campaign_id: r.campaign.id, campaign_name: r.campaign.name, ad_id: String(r.adGroupAd.ad.id), ad_name: r.adGroupAd.ad.name || null,
    spend: Number(r.metrics.costMicros || 0) / 1e6, impressions: Number(r.metrics.impressions || 0), clicks: Number(r.metrics.clicks || 0),
    purchases: Number(r.metrics.conversions || 0), revenue: Number(r.metrics.conversionsValue || 0),
  }));
  if (rows.length) { const { error } = await db.from('ad_insights_daily').upsert(rows); if (error) throw error; }
  return rows.length;
}

export type KeywordIdea = { keyword: string; avg_monthly_searches: number | null; competition: string | null; bid_low: number | null; bid_high: number | null; monthly: { month: string; searches: number }[] };

/**
 * Keyword ideas with monthly searches and bid ranges from Keyword Planner (KeywordPlanIdeaService).
 * Needs a developer token with Basic access; a test token only returns test data.
 * Defaults to India in English; SEO_GEO_TARGETS and SEO_LANGUAGE take Google's geo and language constant ids.
 */
export async function keywordIdeas(seeds: string[]): Promise<KeywordIdea[]> {
  const geos = opt('SEO_GEO_TARGETS', '2356').split(',').map(g => `geoTargetConstants/${g.trim()}`);
  const res = await fetch(adsUrl(':generateKeywordIdeas'), {
    method: 'POST', headers: await adsHeaders(),
    body: JSON.stringify({ language: `languageConstants/${opt('SEO_LANGUAGE', '1000')}`, geoTargetConstants: geos, includeAdultKeywords: false,
      keywordPlanNetwork: 'GOOGLE_SEARCH', keywordSeed: { keywords: seeds.slice(0, 20) }, pageSize: 200 }),
  });
  const d = await res.json(); if (!res.ok) throw new Error(`Keyword Planner ${res.status}: ${JSON.stringify(d.error?.message || d).slice(0, 300)}`);
  const n = (v: unknown) => v == null ? null : Number(v);
  return (d.results || []).map((r: any) => {
    const m = r.keywordIdeaMetrics || {};
    return {
      keyword: String(r.text).toLowerCase(), avg_monthly_searches: n(m.avgMonthlySearches), competition: m.competition || null,
      bid_low: m.lowTopOfPageBidMicros ? Number(m.lowTopOfPageBidMicros) / 1e6 : null, bid_high: m.highTopOfPageBidMicros ? Number(m.highTopOfPageBidMicros) / 1e6 : null,
      monthly: (m.monthlySearchVolumes || []).map((v: any) => ({ month: `${v.year}-${String(MONTHS.indexOf(v.month) + 1).padStart(2, '0')}`, searches: Number(v.monthlySearches || 0) })),
    };
  });
}
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** Sessions and purchases by channel from GA4, for the Attribution Analyst. */
export async function ga4ChannelReport(days = 30) {
  const token = await accessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env('GA4_PROPERTY_ID')}:runReport`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }, { name: 'purchaseRevenue' }] }),
  });
  const d = await res.json(); if (!res.ok) throw new Error(`GA4 ${res.status}: ${d.error?.message}`);
  return (d.rows || []).map((r: any) => ({ channel: r.dimensionValues[0].value, sessions: +r.metricValues[0].value, purchases: +r.metricValues[1].value, revenue: +r.metricValues[2].value }));
}
