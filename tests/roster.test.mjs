import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, PEOPLE, HUMAN_HEAD, teamLead, canSee } from '../src/office/roster.mjs';

test('every department has a human head and an AI team lead', () => {
  for (const r of ROOMS) {
    assert.ok(HUMAN_HEAD[r.id], `${r.id} has no human head`);
    if (r.id !== 'lead') assert.ok(teamLead(r.id), `${r.id} has no AI team lead`);
  }
});

test('seats are unique within each room', () => {
  const seen = new Set();
  for (const p of PEOPLE) { const k = `${p.room}:${p.seat}`; assert.ok(!seen.has(k), `two people in ${k}`); seen.add(k); }
});

test('the demo visibility rule matches the database rule', () => {
  assert.equal(canSee('creativeHead', { fromDept: 'warroom', toDept: 'creative' }), true);
  assert.equal(canSee('creativeHead', { fromDept: 'insights', toDept: 'strategy' }), false);
  assert.equal(canSee('superAdmin', { fromDept: 'insights', toDept: 'strategy' }), true);
});
