import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAccess } from './vault';
import { assertOdooRead } from './readonly.mjs';
import { normalizeOdooUrl, guessDb, istDay, utcStart, addDays, m2o, skuOf, orderBranch, totals, salesDays } from './odoo-core.mjs';
import { randomUUID } from 'node:crypto';

/**
 * Odoo, the ERP: sales for every showroom and the online store, and the stock actually on hand.
 * Odoo 19 and later answer on JSON-2 (/json/2/<model>/<method>, the API key as a bearer token). Older versions only have
 * JSON-RPC (/jsonrpc), which Odoo is retiring, so it is used only when JSON-2 is not there. Everything here only reads:
 * call() refuses any method that is not on the read list in readonly.mjs.
 */
export type OdooCfg = { url: string; db: string; login: string; key: string; online: string[] };

/** The Odoo connected on the Admin page, else one set in Vercel, else null. */
async function config(): Promise<OdooCfg | null> {
  const s = await loadAccess('odoo');
  if (s?.settings.url) return { url: s.settings.url, db: s.settings.db || '', login: s.settings.login || '', key: s.tokens.access_token, online: s.settings.online || [] };
  const url = normalizeOdooUrl(process.env.ODOO_URL), key = process.env.ODOO_API_KEY;
  if (!url || !key) return null;
  return { url, db: process.env.ODOO_DB || guessDb(url), login: process.env.ODOO_LOGIN || '', key, online: (process.env.ODOO_ONLINE || '').split(',').map(x => x.trim()).filter(Boolean) };
}

/** The Odoo address and database when it is connected. */
export async function odooReady() {
  const c = await config();
  return c ? `${new URL(c.url).host}${c.db ? ` · ${c.db}` : ''}` : null;
}

const STEP = 2000;
/** A read stopped because the sync's time is up; what was finished before it is kept. */
export class OutOfTime extends Error {}

export class Odoo {
  private mode: 'json2' | 'jsonrpc' | null = null;
  private uid: number | null = null;
  version = '';
  constructor(private c: OdooCfg) {}

  private async post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.c.url + path, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000), redirect: 'error',
    });
    const text = await res.text();
    let data: any = null; try { data = JSON.parse(text); } catch { /* an HTML error page */ }
    return { res, data };
  }

  private async rpc(service: string, method: string, args: unknown[]) {
    // the old API's two doors: logging in, and model calls, which call() has already checked are reads
    if (!(service === 'common' && method === 'authenticate') && !(service === 'object' && method === 'execute_kw' && typeof args[4] === 'string')) throw new Error('Refused: not a read.');
    if (service === 'object') assertOdooRead(String(args[3]), String(args[4]));
    const { res, data } = await this.post('/jsonrpc', { jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() });
    if (!res.ok || !data) throw new Error(`Odoo answered ${res.status}. Check the address.`);
    if (data.error) throw new Error(`Odoo: ${data.error.data?.message || data.error.message}`);
    return data.result;
  }

  /** Which API this server has, and its version. */
  async open() {
    if (this.mode) return;
    const { res, data } = await this.post('/web/webclient/version_info', { jsonrpc: '2.0', method: 'call', params: {}, id: 1 });
    if (!res.ok || !data?.result) throw new Error(res.status === 404 ? 'No Odoo at this address.' : `Odoo answered ${res.status}. Check the address.`);
    // Odoo Online reports versions such as 'saas~18.3': the major version is the first number
    const v = data.result.server_version_info || [], major = typeof v[0] === 'number' ? v[0] : Number(/\d+/.exec(String(v[0]))?.[0] || 0);
    this.version = String(data.result.server_version || v.join('.'));
    this.mode = major >= 19 ? 'json2' : 'jsonrpc';
  }

  private async login() {
    if (this.uid) return this.uid;
    if (!this.c.db) throw new Error('This Odoo version needs the database name. Enter it on the Admin page.');
    if (!this.c.login) throw new Error('This Odoo version needs the login (email) of the user the API key belongs to. Enter it on the Admin page.');
    const uid = await this.rpc('common', 'authenticate', [this.c.db, this.c.login, this.c.key, {}]);
    if (!uid) throw new Error('Odoo refused the login and API key. Check the database, login and key.');
    return (this.uid = uid as number);
  }

  /** Call a model's method with named arguments; `ids` are the records it acts on. */
  async call<T = any>(model: string, method: string, kw: Record<string, unknown> = {}, ids?: number[]): Promise<T> {
    assertOdooRead(model, method);
    await this.open();
    if (this.mode === 'json2') {
      const { res, data } = await this.post(`/json/2/${model}/${method}`, ids ? { ids, ...kw } : kw,
        { authorization: `bearer ${this.c.key}`, ...(this.c.db ? { 'x-odoo-database': this.c.db } : {}) });
      if (res.ok) return data as T;
      // a server that reports 19 but has the new API switched off or proxied away: use the old one
      if (res.status === 404 && !data) { this.mode = 'jsonrpc'; return this.call(model, method, kw, ids); }
      if (res.status === 401) throw new Error('Odoo refused the API key. Make a new key in Odoo (Preferences > Account Security) and save it again.');
      throw new Error(`Odoo ${model}.${method}: ${data?.message || data?.name || res.status}`);
    }
    const uid = await this.login();
    return this.rpc('object', 'execute_kw', [this.c.db, uid, this.c.key, model, method, ids ? [ids] : [], kw]) as Promise<T>;
  }

  /** The fields a model has, or null when the model is not installed or this user cannot read it. */
  async fields(model: string): Promise<Set<string> | null> {
    try { return new Set(Object.keys(await this.call<Record<string, unknown>>(model, 'fields_get', { attributes: ['type'] }))); } catch { return null; }
  }

  /** Every matching record, read in pages of 2,000 by id so nothing is skipped or read twice. */
  async all<T = any>(model: string, domain: unknown[], fields: string[], deadline: number, context: Record<string, unknown> = {}): Promise<T[]> {
    const out: T[] = []; let last = 0;
    for (;;) {
      const rows = await this.call<any[]>(model, 'search_read', { domain: [...domain, ['id', '>', last]], fields, limit: STEP, order: 'id asc', context });
      out.push(...rows);
      if (rows.length < STEP) return out;
      last = rows[rows.length - 1].id;
      if (Date.now() > deadline) throw new OutOfTime(`Ran out of time reading ${model}; the last good numbers are kept. The next sync carries on.`);
    }
  }
}

export async function odooClient() {
  const c = await config();
  if (!c) throw new Error('Odoo is not connected.');
  return new Odoo(c);
}

/** For the Admin page: reach Odoo with these details and list its warehouses and points of sale. */
export async function testOdoo(c: OdooCfg) {
  const o = new Odoo(c);
  await o.open();
  const wh = await o.call<{ name: string }[]>('stock.warehouse', 'search_read', { domain: [], fields: ['name'], limit: 50 });
  const pos = (await o.fields('pos.config')) ? await o.call<{ name: string }[]>('pos.config', 'search_read', { domain: [], fields: ['name'], limit: 50 }) : [];
  return { version: o.version, warehouses: wh.map(w => w.name), pos: pos.map(p => p.name) };
}

type Prod = { id: number; default_code: string | false; barcode: string | false; display_name: string };

/** Products by Odoo id, read in batches; archived ones too, since old sales point at them. */
async function products(o: Odoo, ids: number[], have: Map<number, Prod>) {
  const want = [...new Set(ids)].filter(id => !have.has(id));
  for (let i = 0; i < want.length; i += 500) {
    const rows = await o.call<Prod[]>('product.product', 'search_read',
      { domain: [['id', 'in', want.slice(i, i + 500)]], fields: ['default_code', 'barcode', 'display_name'], context: { active_test: false } });
    rows.forEach(r => have.set(r.id, r));
  }
  return have;
}

/** Write rows in batches, 1,000 at a time unless told otherwise. */
async function put(db: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + size), { onConflict });
    if (error) throw new Error(`Could not save ${table}: ${error.message}`);
  }
}

/**
 * Stock on hand in every warehouse, replacing the last copy, then each Shopify product's free stock across its SKUs.
 * The Odoo products behind the Shopify ones are listed even with nothing on hand, so a sold-out piece reads 0 instead
 * of falling back to Shopify's count.
 */
export async function syncOdooStock(db: SupabaseClient, deadline: number) {
  const o = await odooClient(), started = new Date().toISOString();
  // the Odoo products the Shopify products point at, so one of them with nothing on hand reads 0 rather than unknown;
  // asked for by SKU, since the whole Odoo catalogue is far larger than the online store
  const { data: shop } = await db.from('products').select('skus').neq('skus', '{}').limit(50000);
  const wanted = [...new Set((shop || []).flatMap(p => p.skus as string[]))];
  const catalog: Prod[] = [];
  for (let i = 0; i < wanted.length; i += 500) {
    const part = wanted.slice(i, i + 500);
    catalog.push(...await o.call<Prod[]>('product.product', 'search_read',
      { domain: ['|', ['default_code', 'in', part], ['barcode', 'in', part]], fields: ['default_code', 'barcode', 'display_name'], context: { active_test: false } }));
    if (Date.now() > deadline) throw new OutOfTime('Ran out of time matching Shopify products in Odoo; the last good stock is kept. The next sync tries again.');
  }
  const qf = await o.fields('stock.quant');
  const quants = await o.all<any>('stock.quant', [['location_id.usage', '=', 'internal']],
    ['product_id', 'quantity', 'reserved_quantity', ...(qf?.has('warehouse_id') ? ['warehouse_id'] : []), 'location_id'], deadline);

  const have = new Map(catalog.map(p => [p.id, p]));
  await products(o, quants.map(q => m2o(q.product_id)?.id).filter((x): x is number => !!x), have);
  const rows = new Map<string, { sku: string; warehouse: string; product: string; qty: number; reserved: number; updated_at: string }>();
  for (const p of catalog) { const sku = skuOf(p); rows.set(`${sku}|`, { sku, warehouse: '', product: p.display_name, qty: 0, reserved: 0, updated_at: started }); }
  for (const q of quants) {
    const pid = m2o(q.product_id)?.id; if (!pid) continue;
    const p = have.get(pid), sku = p ? skuOf(p) : `odoo:${pid}`;
    const wh = m2o(q.warehouse_id)?.name || m2o(q.location_id)?.name.split('/')[0] || 'Stock', k = `${sku}|${wh}`;
    const r = rows.get(k) || { sku, warehouse: wh, product: p?.display_name || m2o(q.product_id)!.name, qty: 0, reserved: 0, updated_at: started };
    r.qty += Number(q.quantity) || 0; r.reserved += Number(q.reserved_quantity) || 0; rows.set(k, r);
  }
  await put(db, 'odoo_stock', [...rows.values()], 'sku,warehouse', 5000);
  // whatever this read did not see is gone from Odoo
  const { error } = await db.from('odoo_stock').delete().lt('updated_at', started);
  if (error) throw new Error(`Could not clear old stock: ${error.message}`);
  const { data: matched, error: e2 } = await db.rpc('refresh_odoo_stock');
  if (e2) throw new Error(`Could not match stock to Shopify products: ${e2.message}`);
  const units = [...rows.values()].reduce((s, r) => s + r.qty, 0);
  return { skus: new Set([...rows.values()].map(r => r.sku)).size, units: Math.round(units), warehouses: new Set([...rows.values()].map(r => r.warehouse).filter(Boolean)).size, changed: Number(matched) || 0 };
}

/** Showroom names: each point of sale counts under its warehouse, so the counters of one showroom add up together. */
async function posBranches(o: Odoo) {
  const configs = await o.call<any[]>('pos.config', 'search_read', { domain: [], fields: ['name', 'picking_type_id'], context: { active_test: false } });
  const types = configs.map(c => m2o(c.picking_type_id)?.id).filter((x): x is number => !!x);
  const wh = types.length ? await o.call<any[]>('stock.picking.type', 'search_read', { domain: [['id', 'in', types]], fields: ['warehouse_id'], context: { active_test: false } }) : [];
  const whOf = new Map(wh.map(t => [t.id, m2o(t.warehouse_id)?.name]));
  return new Map(configs.map(c => [c.id as number, whOf.get(m2o(c.picking_type_id)?.id as number) || c.name as string]));
}

/** Sales from the showroom tills (Point of Sale) and from sales orders (the website and the other channels), for days from..to. */
async function readSales(o: Odoo, from: string, to: string, deadline: number, online: string[]) {
  const t = totals(), names = new Map<number, Prod>(), start = utcStart(from), end = utcStart(addDays(to, 1));
  const lines: { pid: number; day: string | null; branch: string; kind: string; units: number; revenue: number; order: number | null }[] = [];

  if (await o.fields('report.pos.order')) {
    const branch = await posBranches(o);
    const pos = await o.all<any>('report.pos.order', [['date', '>=', start], ['date', '<', end], ['state', 'not in', ['draft', 'cancel']]],
      ['date', 'config_id', 'product_id', 'product_qty', 'price_total', 'order_id'], deadline);
    for (const r of pos) {
      const pid = m2o(r.product_id)?.id, cfg = m2o(r.config_id); if (!pid) continue;
      lines.push({ pid, day: istDay(r.date), branch: (cfg && branch.get(cfg.id)) || cfg?.name || 'Point of Sale', kind: 'showroom', units: r.product_qty, revenue: r.price_total, order: m2o(r.order_id)?.id ?? null });
    }
  }

  const sf = await o.fields('sale.order');
  if (sf) {
    const extra = ['website_id', 'warehouse_id', 'team_id'].filter(f => sf.has(f));
    const orders = await o.all<any>('sale.order', [['date_order', '>=', start], ['date_order', '<', end], ['state', 'in', ['sale', 'done']]], ['date_order', ...extra], deadline);
    const byId = new Map(orders.map(x => [x.id as number, { day: istDay(x.date_order), ...orderBranch(x, online) }]));
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      const ls = await o.call<any[]>('sale.order.line', 'search_read',
        { domain: [['order_id', 'in', ids.slice(i, i + 500)], ['product_id', '!=', false]], fields: ['order_id', 'product_id', 'product_uom_qty', 'price_total'] });
      for (const l of ls) {
        const oid = m2o(l.order_id)?.id as number, x = byId.get(oid), pid = m2o(l.product_id)?.id; if (!x || !pid) continue;
        lines.push({ pid, day: x.day, branch: x.branch, kind: x.kind, units: l.product_uom_qty, revenue: l.price_total, order: oid });
      }
      if (Date.now() > deadline) throw new OutOfTime('Ran out of time reading sales orders; the last good numbers are kept. The next sync carries on.');
    }
  }

  await products(o, lines.map(l => l.pid), names);
  for (const l of lines) {
    const p = names.get(l.pid);
    t.add({ ...l, sku: p ? skuOf(p) : `odoo:${l.pid}`, product: p?.display_name || '' });
  }
  return t;
}

/** Replace the totals for days from..to with what was just read. */
async function writeSales(db: SupabaseClient, from: string, to: string, t: ReturnType<typeof totals>) {
  for (const table of ['odoo_branch_daily', 'odoo_sales_daily']) {
    const { error } = await db.from(table).delete().gte('day', from).lte('day', to);
    if (error) throw new Error(`Could not clear ${table}: ${error.message}`);
  }
  await put(db, 'odoo_branch_daily', t.branchRows(), 'day,branch');
  await put(db, 'odoo_sales_daily', t.lineRows(), 'day,branch,sku');
}

/**
 * Branch sales, a day at a time: the last three days every run, and 90 days back over the first runs. Each day is
 * written once all of it has been read, so a run cut short keeps every day it finished and the next one carries on.
 * The sync and the hourly catch-up both call this; a lease keeps them from reading the same days at once.
 */
export async function syncOdooSales(db: SupabaseClient, deadline: number) {
  const holder = randomUUID();
  const { data: got } = await db.rpc('acquire_job_lock', { p_name: 'odoo_sales', p_holder: holder, p_seconds: 300 });
  if (!got) return { days: 0, from: undefined as string | undefined, more: true, busy: true };
  try {
    const o = await odooClient(), c = (await config())!;
    const today = istDay(new Date().toISOString())!;
    const { data: saved } = await db.from('sync_cursors').select('state').eq('name', 'odoo_sales').maybeSingle();
    const st: { oldest?: string; newest?: string } = saved?.state || {};
    const { recent, back } = salesDays(today, st.oldest, st.newest);
    const keep = () => db.from('sync_cursors').upsert({ name: 'odoo_sales', state: st, updated_at: new Date().toISOString() });
    let days = 0, more = false;
    try {
      for (const day of [...recent, ...back]) {
        // leave the backfill for the next run when a day may not fit in the time left
        if (days && Date.now() > deadline - 20_000) { more = true; break; }
        const t = await readSales(o, day, day, deadline, c.online);
        await writeSales(db, day, day, t);
        if (recent.includes(day)) { st.newest = day; if (!st.oldest || day < st.oldest) st.oldest = day; } else st.oldest = day;
        days++;
        await keep();
      }
    } catch (e) { if (!(e instanceof OutOfTime)) throw e; more = true; }
    if (st.oldest && st.oldest > addDays(today, -89)) more = true;
    return { days, from: st.oldest, more, busy: false };
  } finally { await db.rpc('release_job_lock', { p_name: 'odoo_sales', p_holder: holder }); }
}
