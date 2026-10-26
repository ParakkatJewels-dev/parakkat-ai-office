import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOdooUrl, guessDb, istDay, utcStart, m2o, skuOf, orderBranch, totals, salesWindows } from '../src/lib/connectors/odoo-core.mjs';

test('the Odoo address is kept to https://host and plain http is refused', () => {
  assert.equal(normalizeOdooUrl('parakkat.odoo.com/odoo/action-123'), 'https://parakkat.odoo.com');
  assert.equal(normalizeOdooUrl(' https://erp.parakkat.in:8443/ '), 'https://erp.parakkat.in:8443');
  assert.equal(normalizeOdooUrl('http://erp.parakkat.in'), null);
  assert.equal(normalizeOdooUrl('https://user:pw@erp.parakkat.in'), null);
  assert.equal(normalizeOdooUrl('localhost'), null);
  assert.equal(guessDb('https://parakkat.odoo.com'), 'parakkat');
  assert.equal(guessDb('https://erp.parakkat.in'), '');
});

test('sales fall on the day in India, and windows start at midnight in India', () => {
  assert.equal(istDay('2026-10-25 18:29:59'), '2026-10-25');
  assert.equal(istDay('2026-10-25 18:30:00'), '2026-10-26');
  assert.equal(istDay('2026-10-25'), '2026-10-25');
  assert.equal(utcStart('2026-10-26'), '2026-10-25 18:30:00');
});

test('products match on the internal reference, then the barcode, then the Odoo id', () => {
  assert.equal(skuOf({ id: 7, default_code: ' PJ-R-1 ', barcode: '890' }), 'PJ-R-1');
  assert.equal(skuOf({ id: 7, default_code: false, barcode: '890' }), '890');
  assert.equal(skuOf({ id: 7, default_code: false, barcode: false }), 'odoo:7');
  assert.deepEqual(m2o([3, 'Kochi']), { id: 3, name: 'Kochi' });
  assert.equal(m2o(false), null);
});

test('website orders and teams named for the online store count as online', () => {
  assert.deepEqual(orderBranch({ website_id: [1, 'parakkatjewels.com'], team_id: [2, 'Website'] }), { branch: 'parakkatjewels.com', kind: 'online' });
  assert.deepEqual(orderBranch({ team_id: [5, 'Shopify Orders'] }), { branch: 'Shopify Orders', kind: 'online' });
  assert.deepEqual(orderBranch({ team_id: [6, 'D2C'] }, ['d2c']), { branch: 'D2C', kind: 'online' });
  assert.deepEqual(orderBranch({ team_id: [7, 'Corporate gifting'] }), { branch: 'Corporate gifting', kind: 'other' });
  assert.deepEqual(orderBranch({ team_id: false, warehouse_id: false }), { branch: 'Sales orders', kind: 'other' });
});

test('totals count each order once per branch and day', () => {
  const t = totals();
  t.add({ day: '2026-10-25', branch: 'Thrissur', kind: 'showroom', sku: 'R1', product: 'Ring', units: 1, revenue: 1000, order: 1 });
  t.add({ day: '2026-10-25', branch: 'Thrissur', kind: 'showroom', sku: 'N1', product: 'Necklace', units: 1, revenue: 5000.555, order: 1 });
  t.add({ day: '2026-10-25', branch: 'Thrissur', kind: 'showroom', sku: 'R1', product: 'Ring', units: 2, revenue: 2000, order: 2 });
  t.add({ day: null, branch: 'Thrissur', kind: 'showroom', sku: 'R1', product: 'Ring', units: 1, revenue: 1, order: 3 });
  assert.deepEqual(t.branchRows(), [{ day: '2026-10-25', branch: 'Thrissur', kind: 'showroom', orders: 2, revenue: 8000.56 }]);
  assert.deepEqual(t.lineRows().map(r => [r.sku, r.units, r.revenue]), [['R1', 3, 3000], ['N1', 1, 5000.56]]);
});

test('each sync reads the last three days, catches up a gap, and backfills 90 days a fortnight at a time', () => {
  const today = '2026-10-26';
  assert.deepEqual(salesWindows(today, null, null), [{ from: '2026-10-24', to: today }, { from: '2026-10-09', to: '2026-10-23' }]);
  assert.deepEqual(salesWindows(today, '2026-10-09', '2026-10-26'), [{ from: '2026-10-24', to: today }, { from: '2026-09-24', to: '2026-10-08' }]);
  // 90 days back is 2026-07-29: the last chunk stops there, then only the recent days are read
  assert.deepEqual(salesWindows(today, '2026-08-05', today)[1], { from: '2026-07-29', to: '2026-08-04' });
  assert.deepEqual(salesWindows(today, '2026-07-29', today), [{ from: '2026-10-24', to: today }]);
  // last read five days ago: start from there
  assert.deepEqual(salesWindows(today, '2026-07-29', '2026-10-21'), [{ from: '2026-10-21', to: today }]);
});
