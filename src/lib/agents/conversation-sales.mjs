// Product-level evidence for conversations. The passed client is always the requester's RLS client.
export const CONVERSATION_PRODUCT_LIMIT = 25;
const text = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : null;
const number = value => value == null || value === '' || !['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) ? null : Number(value);
const integer = value => {
  const n = number(value);
  if (n == null || !Number.isInteger(n)) return null;
  return Number.isSafeInteger(n) ? n : typeof value === 'string' && /^-?\d+$/.test(value) ? value : null;
};
const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

export function conversationSalesWindows(now = new Date()) {
  // The sales table is bucketed by Shopify's UTC createdAt date. Anchoring to IST would ask for a
  // future UTC bucket after local midnight and silently drop the earliest of the seven started days.
  const to = now.toISOString().slice(0, 10);
  const from = days => new Date(Date.parse(`${to}T12:00:00Z`) - (days - 1) * 864e5).toISOString().slice(0, 10);
  const completeTo = new Date(Date.parse(`${to}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const completeFrom = new Date(Date.parse(`${completeTo}T12:00:00Z`) - 29 * 864e5).toISOString().slice(0, 10);
  return { sevenDays: { from: from(7), to }, thirtyDays: { from: from(30), to }, completeThirtyDays: { from: completeFrom, to: completeTo }, observedAt: now.toISOString() };
}

// Only select a focused category when the manager asks for a sales ranking.
// Product types are exact Shopify categories; "Earrings" must not match "Ring".
const salesCategories = [
  [/\brings?\b/i, 'Ring'], [/\bearrings?\b/i, 'Earrings'],
  [/\bnecklaces?\b/i, 'Necklace'], [/\bpendants?\b/i, 'Pendant'],
  [/\bbangles?\b/i, 'Bangle'], [/\bbracelets?\b/i, 'Bracelet'],
  [/\bchains?\b/i, 'Chain'], [/\banklets?\b/i, 'Anklet'],
];
export function requestedSalesCategory(request) {
  const text = String(request || '');
  if (!/\b(?:top|best|most|selling|sellers?|sold|sales)\b/i.test(text)) return null;
  return salesCategories.find(([pattern]) => pattern.test(text))?.[1] || null;
}

/** Read all recorded rows before ranking within a Shopify product type. */
export async function conversationCategorySales(reader, signal, window, observedAt, category, limit = 12) {
  const coverage = { ...salesCoverage(window, observedAt), category,
    category_rule: 'Exact Shopify product_type, not a title substring.',
    ranking_rule: 'All recorded sales rows in the complete UTC window are aggregated before the category filter and row limit.',
    image_rule: 'image_url is the latest Shopify-synced featured image URL; missing images remain unknown.' };
  const unavailable = state => ({ available: false, state, observed_at: observedAt, coverage, data: [] });
  try {
    const orders = [];
    for (let offset = 0; offset <= 5000; offset += 1000) {
      const { data, error } = await reader.from('orders_daily').select('day,product_id,units,revenue')
        .gte('day', window.from).lte('day', window.to).order('day').order('product_id')
        .range(offset, offset + 999).abortSignal(signal);
      if (error || !Array.isArray(data)) return unavailable('sales_unavailable');
      orders.push(...data);
      if (data.length < 1000) break;
      if (offset === 5000) return unavailable('sales_exceeds_safe_read_limit');
    }
    const ids = [...new Set(orders.map(row => String(row.product_id)))];
    const products = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await reader.from('product_stock')
        .select('id,title,product_type,status,price,stock,stock_source,image_url,updated_at')
        .in('id', ids.slice(offset, offset + 100)).abortSignal(signal);
      if (error || !Array.isArray(data)) return unavailable('catalogue_unavailable');
      products.push(...data);
    }
    const byId = new Map(products.map(row => [String(row.id), row]));
    const unmatched = ids.filter(id => !byId.has(id)).length;
    const sold = new Map();
    for (const row of orders) {
      const id = String(row.product_id), product = byId.get(id);
      if (product?.product_type !== category) continue;
      const value = sold.get(id) || { product, units: 0, revenue: 0, last_sale_day: null };
      value.units += Number(row.units) || 0;
      value.revenue += Number(row.revenue) || 0;
      if (!value.last_sale_day || row.day > value.last_sale_day) value.last_sale_day = row.day;
      sold.set(id, value);
    }
    const ranked = [...sold.entries()].map(([id, value]) => ({
      product_id: id, title: text(value.product.title), product_type: category,
      status: text(value.product.status, 40), price: number(value.product.price),
      units: integer(value.units), revenue: number(value.revenue), stock: integer(value.product.stock),
      stock_source: value.product.stock == null ? null : ['odoo', 'shopify'].includes(value.product.stock_source) ? value.product.stock_source : null,
      image_url: text(value.product.image_url, 1000), last_sale_day: isoDay(value.last_sale_day),
      product_updated_at: text(value.product.updated_at, 40),
    })).sort((a, b) => b.units - a.units || b.revenue - a.revenue || Number(a.product_id) - Number(b.product_id));
    return { available: unmatched === 0, state: unmatched ? 'catalogue_join_incomplete' : ranked.length ? 'recorded_sales' : 'no_recorded_rows',
      observed_at: observedAt, coverage,
      summary: { recorded_days: new Set(orders.map(row => row.day)).size, recorded_sales_rows: orders.length,
        sold_products_in_category: ranked.length, unmatched_catalogue_products: unmatched,
        note: 'A successful Shopify sync reads its order window before saving totals; recorded days alone do not prove source completeness.' },
      sample: { limit, shown: Math.min(limit, ranked.length), truncated: ranked.length > limit,
        top_rank_complete: unmatched === 0,
        order: 'Within exact category: recorded units descending, then revenue descending, then product ID',
        note: 'The displayed top ranks are exact for recorded rows, even when lower ranks are omitted. Exclude inactive or nonpositive-stock products from an available-to-promote shortlist.' },
      data: ranked.slice(0, limit) };
  } catch {
    signal?.throwIfAborted?.();
    return unavailable('source_unavailable');
  }
}

const salesCoverage = (window, observedAt) => ({
  source: 'Shopify orders_daily, joined to recorded product stock',
  date_from_inclusive: window.from,
  date_to_inclusive: window.to,
  date_buckets: 'UTC dates from Shopify order createdAt, not IST-calendar-day totals',
  current_day_partial: window.from <= observedAt.slice(0, 10) && window.to >= observedAt.slice(0, 10),
  completeness: 'Only recorded synced sales are included. A missing product or day is not evidence of zero sales; sync completeness is not verified.',
  stock_note: 'Stock is the latest recorded snapshot, not live stock or stock at sale time. Odoo matched free stock takes precedence; Shopify is a fallback. Null means unknown; an explicit 0 is recorded zero. product_updated_at is a product update, not a stock-sync timestamp.',
});

export function normalizeConversationSales(result, window, observedAt, limit = CONVERSATION_PRODUCT_LIMIT) {
  const coverage = salesCoverage(window, observedAt);
  if (result?.error || !Array.isArray(result?.data)) return { available: false, state: 'unavailable', observed_at: observedAt, coverage, data: [] };
  const rows = result.data, first = rows[0];
  const matching = integer(first?.window_product_count);
  const totalUnits = integer(first?.window_units);
  const shown = rows.slice(0, limit).map(row => ({
    product_id: row.product_id == null ? null : String(row.product_id),
    title: text(row.title), product_type: text(row.product_type), status: text(row.status, 40), price: number(row.price),
    units: integer(row.units), revenue: number(row.revenue), stock: integer(row.stock),
    stock_source: row.stock == null ? null : ['odoo', 'shopify'].includes(row.stock_source) ? row.stock_source : null,
    last_sale_day: isoDay(row.last_sale_day), product_updated_at: text(row.product_updated_at, 40),
  }));
  return {
    available: true, state: rows.length ? 'recorded_sales' : 'no_recorded_rows', observed_at: observedAt, coverage,
    summary: { units_all_recorded_products: totalUnits, product_count_all_recorded_sales: matching,
      first_recorded_day: isoDay(first?.window_first_recorded_day), last_recorded_day: isoDay(first?.window_last_recorded_day),
      note: 'Totals cover all recorded products in this date window before the row limit; they are not totals of only the displayed sample. Observed day bounds do not prove all intervening days were synced.' },
    sample: { limit, shown: shown.length, truncated: rows.length > limit || (typeof matching === 'number' && matching > shown.length),
      order: 'Recorded units descending, then revenue descending, then product ID',
      note: 'Products absent from these top rows must not be assigned zero demand or zero stock.' },
    data: shown,
  };
}

export async function conversationProductSales(reader, signal, window, observedAt) {
  let result;
  try {
    result = await reader.rpc('conversation_product_sales', { p_from: window.from, p_to: window.to, p_limit: CONVERSATION_PRODUCT_LIMIT + 1 }).abortSignal(signal);
  } catch { result = { error: true }; }
  return normalizeConversationSales(result, window, observedAt);
}

export async function conversationProductCatalog(reader, signal, observedAt) {
  const coverage = 'Up to 25 most recently updated active products, accepting Shopify ACTIVE and legacy active. This is a catalogue sample, not a sales ranking. Product updated_at is not the stock-sync time. Missing rows do not mean no products or zero stock; null stock is unknown.';
  try {
    const { data, error } = await reader.from('product_stock')
      .select('id, title, product_type, price, status, inventory, odoo_stock, stock, stock_source, updated_at')
      .in('status', ['active', 'ACTIVE']).order('updated_at', { ascending: false }).order('id')
      .limit(CONVERSATION_PRODUCT_LIMIT + 1).abortSignal(signal);
    if (error || !Array.isArray(data)) return { available: false, state: 'unavailable', observed_at: observedAt, coverage, data: [] };
    return { available: true, state: data.length ? 'catalogue_sample' : 'no_recorded_rows', observed_at: observedAt, coverage,
      sample: { limit: CONVERSATION_PRODUCT_LIMIT, shown: Math.min(data.length, CONVERSATION_PRODUCT_LIMIT), truncated: data.length > CONVERSATION_PRODUCT_LIMIT },
      data: data.slice(0, CONVERSATION_PRODUCT_LIMIT).map(row => ({
        id: String(row.id), title: text(row.title), product_type: text(row.product_type), price: number(row.price), status: text(row.status, 40),
        stock: integer(row.stock), stock_source: row.stock == null ? null : ['odoo', 'shopify'].includes(row.stock_source) ? row.stock_source : null,
        shopify_inventory: integer(row.inventory), odoo_free_stock: integer(row.odoo_stock), product_updated_at: text(row.updated_at, 40),
      })) };
  } catch { return { available: false, state: 'unavailable', observed_at: observedAt, coverage, data: [] }; }
}
