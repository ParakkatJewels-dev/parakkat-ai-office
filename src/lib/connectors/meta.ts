import 'server-only';
import { opt } from '@/lib/env';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAccess } from './vault';
import { chosen, metaId } from './accounts.mjs';
import { errText } from '@/lib/errors';

export const G = () => `https://graph.facebook.com/${opt('META_API_VERSION', 'v21.0')}`;

/** accounts are the ad accounts to sync; account is the one new campaigns launch in. */
type MetaConfig = { token: string; accounts: string[]; account?: string; page?: string; ig?: string };
const actId = (id: string) => `act_${metaId(id)}`;
/** Access connected on the Admin page, else the Vercel keys, else null. */
export async function metaConfig(): Promise<MetaConfig | null> {
  const s = await loadAccess('meta');
  if (s) {
    const st = s.settings, accounts = chosen(st.ad_account_ids, st.ad_account_id).map(actId);
    return { token: s.tokens.access_token, accounts, account: st.ad_account_id ? actId(st.ad_account_id) : accounts[0], page: st.page_id, ig: st.ig_user_id };
  }
  const e = process.env;
  // META_AD_ACCOUNT_ID may list several accounts, comma separated; the first is where campaigns launch
  const accounts = chosen(null, e.META_AD_ACCOUNT_ID).map(actId);
  return e.META_ACCESS_TOKEN ? { token: e.META_ACCESS_TOKEN, accounts, account: accounts[0], page: e.META_PAGE_ID, ig: e.META_IG_USER_ID } : null;
}
async function cfg() { const c = await metaConfig(); if (!c) throw new Error('Meta is not connected. Connect it on the Admin page.'); return c; }
const need = (v: string | undefined, what: string) => { if (!v) throw new Error(`Choose the Meta ${what} on the Admin page.`); return v; };

async function get(path: string, params: Record<string, string> = {}) {
  const u = new URL(`${G()}/${path}`); Object.entries({ ...params, access_token: (await cfg()).token }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u); const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Meta ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}
async function post(path: string, body: Record<string, unknown>) {
  const form = new URLSearchParams({ access_token: (await cfg()).token });
  Object.entries(body).forEach(([k, v]) => form.set(k, typeof v === 'string' ? v : JSON.stringify(v)));
  const res = await fetch(`${G()}/${path}`, { method: 'POST', body: form }); const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Meta ${res.status}: ${data.error?.error_user_msg || data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}
async function all(path: string, params: Record<string, string>) {
  const out: any[] = []; let page = await get(path, params);
  for (;;) { out.push(...(page.data || [])); if (!page.paging?.next) break; const r = await fetch(page.paging.next); page = await r.json(); }
  return out;
}
const act = (list: any[] | undefined, type: string) => Number(list?.find(a => a.action_type === type)?.value ?? 0);

/** Daily results per ad for the last 30 days, for every chosen ad account. One account failing does not stop the others. */
export async function syncAdInsights(db: SupabaseClient) {
  const c = await cfg();
  if (!c.accounts.length) need(undefined, 'ad account');
  let count = 0; const failed: string[] = [];
  for (const account of c.accounts) {
    try {
      const rows = (await all(`${account}/insights`, {
        level: 'ad', time_increment: '1', date_preset: 'last_30d', limit: '500',
        fields: 'ad_id,ad_name,campaign_id,campaign_name,spend,impressions,clicks,actions,action_values',
      })).map(r => ({
        day: r.date_start, platform: 'meta', account_id: metaId(account), ad_id: r.ad_id, ad_name: r.ad_name, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
        spend: Number(r.spend), impressions: Number(r.impressions), clicks: Number(r.clicks),
        purchases: act(r.actions, 'purchase'), revenue: act(r.action_values, 'purchase'),
      }));
      if (rows.length) { const { error } = await db.from('ad_insights_daily').upsert(rows); if (error) throw error; }
      count += rows.length;
    } catch (e) { failed.push(`${metaId(account)} (${errText(e)})`); }
  }
  if (failed.length === c.accounts.length) throw new Error(`Meta: ${failed.join('; ')}`);
  return { count, accounts: c.accounts.length, failed };
}

/** Your recent Instagram posts with reach and saves, so the Post Analyst can see what sells. */
export async function syncInstagram(db: SupabaseClient, limit = 50) {
  const media = (await get(`${need((await cfg()).ig, 'Instagram account')}/media`, { fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count', limit: String(limit) })).data as any[];
  const rows = [];
  for (const m of media) {
    let reach = null, saves = null, shares = null;
    try {
      const ins = (await get(`${m.id}/insights`, { metric: 'reach,saved,shares' })).data as any[];
      const v = (n: string) => ins.find(i => i.name === n)?.values?.[0]?.value ?? null;
      reach = v('reach'); saves = v('saved'); shares = v('shares');
    } catch { /* some media types have no insights */ }
    rows.push({ id: m.id, platform: 'instagram', permalink: m.permalink, caption: m.caption, media_type: m.media_type, media_url: m.media_url,
      posted_at: m.timestamp, likes: m.like_count, comments: m.comments_count, reach, saves, shares, updated_at: new Date().toISOString() });
  }
  if (rows.length) { const { error } = await db.from('social_posts').upsert(rows); if (error) throw error; }
  return rows.length;
}

/** A competitor's public Instagram business profile and latest posts (Instagram business discovery). */
export async function competitorInstagram(handle: string) {
  const d = await get(need((await cfg()).ig, 'Instagram account'), {
    fields: `business_discovery.username(${handle}){username,followers_count,media_count,media.limit(12){caption,like_count,comments_count,timestamp,permalink,media_type}}`,
  });
  return d.business_discovery as { username: string; followers_count: number; media: { data: any[] } };
}

/**
 * Ads a competitor page is running, from the Meta Ad Library API. Outside the EU the API only returns
 * political and issue ads, so for Indian jewellery brands the War Room uses the public Ad Library page instead.
 */
export async function competitorAds(pageId: string) {
  return (await get('ads_archive', { search_page_ids: pageId, ad_reached_countries: '["IN"]', ad_active_status: 'ACTIVE', fields: 'id,ad_creative_bodies,ad_delivery_start_time,ad_snapshot_url', limit: '50' })).data as any[];
}

export type MetaLaunch = { name: string; dailyBudgetInr: number; days: number; link: string; message: string; headline: string; image: Buffer; countries?: string[] };

/**
 * Publish an approved campaign. Everything is created PAUSED and switched on at the very end,
 * so a half-built campaign never spends. Only called after the Super Admin approves.
 */
export async function publishCampaign(p: MetaLaunch) {
  const c = await cfg(), account = need(c.account, 'ad account'), pixel = process.env.META_PIXEL_ID;
  const campaign = await post(`${account}/campaigns`, { name: p.name, objective: pixel ? 'OUTCOME_SALES' : 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: [] });
  const start = new Date(), end = new Date(Date.now() + p.days * 864e5);
  const adset = await post(`${account}/adsets`, {
    name: `${p.name} · India`, campaign_id: campaign.id, status: 'PAUSED', billing_event: 'IMPRESSIONS',
    daily_budget: String(Math.round(p.dailyBudgetInr * 100)), bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    optimization_goal: pixel ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS', ...(pixel ? { promoted_object: { pixel_id: pixel, custom_event_type: 'PURCHASE' } } : {}),
    start_time: start.toISOString(), end_time: end.toISOString(), targeting: { geo_locations: { countries: p.countries || ['IN'] }, age_min: 21 },
  });
  const img = await post(`${account}/adimages`, { bytes: p.image.toString('base64') });
  const hash = Object.values(img.images as Record<string, { hash: string }>)[0].hash;
  const creative = await post(`${account}/adcreatives`, { name: p.name, object_story_spec: { page_id: need(c.page, 'Facebook page'), instagram_user_id: c.ig, link_data: { image_hash: hash, link: p.link, message: p.message, name: p.headline, call_to_action: { type: 'SHOP_NOW', value: { link: p.link } } } } });
  const ad = await post(`${account}/ads`, { name: p.name, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'ACTIVE' });
  await post(adset.id, { status: 'ACTIVE' });
  await post(campaign.id, { status: 'ACTIVE' });
  return { campaign_id: campaign.id, adset_id: adset.id, ad_id: ad.id };
}
