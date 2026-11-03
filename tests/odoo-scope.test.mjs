import test from 'node:test';
import assert from 'node:assert/strict';
import { odooBranchNames, includedOdooBranch, selectedOdooBranches, withoutOdooBranches } from '../src/lib/connectors/odoo-scope-core.mjs';

test('branch selection keeps exact Odoo labels and requires an included branch', () => {
  const choices = odooBranchNames(['PPWH', ' HOWH ', 'PPWH', 'Kochi, MG Road']);
  assert.deepEqual(choices, ['HOWH', 'Kochi, MG Road', 'PPWH']);
  assert.deepEqual(selectedOdooBranches(choices, ['PPWH']), ['HOWH', 'Kochi, MG Road']);
  assert.equal(includedOdooBranch('HOWH', ['HOWH']), false);
  assert.equal(includedOdooBranch('PPWH', ['HOWH']), true);
  assert.throws(() => selectedOdooBranches(choices, []), /Choose at least one/);
  assert.throws(() => selectedOdooBranches(choices, ['unknown']), /Choose at least one/);
});

test('sales and stock queries exclude exact labels with PostgREST quoting', () => {
  const calls = [];
  const query = { not(...args) { calls.push(args); return this; } };
  assert.equal(withoutOdooBranches(query, [], 'warehouse'), query);
  assert.equal(withoutOdooBranches(query, ['Kochi, MG Road', 'PPWH'], 'warehouse'), query);
  assert.deepEqual(calls, [['warehouse', 'in', '("Kochi, MG Road","PPWH")']]);
});
