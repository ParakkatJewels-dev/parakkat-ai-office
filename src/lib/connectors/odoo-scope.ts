import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { odooBranchNames, withoutOdooBranches } from './odoo-scope-core.mjs';

type BranchSale = { branch: string; kind: string; orders: number; revenue: number; prev_revenue: number };
type ProductSale = { sku: string; product: string; units: number; revenue: number; branches: number; stock: number | null };

export async function excludedOdooBranches(): Promise<string[]> {
  const { data, error } = await supabaseAdmin().from('platform_credentials').select('settings').eq('provider', 'odoo').maybeSingle();
  if (error) throw new Error('Could not read the Odoo branch selection.');
  return odooBranchNames(data?.settings?.excludedBranches);
}

/** The picker combines Odoo's discovered warehouse labels and branch labels in recorded Odoo orders. */
export async function odooBranchChoices(settings: Record<string, any>): Promise<string[]> {
  const db = supabaseAdmin(), observed: string[] = [];
  for (let offset = 0; offset < 2000; offset += 1000) {
    const { data, error } = await db.from('odoo_branch_daily').select('branch').order('branch').range(offset, offset + 999);
    if (error) throw new Error('Could not list the recorded Odoo branches.');
    observed.push(...(data || []).map(row => row.branch));
    if ((data || []).length < 1000) break;
  }
  return odooBranchNames([...(settings.branchChoices || []), ...(settings.warehouses || []), ...(settings.posBranches || settings.pos || []), ...(settings.excludedBranches || []), ...observed]);
}

async function readAll(db: SupabaseClient, table: string, columns: string, from: string, to: string | null, excluded: string[], maxRows: number) {
  const rows: any[] = [];
  for (let offset = 0; offset <= maxRows; offset += 1000) {
    let query = db.from(table).select(columns).gte('day', from).order('day').order('branch').range(offset, offset + 999);
    if (to) query = query.lte('day', to);
    query = withoutOdooBranches(query, excluded);
    const { data, error } = await query;
    if (error) throw new Error(`Could not read scoped ${table}.`);
    rows.push(...(data || []));
    if ((data || []).length < 1000) return rows;
  }
  throw new Error(`The scoped ${table} read exceeds its safe row limit.`);
}

/** Same date arithmetic as branch_sales, with excluded branches removed before totals. */
export async function scopedOdooBranchSales(db: SupabaseClient, since: string, till?: string, excluded?: string[]): Promise<BranchSale[]> {
  const names = excluded ?? await excludedOdooBranches();
  if (!names.length) {
    const { data, error } = await db.rpc('branch_sales', { p_since: since, ...(till ? { p_till: till } : {}) });
    if (error) throw new Error('Could not read Odoo branch sales.');
    return (data || []).map((row: any) => ({ ...row, orders: Number(row.orders), revenue: Number(row.revenue), prev_revenue: Number(row.prev_revenue) }));
  }
  const end = till || new Date().toISOString().slice(0, 10);
  const span = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${since}T12:00:00Z`)) / 864e5) + 1;
  const prev = new Date(Date.parse(`${since}T12:00:00Z`) - span * 864e5).toISOString().slice(0, 10);
  const rows = await readAll(db, 'odoo_branch_daily', 'day,branch,kind,orders,revenue', prev, end, names, 10000);
  const grouped = new Map<string, any>();
  for (const row of rows) {
    const entry = grouped.get(row.branch) || { branch: row.branch, kind: row.kind, orders: 0, revenue: 0, prev_revenue: 0 };
    entry.kind = row.kind;
    if (row.day >= since) { entry.orders += Number(row.orders) || 0; entry.revenue += Number(row.revenue) || 0; }
    else entry.prev_revenue += Number(row.revenue) || 0;
    grouped.set(row.branch, entry);
  }
  return [...grouped.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Keep the existing DB aggregate when all branches are selected; otherwise rank scoped recorded lines. */
export async function scopedOdooTopProducts(db: SupabaseClient, since: string, limit = 15, excluded?: string[]): Promise<ProductSale[]> {
  const names = excluded ?? await excludedOdooBranches();
  if (!names.length) {
    const { data, error } = await db.rpc('odoo_top_products', { p_since: since, p_limit: limit });
    if (error) throw new Error('Could not read Odoo products.');
    return (data || []) as ProductSale[];
  }
  const rows = await readAll(db, 'odoo_sales_daily', 'sku,product,branch,day,units,revenue', since, null, names, 50000);
  const grouped = new Map<string, {sku:string;product:string;units:number;revenue:number;branches:Set<string>}>();
  for (const row of rows) {
    const item = grouped.get(row.sku) || { sku: row.sku, product: row.product, units: 0, revenue: 0, branches: new Set<string>() };
    item.units += Number(row.units) || 0; item.revenue += Number(row.revenue) || 0; item.branches.add(row.branch); grouped.set(row.sku, item);
  }
  const top = [...grouped.values()].sort((a, b) => b.revenue - a.revenue || b.units - a.units || a.sku.localeCompare(b.sku)).slice(0, Math.min(limit, 500));
  const stock = new Map<string, number>();
  for (let offset = 0; offset < top.length; offset += 100) {
    const skus = top.slice(offset, offset + 100).map(row => row.sku);
    const { data, error } = await withoutOdooBranches(db.from('odoo_stock').select('sku,warehouse,qty,reserved').in('sku', skus), names, 'warehouse');
    if (error) throw new Error('Could not read scoped Odoo stock.');
    for (const row of data || []) stock.set(row.sku, (stock.get(row.sku) || 0) + Number(row.qty) - Number(row.reserved));
  }
  return top.map(row => ({ sku: row.sku, product: row.product, units: row.units, revenue: row.revenue,
    branches: row.branches.size, stock: stock.has(row.sku) ? stock.get(row.sku)! : null }));
}
