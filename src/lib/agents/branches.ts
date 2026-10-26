import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const pct = (now: number, before: number) => before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%` : 'new';

export type BranchRow = { branch: string; kind: string; orders: number; revenue: number; prev_revenue: number };

/** Each showroom's and the online store's orders and revenue over the last `days` days, from Odoo. Empty when Odoo is not connected. */
export async function branchSales(db: SupabaseClient, days = 30) {
  const { data } = await db.rpc('branch_sales', { p_since: daysAgo(days - 1) });
  return ((data || []) as BranchRow[]).map(r => ({ ...r, orders: Number(r.orders), revenue: Number(r.revenue), prev_revenue: Number(r.prev_revenue) }));
}

/** Lines for an agent's prompt: branch sales, then Odoo's best sellers with the stock left. */
export async function branchBrief(db: SupabaseClient, days = 30): Promise<string[]> {
  const [rows, { data: top }] = await Promise.all([
    branchSales(db, days),
    db.rpc('odoo_top_products', { p_since: daysAgo(days - 1), p_limit: 15 }),
  ]);
  if (!rows.length) return [];
  return [
    `Sales by branch from Odoo, last ${days} days (orders, revenue, change against the ${days} days before):`,
    ...rows.map(r => `${r.branch} (${r.kind}) | ${r.orders} orders | ${inr(r.revenue)} | ${pct(r.revenue, r.prev_revenue)}`),
    `Best sellers across all branches (units, revenue, branches selling it, free stock left):`,
    ...((top || []) as any[]).map(p => `${p.product || p.sku} [${p.sku}] | ${+p.units} | ${inr(+p.revenue)} | ${p.branches} | stock ${p.stock ?? '?'}`),
  ];
}
