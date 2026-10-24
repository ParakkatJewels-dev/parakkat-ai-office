import 'server-only';
import { env, opt } from '@/lib/env';
import type { SupabaseClient } from '@supabase/supabase-js';

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${opt('SHOPIFY_API_VERSION', '2025-07')}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_TOKEN'), 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(data.errors || data).slice(0, 300)}`);
  return data.data as T;
}
const num = (gid: string) => Number(gid.split('/').pop());

/** Products with price, stock and main photo. The photo is what the Creative House builds banners from. */
export async function syncProducts(db: SupabaseClient) {
  let after: string | null = null, count = 0;
  do {
    const d: any = await gql(`query($after: String) { products(first: 100, after: $after) { pageInfo { hasNextPage endCursor }
      nodes { id title handle productType tags status updatedAt totalInventory featuredMedia { preview { image { url } } } variants(first: 1) { nodes { price } } } } }`, { after });
    const rows = d.products.nodes.map((p: any) => ({
      id: num(p.id), title: p.title, handle: p.handle, product_type: p.productType, tags: p.tags, status: p.status, updated_at: p.updatedAt,
      inventory: p.totalInventory, price: Number(p.variants.nodes[0]?.price ?? 0), image_url: p.featuredMedia?.preview?.image?.url ?? null,
    }));
    if (rows.length) { const { error } = await db.from('products').upsert(rows); if (error) throw error; }
    count += rows.length; after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after);
  return count;
}

/** Units and revenue per product per day for the last `days` days. */
export async function syncOrders(db: SupabaseClient, days = 30) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const agg = new Map<string, { day: string; product_id: number; units: number; revenue: number }>();
  let after: string | null = null;
  do {
    const d: any = await gql(`query($after: String, $q: String) { orders(first: 100, after: $after, query: $q) { pageInfo { hasNextPage endCursor }
      nodes { createdAt lineItems(first: 50) { nodes { quantity product { id } discountedTotalSet { shopMoney { amount } } } } } } }`, { after, q: `created_at:>=${since} -status:cancelled` });
    for (const o of d.orders.nodes) for (const li of o.lineItems.nodes) {
      if (!li.product) continue;
      const day = o.createdAt.slice(0, 10), pid = num(li.product.id), k = `${day}:${pid}`;
      const a = agg.get(k) || { day, product_id: pid, units: 0, revenue: 0 };
      a.units += li.quantity; a.revenue += Number(li.discountedTotalSet.shopMoney.amount); agg.set(k, a);
    }
    after = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (after);
  const rows = [...agg.values()];
  if (rows.length) { const { error } = await db.from('orders_daily').upsert(rows); if (error) throw error; }
  return rows.length;
}
