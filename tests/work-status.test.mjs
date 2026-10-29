import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkStatuses, agentWorkStatus, layoutWorkStatuses } from '../src/office/work-status.mjs';

const person = overrides => ({ id: 'sales', status: 'idle', task: 'Waiting for the next job', path: [], bubble: null, ...overrides });
const work = { state: 'working', label: 'Reviewing sales evidence', expiresAt: 20_000 };

test('authoritative snapshots clear omitted, idle, invalid, unknown and expired entries', () => {
  const result = normalizeWorkStatuses({
    sales: work, unknown: work,
    idle: { ...work, state: 'idle' }, old: { ...work, expiresAt: 500 }, invalid: { ...work, expiresAt: 'bad' }, empty: { ...work, label: '  ' },
  }, ['sales', 'idle', 'old', 'invalid', 'empty'], 1_000);
  assert.deepEqual(Object.keys(result), ['sales']);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.deepEqual(Object.keys(normalizeWorkStatuses({}, ['sales'], 1_000)), []);
});

test('server labels are bounded and leases default or cap safely', () => {
  const result = normalizeWorkStatuses({
    a: { state: 'working', label: '💎'.repeat(200) },
    b: { state: 'waiting', label: 'Waiting\n  for a response', expiresAt: 9_999_999 },
    c: { state: 'blocked', label: 'Provider unavailable', expiresAt: new Date(30_000).toISOString() },
  }, ['a', 'b', 'c'], 1_000);
  assert.equal(Array.from(result.a.label).length, 160);
  assert.equal(result.a.expiresAt, 61_000);
  assert.equal(result.b.expiresAt, 301_000);
  assert.equal(result.b.label, 'Waiting for a response');
  assert.equal(result.c.expiresAt, 30_000);
});

test('real work persists when short speech finishes and disappears exactly at lease expiry', () => {
  assert.equal(agentWorkStatus(person(), work, 1_000).label, work.label);
  const talking = agentWorkStatus(person({ bubble: 'Here are the findings', status: 'talking' }), work, 2_000);
  assert.equal(talking.speech, 'Here are the findings');
  assert.equal(talking.workLabel, work.label);
  assert.equal(agentWorkStatus(person(), work, 19_999).source, 'server');
  assert.equal(agentWorkStatus(person(), work, 20_000), null);
});

test('old thinking flags, recent activity, and stale task descriptions do not imply current work', () => {
  for (const status of ['idle', 'thinking', 'talking', 'walking']) {
    assert.equal(agentWorkStatus(person({ status, task: 'Analyzing yesterday’s report', active: Date.now() }), null, 1_000), null);
  }
});

test('local walking takes precedence while preserving the actual server task', () => {
  const result = agentWorkStatus(person({ path: [{ x: 1, z: 2 }], task: 'Visiting the Sales Analyst' }), work, 1_000);
  assert.equal(result.state, 'walking');
  assert.equal(result.source, 'movement');
  assert.equal(result.label, 'Visiting the Sales Analyst');
  assert.equal(result.workLabel, work.label);
});

test('waiting visits and explicit meetings remain visible without invented progress or speech', () => {
  for (const [field, source] of [['visitId', 'visit'], ['meetingId', 'meeting']]) {
    const result = agentWorkStatus(person({ [field]: 'actual-session', status: 'waiting', task: 'Conversation with Sales Analyst' }), null, 1_000);
    assert.equal(result.state, 'waiting'); assert.equal(result.source, source); assert.equal(result.speech, '');
    assert.equal(result.workLabel, '');
  }
  const pending = agentWorkStatus(person({ quest: true }), null, 1_000);
  assert.equal(pending.label, 'Waiting for approval');
});

test('an expired backend lease cannot hide an actual walk or revive when the walk ends', () => {
  assert.equal(agentWorkStatus(person({ path: [{ x: 0, z: 1 }], task: 'Returning to the desk' }), work, 30_000).state, 'walking');
  assert.equal(agentWorkStatus(person({ task: 'Returning to the desk' }), work, 30_000), null);
});

const overlap = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
test('status placement keeps every active agent, including more than the former speech limit', () => {
  const items = Array.from({ length: 18 }, (_, i) => ({ id: `agent-${i}`, x: 80 + (i % 6) * 145, y: 190 + Math.floor(i / 6) * 150, w: 130, h: 45 }));
  const placed = layoutWorkStatuses(items, { width: 1_000, height: 700 });
  assert.equal(placed.length, 18);
  assert.deepEqual(placed.map(p => p.id), items.map(p => p.id));
  for (const p of placed) {
    assert.ok(p.x - p.w / 2 >= 6); assert.ok(p.x + p.w / 2 <= 994);
    assert.ok(p.y - p.h / 2 >= 6); assert.ok(p.y + p.h / 2 <= 694);
  }
});

test('colliding anchors are offset around each other and avoid panels when space exists', () => {
  const obstacle = { x: 350, y: 240, w: 180, h: 120 };
  const result = layoutWorkStatuses(['a', 'b', 'c'].map(id => ({ id, x: 350, y: 320, w: 140, h: 50 })), { width: 800, height: 600, obstacles: [obstacle] });
  for (const [i, p] of result.entries()) {
    assert.equal(overlap(p, obstacle), false);
    for (const other of result.slice(0, i)) assert.equal(overlap(p, other), false);
  }
});

test('dense mobile placement never drops working agents even when overlap is unavoidable', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, x: 180, y: 250, w: 148, h: 51 }));
  const placed = layoutWorkStatuses(items, { width: 360, height: 500 });
  assert.equal(placed.length, items.length);
  assert.equal(new Set(placed.map(p => p.id)).size, items.length);
  assert.ok(placed.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});
