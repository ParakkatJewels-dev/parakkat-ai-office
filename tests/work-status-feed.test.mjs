import test from 'node:test';
import assert from 'node:assert/strict';
import { localWorkSnapshot } from '../src/office/work-status-feed.mjs';
const at = Date.parse('2026-10-26T12:00:00Z');
const snapshot = { observedAt: new Date(at).toISOString(), statuses: { designer: { state:'working', label:'Designing an image', expiresAt:new Date(at + 12_000).toISOString() } } };
test('server work leases last only their remaining time regardless of browser clock skew', () => {
  for (const now of [at - 86_400_000, at + 86_400_000]) assert.equal(localWorkSnapshot(snapshot, 1500, now).designer.expiresAt, now + 10_500);
});
test('expired, malformed, failed and empty snapshots never retain old active work', () => {
  assert.deepEqual(localWorkSnapshot(snapshot, 12_001, at), {});
  assert.deepEqual(localWorkSnapshot(null, 0, at), {});
  assert.deepEqual(localWorkSnapshot({ ...snapshot, statuses: {} }, 0, at), {});
  assert.deepEqual(localWorkSnapshot({ ...snapshot, observedAt: 'invalid' }, 0, at), {});
});
test('long or corrupt server leases cannot extend client work beyond twelve seconds', () => {
  assert.equal(localWorkSnapshot({ ...snapshot, statuses: { designer: { ...snapshot.statuses.designer, expiresAt: at + 999_999 } } }, 0, at).designer.expiresAt, at + 12_000);
  assert.deepEqual(localWorkSnapshot({ ...snapshot, statuses: { designer: { ...snapshot.statuses.designer, expiresAt: 'invalid' } } }, 0, at), {});
});
