import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationCategorySales, conversationProductCatalog, conversationProductSales, conversationSalesWindows, normalizeConversationSales, requestedSalesCategory } from '../src/lib/agents/conversation-sales.mjs';

const window = { from: '2026-10-20', to: '2026-10-26' }, observedAt = '2026-10-26T09:00:00.000Z';
const row = (id, extra = {}) => ({ product_id: id, title: `Product ${id}`, status: 'ACTIVE', units: 6, revenue: 1200, stock: 724, stock_source: 'odoo', last_sale_day: '2026-10-26', window_units: 174, window_product_count: 50, window_first_recorded_day: '2026-10-20', window_last_recorded_day: '2026-10-26', ...extra });

test('conversation sales requests inclusive bounded windows through the supplied reader client', async () => {
  const signal = new AbortController().signal, calls = [];
  const reader = { rpc(name, args) { calls.push({ name, args }); return { abortSignal(received) { assert.equal(received, signal); return Promise.resolve({ data: [row(1)] }); } }; } };
  const evidence = await conversationProductSales(reader, signal, window, observedAt);
  assert.deepEqual(calls, [{ name: 'conversation_product_sales', args: { p_from: '2026-10-20', p_to: '2026-10-26', p_limit: 26 } }]);
  assert.equal(evidence.data[0].units, 6);
  assert.equal(evidence.data[0].stock, 724);
  assert.equal(evidence.summary.units_all_recorded_products, 174);
  assert.match(evidence.coverage.date_buckets, /UTC/);
  assert.equal(evidence.coverage.current_day_partial, true);
});

test('truncated product rows retain full-window totals and do not present the sample as all demand', () => {
  const evidence = normalizeConversationSales({ data: Array.from({ length: 26 }, (_, i) => row(i)) }, window, observedAt);
  assert.equal(evidence.data.length, 25);
  assert.equal(evidence.sample.truncated, true);
  assert.equal(evidence.summary.product_count_all_recorded_sales, 50);
  assert.equal(evidence.summary.units_all_recorded_products, 174, 'the aggregate must not be recomputed from the 25 sample rows');
  assert.match(evidence.sample.note, /must not be assigned zero/);
});

test('missing products and unknown stock remain distinct from an explicit recorded zero', () => {
  const evidence = normalizeConversationSales({ data: [
    row(1, { stock: 0, stock_source: 'odoo' }),
    row(2, { stock: null, stock_source: null }),
    row(3, { title: null, status: null, stock: null, stock_source: null }),
  ] }, window, observedAt);
  assert.equal(evidence.data[0].stock, 0); assert.equal(evidence.data[0].stock_source, 'odoo');
  assert.equal(evidence.data[1].stock, null); assert.equal(evidence.data[1].stock_source, null);
  assert.equal(evidence.data[2].title, null); assert.equal(evidence.data[2].units, 6, 'sales survive a missing catalogue join');
});

test('failed evidence and a successful empty query are distinguishable and neither invents zero demand', () => {
  const absent = normalizeConversationSales({ data: [] }, window, observedAt);
  const failed = normalizeConversationSales({ data: null, error: { message: 'private upstream error' } }, window, observedAt);
  assert.equal(absent.available, true); assert.equal(absent.state, 'no_recorded_rows');
  assert.equal(absent.summary.units_all_recorded_products, null);
  assert.equal(failed.available, false); assert.equal(failed.state, 'unavailable');
  assert.ok(!JSON.stringify(failed).includes('private upstream error'));
});

test('a sparse recorded period is disclosed without treating unsynced days as zero', () => {
  const evidence = normalizeConversationSales({ data: [row(1)] }, { from: '2026-09-27', to: '2026-10-26' }, observedAt);
  assert.equal(evidence.coverage.date_from_inclusive, '2026-09-27');
  assert.equal(evidence.summary.first_recorded_day, '2026-10-20');
  assert.match(evidence.summary.note, /do not prove all intervening days were synced/);
  assert.equal(normalizeConversationSales({ data: [row(1)] }, { from: '2026-09-01', to: '2026-09-30' }, observedAt).coverage.current_day_partial, false);
});

test('source windows stay on seven started UTC days even after midnight in Kerala', () => {
  const windows = conversationSalesWindows(new Date('2026-10-26T22:00:00Z'));
  assert.deepEqual(windows.sevenDays, { from: '2026-10-20', to: '2026-10-26' });
  assert.deepEqual(windows.thirtyDays, { from: '2026-09-27', to: '2026-10-26' });
  assert.deepEqual(windows.completeThirtyDays, { from: '2026-09-26', to: '2026-10-25' });
  assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(windows.observedAt)), '2026-10-27', 'local presentation stays separate from the source bucket date');
});

test('category sales ranks all recorded Ring rows before limiting and includes stock and Shopify images', async () => {
  assert.equal(requestedSalesCategory('Find five top selling rings for a carousel'), 'Ring');
  assert.equal(requestedSalesCategory('Write a ring headline'), null);
  const sales = Array.from({ length: 30 }, (_, i) => ({ day: '2026-10-25', product_id: i + 1, units: i < 24 ? 10 : 8 - (i - 24), revenue: i < 24 ? 1000 : (8 - (i - 24)) * 100 }));
  const products = sales.map((x, i) => ({ id: x.product_id, product_type: i < 24 ? 'Earrings' : 'Ring', title: `Product ${i + 1}`, status: 'ACTIVE', price: 100, stock: i === 24 ? 0 : 5, stock_source: 'odoo', image_url: `https://cdn.shopify.com/${i + 1}.jpg` }));
  const calls = [];
  const reader = { from(table) { calls.push(table); return {
    select() { return this; }, gte() { return this; }, lte() { return this; }, order() { return this; }, range() { return this; }, in() { return this; },
    abortSignal() { return Promise.resolve({ data: table === 'orders_daily' ? sales : products }); },
  }; } };
  const result = await conversationCategorySales(reader, new AbortController().signal, { from: '2026-09-26', to: '2026-10-25' }, observedAt, 'Ring', 5);
  assert.equal(result.available, true);
  assert.equal(result.summary.sold_products_in_category, 6);
  assert.equal(result.sample.top_rank_complete, true);
  assert.equal(result.data.length, 5);
  assert.equal(result.data[0].product_id, '25');
  assert.equal(result.data[0].stock, 0);
  assert.equal(result.data[0].image_url, 'https://cdn.shopify.com/25.jpg');
  assert.deepEqual(calls, ['orders_daily', 'product_stock']);
});

test('catalogue accepts both Shopify status forms and uses preferred stock without overwriting zero or null', async () => {
  const calls = [], signal = new AbortController().signal;
  const rows = [
    { id: 1, status: 'ACTIVE', inventory: 999, odoo_stock: 0, stock: 0, stock_source: 'odoo' },
    { id: 2, status: 'active', inventory: 5, odoo_stock: null, stock: 5, stock_source: 'shopify' },
    { id: 3, status: 'ACTIVE', inventory: null, odoo_stock: null, stock: null, stock_source: 'shopify' },
  ];
  const builder = {
    select() { return this; }, in(field, values) { calls.push({ field, values }); return this; }, order() { return this; },
    limit(n) { assert.equal(n, 26); return this; }, abortSignal(value) { assert.equal(value, signal); return Promise.resolve({ data: rows }); },
  };
  const reader = { from(name) { assert.equal(name, 'product_stock'); return builder; } };
  const evidence = await conversationProductCatalog(reader, signal, observedAt);
  assert.deepEqual(calls, [{ field: 'status', values: ['active', 'ACTIVE'] }]);
  assert.equal(evidence.data[0].stock, 0); assert.equal(evidence.data[0].shopify_inventory, 999);
  assert.equal(evidence.data[1].stock, 5); assert.equal(evidence.data[1].stock_source, 'shopify');
  assert.equal(evidence.data[2].stock, null); assert.equal(evidence.data[2].stock_source, null);
  assert.match(evidence.coverage, /not the stock-sync time/);
});
