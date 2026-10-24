// The festival calendar the CMO's daily planner reads, and how it avoids opening the same campaign twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OCCASIONS, upcoming, covered } from '../src/lib/agents/occasions.mjs';
import { errText } from '../src/lib/errors.ts';

test('occasions ahead come soonest first, and planning is due inside each lead time', () => {
  const next = upcoming(new Date('2026-10-24T06:00:00Z'), 60);
  assert.equal(next[0].name, 'Dhanteras'); assert.equal(next[0].left, 13); assert.ok(next[0].due);
  assert.ok(next.every((o, i) => i === 0 || o.left >= next[i - 1].left));
  assert.ok(!next.some(o => o.name === 'Christmas'), 'Christmas is 62 days out, outside 60');
  assert.ok(!next.find(o => o.name === 'Valentine\'s Day'));
  assert.ok(OCCASIONS.every(o => !isNaN(Date.parse(o.date))));
});

test('a campaign already open for an occasion counts as covering it', () => {
  assert.ok(covered('Dhanteras gold coins', ['Dhanteras 2026 campaign']));
  assert.ok(covered('Diwali gifting edit', ['diwali gold edit']));
  assert.ok(!covered('Dhanteras gold coins', ['Onam kasavu collection', 'Wedding season bridal']));
  assert.ok(!covered('Kerala wedding season', ['Kerala Onam campaign']), 'shared filler words do not count');
});

test('Supabase errors read as their message, not [object Object]', () => {
  assert.equal(errText({ message: 'null value in column "rising"', code: '23502' }), 'null value in column "rising" (23502)');
  assert.equal(errText(new Error('boom')), 'boom');
  assert.equal(errText({ foo: 1 }), '{"foo":1}');
});
