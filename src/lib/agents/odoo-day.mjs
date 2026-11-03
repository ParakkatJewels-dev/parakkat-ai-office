import { addDays, istDay } from '../connectors/odoo-core.mjs';
import { odooBranchNames, withoutOdooBranches } from '../connectors/odoo-scope-core.mjs';

const CHARGE = /^(?:\[[^\]]+\]\s*)?(?:service charge|shipping(?: charge)?|delivery charge|gift wrap)(?:\b|$)/i;
const LIMIT = 5000;

/** Select the recorded Odoo day when a request needs a product and its sales branch. */
export function odooDayIntent(request) {
  const text = String(request || '');
  return /\b(?:products?|skus?|items?|best[ -]?sell(?:ing|ers?)?|top[ -]?sell(?:ing|ers?)?)\b/i.test(text)
    && /\b(?:sell(?:ing)?|sales|sold|revenue|units|branch|showroom|store|today|todays|today's|yesterday|odoo)\b/i.test(text)
    && /\b(?:today|todays|today's|yesterday|branch|showroom|odoo)\b/i.test(text);
}

export function odooDayForRequest(request, now = new Date()) {
  const today = istDay(now.toISOString());
  return /\byesterday\b/i.test(String(request || '')) ? addDays(today, -1) :
    /\b(?:today|todays|today's)\b/i.test(String(request || '')) ? today : addDays(today, -1);
}

export function summarizeOdooDay(rows, { day, observedAt, cursor, syncedAt, limit = 8 }) {
  const grouped = new Map(), excluded = new Set();
  for (const row of rows) {
    const sku = String(row.sku || '').trim(), product = String(row.product || '').trim();
    if (!sku || !product || !row.branch || !Number.isFinite(Number(row.units)) || !Number.isFinite(Number(row.revenue))) continue;
    if (CHARGE.test(product)) { excluded.add(sku); continue; }
    const item = grouped.get(sku) || { sku, product, units: 0, revenue: 0, branches: new Map() };
    item.units += Number(row.units); item.revenue += Number(row.revenue);
    const branch = item.branches.get(row.branch) || { branch: row.branch, units: 0, revenue: 0 };
    branch.units += Number(row.units); branch.revenue += Number(row.revenue);
    item.branches.set(row.branch, branch); grouped.set(sku, item);
  }
  const ranked = [...grouped.values()].map(item => ({ sku: item.sku, product: item.product,
    units: Math.round(item.units * 100) / 100, revenue: Math.round(item.revenue * 100) / 100,
    branches: [...item.branches.values()].map(branch => ({ ...branch, units: Math.round(branch.units * 100) / 100, revenue: Math.round(branch.revenue * 100) / 100 }))
      .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.branch.localeCompare(b.branch)) }))
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.sku.localeCompare(b.sku));
  const posIncluded = /\bsales orders and POS\b/i.test(cursor?.coverage || '');
  const currentDay = day === istDay(observedAt);
  const covered = !!cursor?.oldest && !!cursor?.newest && cursor.oldest <= day && cursor.newest >= day
    && !(cursor.pending || []).some(window => window?.from <= day && window?.to >= day);
  const recordedDay = covered || (!cursor && rows.length > 0);
  return { available: recordedDay, state: !recordedDay ? 'day_not_synced' : ranked.length ? 'recorded_sales' : 'no_recorded_rows',
    observed_at: observedAt,
    coverage: { source: cursor ? 'Odoo sale.order lines grouped by product SKU and order branch' : 'Recorded Odoo sales lines grouped by product SKU and order branch', day, time_zone: 'Asia/Kolkata',
      last_sales_sync: syncedAt || null, current_day_partial: currentDay,
      channels: cursor?.coverage || 'Odoo channel coverage unknown to this requester',
      business_wide_rank_supported: posIncluded && !currentDay,
      branch_rule: 'Branch is the Odoo order website, sales team or warehouse label; a warehouse code is not a verified showroom name.',
      ranking_rule: 'All recorded rows for the selected day are grouped by SKU, ranked by units then revenue. Recognized service and delivery charges are excluded.',
      completeness: 'The cursor confirms a committed day, not complete source coverage. POS or other channels may be absent. Shopify may overlap Odoo; do not add their totals.' },
    summary: { day, time_zone: 'Asia/Kolkata', recorded_rows: rows.length, recorded_products: ranked.length,
      excluded_charge_skus: excluded.size, leader: ranked[0] || null,
      interpretation: !cursor ? 'Leader among recorded Odoo lines only; channel coverage is unknown, so the whole-business leader is unknown.'
        : posIncluded ? currentDay ? 'Latest recorded sales as of the sync; today is still in progress.' : 'Recorded Odoo sales, subject to source completeness.'
        : 'Leader among Odoo sales orders only; showroom POS is unavailable, so the whole-business leader is unknown.' },
    sample: { limit, shown: Math.min(limit, ranked.length), truncated: ranked.length > limit,
      order: 'Recorded units descending, then revenue descending, then SKU', top_rank_complete: recordedDay },
    data: ranked.slice(0, limit) };
}

/** A complete bounded day read through the caller's existing RLS client. */
export async function readOdooDay(reader, signal, request, observedAt = new Date().toISOString(), excludedBranches = []) {
  const day = odooDayForRequest(request, new Date(observedAt));
  const excluded = odooBranchNames(excludedBranches);
  const unavailable = (state, cursor = null, syncedAt = null) => ({ available: false, state, observed_at: observedAt,
    coverage: { source: 'Odoo product sales by branch', day, time_zone: 'Asia/Kolkata', channels: cursor?.coverage || 'unknown', last_sales_sync: syncedAt }, data: [] });
  try {
    const cursorRead = await reader.from('sync_cursors').select('state,updated_at').eq('name', 'odoo_sales').abortSignal(signal).maybeSingle();
    const cursor = cursorRead.error || !cursorRead.data ? null : cursorRead.data.state;
    let syncedAt = cursorRead.error || !cursorRead.data ? null : cursorRead.data.updated_at;
    if (!cursor) {
      const connection = await reader.from('connections').select('last_synced_at').eq('provider', 'odoo').abortSignal(signal).maybeSingle();
      if (!connection.error) syncedAt = connection.data?.last_synced_at || null;
    }
    const counted = await withoutOdooBranches(reader.from('odoo_sales_daily').select('sku', { count: 'exact', head: true }).eq('day', day), excluded).abortSignal(signal);
    if (counted.error || counted.count == null) return unavailable('sales_unavailable', cursor, syncedAt);
    if (counted.count > LIMIT) return unavailable('sales_exceeds_safe_read_limit', cursor, syncedAt);
    const rows = [];
    for (let offset = 0; offset < counted.count; offset += 1000) {
      const { data, error } = await withoutOdooBranches(reader.from('odoo_sales_daily').select('day,branch,sku,product,units,revenue')
        .eq('day', day).order('sku').order('branch').range(offset, offset + 999), excluded).abortSignal(signal);
      if (error || !Array.isArray(data)) return unavailable('sales_unavailable', cursor, syncedAt);
      rows.push(...data);
    }
    if (rows.length !== counted.count) return unavailable('sales_changed_during_read', cursor, syncedAt);
    if (cursor) {
      const checked = await reader.from('sync_cursors').select('state,updated_at').eq('name', 'odoo_sales').abortSignal(signal).maybeSingle();
      if (checked.error || checked.data?.updated_at !== syncedAt) return unavailable('sales_changed_during_read', cursor, syncedAt);
    }
    const summary = summarizeOdooDay(rows, { day, observedAt, cursor, syncedAt });
    summary.coverage.excluded_branches = excluded;
    return summary;
  } catch (error) {
    signal?.throwIfAborted?.();
    return unavailable('source_unavailable');
  }
}
