import 'server-only';
import { env, has, opt } from '@/lib/env';
import { G } from './meta';
import { accessToken } from './google';
import { shopifyHmacOk } from './oauth-core.mjs';
import type { Platform, Tokens } from './vault';

/**
 * Connecting a platform from the Admin page: the sign-in link for each platform, and what to do when it sends the
 * Super Admin back. Each platform only shows its sign-in page for an app registered with it, so the app's own id and
 * secret still come from Vercel; everything a sign-in gives us is saved encrypted by the caller.
 */

/** The Vercel keys each platform's app needs before its Connect button works. */
export const APP_KEYS: Record<Platform, string[]> = {
  meta: ['META_APP_ID', 'META_APP_SECRET'],
  google: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN'],
  shopify: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'],
};
export const appReady = (p: Platform) => has(...APP_KEYS[p]);

const META_SCOPES = ['ads_read', 'ads_management', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'instagram_basic', 'instagram_manage_insights'];
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/adwords', 'https://www.googleapis.com/auth/analytics.readonly'];
const SHOPIFY_SCOPES = 'read_products,read_orders,read_inventory';

export function authorizeUrl(p: Platform, redirectUri: string, state: string, shop?: string) {
  if (p === 'meta') {
    const u = new URL(`https://www.facebook.com/${opt('META_API_VERSION', 'v21.0')}/dialog/oauth`);
    u.search = new URLSearchParams({ client_id: env('META_APP_ID'), redirect_uri: redirectUri, state, response_type: 'code',
      // Facebook Login for Business uses a configuration made in the Meta app instead of a list of permissions
      ...(process.env.META_LOGIN_CONFIG_ID ? { config_id: process.env.META_LOGIN_CONFIG_ID } : { scope: META_SCOPES.join(',') }) }).toString();
    return u.toString();
  }
  if (p === 'google') {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    // offline + consent so Google always returns a refresh token, which is what keeps the connection alive
    u.search = new URLSearchParams({ client_id: env('GOOGLE_OAUTH_CLIENT_ID'), redirect_uri: redirectUri, state, response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }).toString();
    return u.toString();
  }
  const u = new URL(`https://${shop}/admin/oauth/authorize`);
  u.search = new URLSearchParams({ client_id: env('SHOPIFY_CLIENT_ID'), scope: SHOPIFY_SCOPES, redirect_uri: redirectUri, state }).toString();
  return u.toString();
}

export type Finished = { tokens: Tokens; settings: Record<string, any>; expiresAt: Date | null; summary: string };
type Option = { id: string; name: string };

async function json(res: Response, what: string) {
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(`${what} ${res.status}: ${d.error?.message || d.error_description || (typeof d.error === 'string' ? d.error : '') || JSON.stringify(d).slice(0, 200)}`);
  return d;
}

/** Trade the code for access, then list the accounts it can reach so the Super Admin can choose. */
export async function finish(p: Platform, params: URLSearchParams, redirectUri: string, shop?: string): Promise<Finished> {
  const code = params.get('code'); if (!code) throw new Error(params.get('error_description') || params.get('error') || 'The sign-in was cancelled.');

  if (p === 'meta') {
    const app = { client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET') };
    const short = await json(await fetch(`${G()}/oauth/access_token?${new URLSearchParams({ ...app, redirect_uri: redirectUri, code })}`), 'Meta sign-in');
    // a user token lasts an hour; trade it for one that lasts about 60 days. Business system-user tokens may not need it.
    let tok = short;
    try { tok = await json(await fetch(`${G()}/oauth/access_token?${new URLSearchParams({ ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })}`), 'Meta long-lived token'); } catch { /* keep the short one */ }
    const q = (path: string, fields: string) => fetch(`${G()}/${path}?${new URLSearchParams({ fields, limit: '100', access_token: tok.access_token })}`).then(r => json(r, 'Meta accounts'));
    const [acts, pages] = await Promise.all([q('me/adaccounts', 'id,name,account_status'), q('me/accounts', 'id,name,instagram_business_account{id,username}')]);
    const ads: Option[] = (acts.data || []).map((a: any) => ({ id: a.id, name: a.name || a.id }));
    const pg = (pages.data || []).map((x: any) => ({ id: x.id, name: x.name, ig: x.instagram_business_account?.id || null, ig_name: x.instagram_business_account?.username || null }));
    const settings: Record<string, any> = { choices: { ads, pages: pg } };
    if (ads.length === 1) settings.ad_account_id = ads[0].id;
    if (pg.length === 1) { settings.page_id = pg[0].id; settings.ig_user_id = pg[0].ig || undefined; }
    return { tokens: { access_token: tok.access_token }, settings, expiresAt: tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000) : null,
      summary: `${ads.length} ad account${ads.length === 1 ? '' : 's'} and ${pg.length} page${pg.length === 1 ? '' : 's'} found` };
  }

  if (p === 'google') {
    const tok = await json(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'), client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'), code, redirect_uri: redirectUri, grant_type: 'authorization_code' }) }), 'Google sign-in');
    if (!tok.refresh_token) throw new Error('Google did not return lasting access. Remove the app under myaccount.google.com/permissions and connect again.');
    const access = tok.access_token || await accessToken(tok.refresh_token);
    const v = opt('GOOGLE_ADS_API_VERSION', 'v21'), h = { authorization: `Bearer ${access}`, 'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN'), 'content-type': 'application/json' };
    // the Ads accounts this person can open, with names where Google gives them
    const customers: (Option & { manager: boolean })[] = []; let note: string | undefined;
    try {
      const list = await json(await fetch(`https://googleads.googleapis.com/${v}/customers:listAccessibleCustomers`, { headers: h }), 'Google Ads accounts');
      for (const rn of ((list.resourceNames || []) as string[]).slice(0, 25)) {
        const id = rn.split('/')[1]; let name = id, manager = false;
        try {
          const r = await json(await fetch(`https://googleads.googleapis.com/${v}/customers/${id}/googleAds:search`, { method: 'POST', headers: { ...h, 'login-customer-id': id },
            body: JSON.stringify({ query: 'SELECT customer.descriptive_name, customer.manager FROM customer LIMIT 1' }) }), 'Google Ads account');
          name = r.results?.[0]?.customer?.descriptiveName || id; manager = !!r.results?.[0]?.customer?.manager;
        } catch { /* listed but not readable on its own; still offer it */ }
        customers.push({ id, name, manager });
      }
    } catch (e) { note = e instanceof Error ? e.message : String(e); /* type the account id by hand instead */ }
    // Analytics properties, if the Analytics Admin API is switched on in the Google Cloud project
    const properties: Option[] = [];
    try {
      const s = await json(await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { headers: { authorization: `Bearer ${access}` } }), 'Analytics');
      for (const a of s.accountSummaries || []) for (const pr of a.propertySummaries || []) properties.push({ id: String(pr.property).split('/')[1], name: `${pr.displayName} (${a.displayName})` });
    } catch { /* GA4 stays optional */ }
    const settings: Record<string, any> = { choices: { customers, properties }, ...(note ? { note: note.slice(0, 300) } : {}) };
    const plain = customers.filter(c => !c.manager);
    if (plain.length === 1) settings.customer_id = plain[0].id;
    if (properties.length === 1) settings.ga4_property_id = properties[0].id;
    return { tokens: { access_token: access, refresh_token: tok.refresh_token }, settings, expiresAt: null,
      summary: `${customers.length} Ads account${customers.length === 1 ? '' : 's'} and ${properties.length} Analytics propert${properties.length === 1 ? 'y' : 'ies'} found` };
  }

  // Shopify signs the redirect; check it and that it is the store we sent the Super Admin to
  if (!shop || params.get('shop') !== shop) throw new Error('Shopify sent back a different store than the one you entered.');
  if (!shopifyHmacOk(params, process.env.SHOPIFY_CLIENT_SECRET)) throw new Error('Shopify\'s signature did not match. Check SHOPIFY_CLIENT_SECRET.');
  const tok = await json(await fetch(`https://${shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env('SHOPIFY_CLIENT_ID'), client_secret: env('SHOPIFY_CLIENT_SECRET'), code }) }), 'Shopify sign-in');
  return { tokens: { access_token: tok.access_token, ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}) }, settings: { shop, scope: tok.scope },
    expiresAt: tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000) : null, summary: shop };
}

/** Where each platform sends the Super Admin back. Register this exact address in the platform's app settings. */
export const redirectUri = (origin: string, p: Platform) => `${(process.env.APP_URL || origin).replace(/\/$/, '')}/api/connect/${p}/callback`;
export const STATE_COOKIE = 'pk_connect';

/** The rows of the Connections list that a platform's chosen accounts fill in. */
export function connectionRows(p: Platform, s: Record<string, any>) {
  const row = (provider: string, ref?: string) => ({ provider, status: ref ? 'connected' : 'not_connected', account_ref: ref || null, last_error: null });
  if (p === 'meta') return [row('meta', s.ad_account_id), row('instagram', s.ig_user_id)];
  if (p === 'google') return [row('google_ads', s.customer_id), row('keyword_planner', s.customer_id), row('ga4', s.ga4_property_id)];
  return [row('shopify', s.shop)];
}
