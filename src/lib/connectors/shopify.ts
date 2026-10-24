import 'server-only';
import { env, opt } from '@/lib/env';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAccess, saveAccess, type Saved } from './vault';
import { isThrottled, waitMs } from './shopify-limits.mjs';

let cached: { token: string; until: number } | null = null;
type Store = { domain: string; saved: Saved | null };

/** The store connected on the Admin page, else the one in Vercel, else null. */
async function store(): Promise<Store | null> {
  const s = await loadAccess('shopify');
  if (s?.settings.shop) return { domain: s.settings.shop, saved: s };
  return process.env.SHOPIFY_STORE_DOMAIN ? { domain: process.env.SHOPIFY_STORE_DOMAIN, saved: null } : null;
}

/** The store domain when there is a way in: a store connected from the app, or either kind of Vercel credential. */
export async function shopifyReady() {
  const s = await store(); if (!s) return null;
  return s.saved || process.env.SHOPIFY_ADMIN_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) ? s.domain : null;
}

/**
 * The Admin API token. A store connected from the app has its own token, renewed here when Shopify made it an expiring one.
 * Otherwise an older custom app gives a permanent SHOPIFY_ADMIN_TOKEN, and Dev Dashboard apps give SHOPIFY_CLIENT_ID and
 * SHOPIFY_CLIENT_SECRET, which we trade for a token that lasts about a day.
 */
async function adminToken(s: Store) {
  if (s.saved) {
    const t = s.saved.tokens;
    if (!t.refresh_token || !s.saved.expires_at || Date.parse(s.saved.expires_at) - 300_000 > Date.now()) return t.access_token;
    const res = await fetch(`https://${s.domain}/admin/oauth/access_token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: env('SHOPIFY_CLIENT_ID'), client_secret: env('SHOPIFY_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: t.refresh_token }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.access_token) throw new Error(`Shopify token refresh ${res.status}: ${d.error_description || d.error || 'reconnect Shopify on the Admin page'}`);
    await saveAccess('shopify', { access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token }, s.saved.settings, d.expires_in ? new Date(Date.now() + d.expires_in * 1000) : null);
    return d.access_token as string;
  }
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  if (cached && cached.until > Date.now()) return cached.token;
  const res = await fetch(`https://${s.domain}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('SHOPIFY_CLIENT_ID'), client_secret: env('SHOPIFY_CLIENT_SECRET') }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new Error(`Shopify token ${res.status}: ${d.error_description || d.error || 'check SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET, and that the app is installed on the store'}`);
  cached = { token: d.access_token, until: Date.now() + Math.max(60, Number(d.expires_in || 86400) - 300) * 1000 };
  return cached.token;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** One GraphQL call. Waits when Shopify's query budget runs low and retries when it says THROTTLED. */
async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const s = await store(); if (!s) throw new Error('Shopify is not connected. Connect it on the Admin page.');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://${s.domain}/admin/api/${opt('SHOPIFY_API_VERSION', '2025-07')}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': await adminToken(s), 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 && attempt < 6) { await sleep(Number(res.headers.get('retry-after') || 2) * 1000); continue; }
    const data = await res.json().catch(() => ({}));
    const cost = data.extensions?.cost;
    if (isThrottled(data) && attempt < 6) { await sleep(waitMs(cost, { throttled: true, attempt })); continue; }
    if (!res.ok || data.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(data.errors || data).slice(0, 300)}`);
    const pause = waitMs(cost); if (pause) await sleep(pause);
    return data.data as T;
  }
}
const num = (gid: string) => Number(gid.split('/').pop());

type ProductPass = { after?: string | null; query?: string; started?: string; done_at?: string };

/**
 * Products with price, stock and main photo. The photo is what the Creative House builds banners from.
 * The first pass reads every product; later passes only those changed since the last finished pass. A pass that runs
 * out of time saves its place and the next sync carries on from there, so a store of any size gets there in the end.
 */
export async function syncProducts(db: SupabaseClient, deadline = Date.now() + 240_000) {
  const { data: saved } = await db.from('sync_cursors').select('state').eq('name', 'shopify_products').maybeSingle();
  let pass: ProductPass = saved?.state || {};
  if (!pass.after) {
    // a new pass: everything the first time, then whatever changed since the last pass began (with an hour's overlap)
    const from = pass.done_at ? new Date(Date.parse(pass.done_at) - 3600_000).toISOString() : null;
    pass = { after: null, query: from ? `updated_at:>='${from}'` : '', started: new Date().toISOString(), done_at: pass.done_at };
  }
  const keep = (state: ProductPass) => db.from('sync_cursors').upsert({ name: 'shopify_products', state, updated_at: new Date().toISOString() });
  let count = 0, after = pass.after ?? null;
  do {
    const d: any = await gql(`query($after: String, $q: String) { products(first: 50, after: $after, query: $q) { pageInfo { hasNextPage endCursor }
      nodes { id title handle productType tags status updatedAt totalInventory featuredMedia { preview { image { url } } } variants(first: 1) { nodes { price } } } } }`, { after, q: pass.query || null });
    const rows = d.products.nodes.map((p: any) => ({
      id: num(p.id), title: p.title, handle: p.handle, product_type: p.productType, tags: p.tags, status: p.status, updated_at: p.updatedAt,
      inventory: p.totalInventory, price: Number(p.variants.nodes[0]?.price ?? 0), image_url: p.featuredMedia?.preview?.image?.url ?? null,
    }));
    if (rows.length) { const { error } = await db.from('products').upsert(rows); if (error) throw error; }
    count += rows.length; after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    if (after && Date.now() > deadline) { await keep({ ...pass, after }); return { count, more: true }; }
  } while (after);
  await keep({ done_at: pass.started });
  return { count, more: false };
}

/**
 * Units and revenue per product per day for the last `days` days. Totals are only written once every order in the window
 * has been read, so a run cut short never replaces good numbers with partial ones.
 */
export async function syncOrders(db: SupabaseClient, days = 30, deadline = Date.now() + 240_000) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const agg = new Map<string, { day: string; product_id: number; units: number; revenue: number }>();
  let after: string | null = null;
  do {
    const d: any = await gql(`query($after: String, $q: String) { orders(first: 50, after: $after, query: $q) { pageInfo { hasNextPage endCursor }
      nodes { createdAt lineItems(first: 50) { nodes { quantity product { id } discountedTotalSet { shopMoney { amount } } } } } } }`, { after, q: `created_at:>=${since} -status:cancelled` });
    for (const o of d.orders.nodes) for (const li of o.lineItems.nodes) {
      if (!li.product) continue;
      const day = o.createdAt.slice(0, 10), pid = num(li.product.id), k = `${day}:${pid}`;
      const a = agg.get(k) || { day, product_id: pid, units: 0, revenue: 0 };
      a.units += li.quantity; a.revenue += Number(li.discountedTotalSet.shopMoney.amount); agg.set(k, a);
    }
    after = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
    if (after && Date.now() > deadline) throw new Error('Ran out of time reading orders; the last good totals are kept. The next sync tries again.');
  } while (after);
  const rows = [...agg.values()];
  if (rows.length) { const { error } = await db.from('orders_daily').upsert(rows); if (error) throw error; }
  return rows.length;
}
