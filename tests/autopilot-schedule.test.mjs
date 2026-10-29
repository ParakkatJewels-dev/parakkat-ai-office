import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPPORTUNITY_SCHEDULE, chooseDueJob } from '../src/lib/agents/autopilot-core.mjs';

const opportunity = { name: 'opportunities', ...OPPORTUNITY_SCHEDULE };
test('opportunity reviews become due every four hours during Indian working hours', () => {
  const now = new Date('2026-10-26T10:30:00Z');
  assert.equal(chooseDueJob([opportunity], { opportunities: now.getTime() - 14399999 }, now), null);
  assert.equal(chooseDueJob([opportunity], { opportunities: now.getTime() - 14400000 }, now)?.name, 'opportunities');
  assert.equal(chooseDueJob([opportunity], {}, new Date('2026-10-26T03:29:00Z')), null);
  assert.equal(chooseDueJob([opportunity], {}, new Date('2026-10-26T03:30:00Z'))?.name, 'opportunities');
  assert.equal(chooseDueJob([opportunity], {}, new Date('2026-10-26T14:30:00Z')), null);
});
test('fresh evidence gets a lead review even while the daily campaign planner is not due', () => {
  const now = new Date('2026-10-26T10:30:00Z');
  const jobs = [{ name: 'planner', every: 20 * 3600000, hours: [9, 20] }, opportunity];
  assert.equal(chooseDueJob(jobs, { planner: now.getTime() - 4 * 3600000 }, now)?.name, 'opportunities');
});
test('a current persisted attempt prevents back-to-back duplicate reviews', () => {
  const now = new Date('2026-10-26T10:30:00Z');
  assert.equal(chooseDueJob([opportunity], {}, now)?.name, 'opportunities');
  assert.equal(chooseDueJob([opportunity], { opportunities: now.getTime() }, new Date(now.getTime() + 60000)), null);
});
