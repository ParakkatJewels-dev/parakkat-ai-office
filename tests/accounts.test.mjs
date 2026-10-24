// Several ad accounts per platform, and labels that tell same-named accounts apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosen, googleId, googleLabel, googleTargets, metaAdLabel, pageLabel } from '../src/lib/connectors/accounts.mjs';

test('ids are shown the way each platform shows them', () => {
  assert.equal(googleId('9319022443'), '931-902-2443');
  assert.equal(googleId('931-902-2443'), '931-902-2443');
  assert.equal(metaAdLabel({ id: 'act_123', name: 'Parakkat Jewels' }), 'Parakkat Jewels · 123');
  assert.equal(pageLabel({ id: '55', name: 'Parakkat', ig_name: 'parakkatjewels' }), 'Parakkat · 55 · @parakkatjewels');
});

test('the list wins over the single id saved before, and typed lists split on commas', () => {
  assert.deepEqual(chosen(['1', '2'], '9'), ['1', '2']);
  assert.deepEqual(chosen([], '9'), ['9']);
  assert.deepEqual(chosen(null, '1, 2,,1'), ['1', '2']);
  assert.deepEqual(chosen(undefined, undefined), []);
});

test('two managers with the same name are told apart by id, and each account goes through its own manager', () => {
  const list = [
    { id: '1111111111', name: 'Parakkat Jewels', manager: true },
    { id: '2222222222', name: 'Parakkat Jewels', manager: true },
    { id: '3333333333', name: 'Parakkat Nature Resort', manager: false, via: '2222222222' },
    { id: '4444444444', name: 'Parakkat Jewels', manager: false },
  ];
  assert.notEqual(googleLabel(list[0], list), googleLabel(list[1], list));
  assert.equal(googleLabel(list[2], list), 'Parakkat Nature Resort · 333-333-3333 · via Parakkat Jewels (222-222-2222)');
  assert.deepEqual(googleTargets(['333-333-3333', '4444444444'], list, '1111111111'),
    [{ id: '3333333333', login: '2222222222' }, { id: '4444444444', login: '1111111111' }]);
  assert.deepEqual(googleTargets(['4444444444'], list), [{ id: '4444444444', login: undefined }]);
});
