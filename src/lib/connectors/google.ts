import 'server-only';
import { env, opt } from '@/lib/env';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAccess } from './vault';
import { chosen, googleId, googleTargets } from './accounts.mjs';
import { errText } from '@/lib/errors';
import { adReportingWindow, googleAdMetrics, googlePerformanceMaxMetrics, googlePurchaseMap } from './ad-monitoring-core.mjs';
import { deselectAdAccounts, storeAdSnapshot, recordAdReadFailure } from './ad-monitoring-store';

type Target = { id: string; login?: string };
/** customers are the Ads accounts to sync; customer is the first, which Keyword Planner uses. */
type GoogleConfig = { refresh: string; customers: Target[]; customer?: string; login?: string; ga4?: string };
/** The Google sign-in saved on the Admin page, else the Vercel keys, else null. The app's OAuth client always comes from Vercel. */
export async function googleConfig(): Promise<GoogleConfig | null> {
  const s = await loadAccess('google');
  if (s?.tokens.refresh_token) {
    const st = s.settings, customers = googleTargets(chosen(st.customer_ids, st.customer_id), st.choices?.customers, st.login_customer_id);
    return { refresh: s.tokens.refresh_token, customers, customer: customers[0]?.id, login: customers[0]?.login, ga4: st.ga4_property_id };
  }
  const e = process.env;
  if (!e.GOOGLE_OAUTH_REFRESH_TOKEN) return null;
  // GOOGLE_ADS_CUSTOMER_ID may list several accounts, comma separated
  const customers = googleTargets(chosen(null, e.GOOGLE_ADS_CUSTOMER_ID), [], e.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  return { refresh: e.GOOGLE_OAUTH_REFRESH_TOKEN, customers, customer: customers[0]?.id, login: customers[0]?.login, ga4: e.GA4_PROPERTY_ID };
}
async function cfg() { const c = await googleConfig(); if (!c) throw new Error('Google is not connected. Connect it on the Admin page.'); return c; }
const need = (v: string | undefined, what: string) => { if (!v) throw new Error(`Choose the Google ${what} on the Admin page.`); return v; };
/** True when Google Ads can be called: app keys in Vercel, a sign-in, and an ad account chosen. */
export async function googleAdsReady() {
  const c = await googleConfig();
  return !!c?.customer && !!process.env.GOOGLE_OAUTH_CLIENT_ID && !!process.env.GOOGLE_OAUTH_CLIENT_SECRET ? c : null;
}

export async function accessToken(refresh?: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
    client_id: env('GOOGLE_OAUTH_CLIENT_ID'), client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'), refresh_token: refresh || (await cfg()).refresh, grant_type: 'refresh_token' }) });
  const d = await res.json(); if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${d.error_description || d.error}`);
  return d.access_token as string;
}

/**
 * Headers for any Google Ads API call: OAuth token and the manager account when there is one.
 * Since September 2026 API access belongs to the Google Cloud project and Google ignores the developer token,
 * so it is sent only when GOOGLE_ADS_DEVELOPER_TOKEN is still set.
 */
export const devToken = (): Record<string, string> => process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? { 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN } : {};
const adsHeaders = async (login?: string, token?: string) => ({ authorization: `Bearer ${token || await accessToken((await cfg()).refresh)}`, ...devToken(), 'content-type': 'application/json',
  ...(login ? { 'login-customer-id': login } : {}) });
const adsUrl = (customer: string | undefined, path: string) => `https://googleads.googleapis.com/${opt('GOOGLE_ADS_API_VERSION', 'v26')}/customers/${need(customer, 'Ads account').replace(/-/g, '')}${path}`;

/**
 * Daily results per ad for the last 30 days (Google Ads API, GAQL), for every chosen account.
 * One account failing does not stop the others; the ones that failed come back by id.
 */
export async function syncGoogleAds(db: SupabaseClient,deadline=Date.now()+120000) {
  const c = await cfg(), token = await accessToken(c.refresh);
  await deselectAdAccounts(db,'google',c.customers.map(t=>t.id.replace(/-/g,'')));
  if (!c.customers.length) need(undefined, 'Ads account');
  let count = 0; const failed: string[] = [];
  for (const t of c.customers) {
    const accountId=t.id.replace(/-/g,'');
    try {
      const signal=AbortSignal.timeout(Math.max(1,deadline-Date.now()));
      const query=async(query:string)=>{
        const res=await fetch(adsUrl(t.id,'/googleAds:searchStream'),{method:'POST',headers:await adsHeaders(t.login,token),signal,body:JSON.stringify({query})});
        const chunks=await res.json();
        if(!res.ok||!Array.isArray(chunks)||chunks.some(ch=>ch.error))throw new Error('Google Ads returned incomplete account data.');
        return chunks.flatMap(ch=>ch.results||[]);
      };
      const account=(await query('SELECT customer.id, customer.currency_code, customer.time_zone FROM customer LIMIT 1'))[0]?.customer;
      if(!account?.currencyCode||!account?.timeZone)throw new Error('Google account reporting settings are incomplete.');
      const window=adReportingWindow(account.timeZone),at=new Date().toISOString();
      const inventory=await query('SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.advertising_channel_type, campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign');
      const range=`segments.date BETWEEN '${window.from}' AND '${window.to}'`;
      const base=await query(`SELECT segments.date, campaign.id, campaign.name, ad_group_ad.ad.id, ad_group_ad.ad.name, metrics.cost_micros, metrics.impressions, metrics.clicks FROM ad_group_ad WHERE ${range}`);
      const pmax=await query(`SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND ${range}`);
      const pmaxIds=new Set(inventory.filter((r:any)=>r.campaign?.advertisingChannelType==='PERFORMANCE_MAX').map((r:any)=>String(r.campaign.id)));
      // Never count leads, page views or other configured goals as purchases.
      // Conversion categories come from the account's explicit conversion-action inventory.
      let actions:any[]=[],conversions:any[]=[],conversionRead=false;
      try {
        actions=await query('SELECT conversion_action.resource_name, conversion_action.category, conversion_action.status, conversion_action.primary_for_goal FROM conversion_action');
        conversions=await query(`SELECT segments.date, campaign.id, ad_group_ad.ad.id, segments.conversion_action, metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE ${range}`);
        conversionRead=true;
      } catch { /* Spend/click reporting can remain useful; purchase outcomes stay unknown. */ }
      const purchaseReady=conversionRead&&googlePurchaseMap(actions,conversions).valid;
      const reportingAccount={id:accountId,currency:account.currencyCode,timezone:account.timeZone};
      const rows=[...googleAdMetrics(base.filter((r:any)=>!pmaxIds.has(String(r.campaign?.id))),purchaseReady?actions:[],purchaseReady?conversions:[],reportingAccount,window,at),...googlePerformanceMaxMetrics(pmax,reportingAccount,window,at)];
      const campaigns=inventory.map((r:any)=>({campaign_id:String(r.campaign.id),name:r.campaign.name||String(r.campaign.id),configured_status:r.campaign.status||null,effective_status:r.campaign.primaryStatus||null,
        objective:r.campaign.advertisingChannelType||null,daily_budget:r.campaignBudget?.amountMicros!=null?Number(r.campaignBudget.amountMicros)/1e6:null,budget_scope:r.campaignBudget?.explicitlyShared?'shared':'campaign',
        currency:account.currencyCode,account_timezone:account.timeZone,last_seen_at:at,selected:true,
        details:{metrics_supported:true,limitations:r.campaign.advertisingChannelType==='PERFORMANCE_MAX'?['Performance Max delivery uses campaign-level reporting; purchases are not independently verified.']:[],purchase_conversion_actions_verified:purchaseReady&&r.campaign.advertisingChannelType!=='PERFORMANCE_MAX'}}));
      await storeAdSnapshot(db,'google',accountId,campaigns,rows,{selected:true,status:conversionRead?'complete':'partial',inventory_complete:true,metrics_complete:true,complete:conversionRead,last_attempt_at:at,last_success_at:at,observed_count:campaigns.length,
        window_from:window.from,window_to:window.to,conversion_definition:purchaseReady?'purchase':'unknown',safe_message:purchaseReady?null:'Purchase conversion definitions are unavailable or no purchase action is configured. Purchase metrics remain unknown.',
        coverage:{inventory:true,metrics:true,window_from:window.from,window_to:window.to,purchase_definition_verified:purchaseReady,purchase_tracking_verified:false,attribution:'Configured primary PURCHASE conversion actions under Google Ads reporting attribution; event delivery and deduplicated store orders are not verified',metrics_scope:'ad_group_ad for standard campaigns; campaign-level delivery for Performance Max',funnel:false}});
      count+=rows.length;
    } catch { await recordAdReadFailure(db,'google',accountId);failed.push(`${googleId(t.id)} (account data could not be fully read)`); }
  }
  if (failed.length === c.customers.length) throw new Error(`Google Ads: ${failed.join('; ')}`);
  return { count, accounts: c.customers.length, failed };
}

export type KeywordIdea = { keyword: string; avg_monthly_searches: number | null; competition: string | null; bid_low: number | null; bid_high: number | null; monthly: { month: string; searches: number }[] };

/**
 * Keyword ideas with monthly searches and bid ranges from Keyword Planner (KeywordPlanIdeaService).
 * Needs Basic access on the Google Cloud project; with Explorer access Google refuses it and the SEO Desk carries on with Trends.
 * Defaults to India in English; SEO_GEO_TARGETS and SEO_LANGUAGE take Google's geo and language constant ids.
 */
export async function keywordIdeas(seeds: string[]): Promise<KeywordIdea[]> {
  const geos = opt('SEO_GEO_TARGETS', '2356').split(',').map(g => `geoTargetConstants/${g.trim()}`);
  const c = await cfg();
  const res = await fetch(adsUrl(c.customer, ':generateKeywordIdeas'), {
    method: 'POST', headers: await adsHeaders(c.login),
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
  const c = await cfg(), token = await accessToken(c.refresh);
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${need(c.ga4, 'Analytics property')}:runReport`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }, { name: 'purchaseRevenue' }] }),
  });
  const d = await res.json(); if (!res.ok) throw new Error(`GA4 ${res.status}: ${d.error?.message}`);
  return (d.rows || []).map((r: any) => ({ channel: r.dimensionValues[0].value, sessions: +r.metricValues[0].value, purchases: +r.metricValues[1].value, revenue: +r.metricValues[2].value }));
}
