import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackSeoJob, seoFailureSummary, latestSeoJob } from '../src/lib/agents/seo-status.mjs';

const oldAt = '2026-10-24T13:52:00.000Z', newAt = '2026-10-26T09:50:52.000Z';
const oldJob = { name: 'seo', last_run_at: oldAt, last_result: 'failed: old API quota error' };
function store(initial = oldJob) {
  let job = structuredClone(initial); const writes = [];
  return {
    readPrevious: async () => structuredClone(job),
    writeStarted: async value => { job = structuredClone(value); writes.push(job); },
    writeFinished: async (owned, value) => { if (job.last_run_at === owned) { job = { ...job, ...value }; writes.push(job); } },
    get: () => job, writes,
  };
}

test('manual or API success replaces a historic failure and records partial-source success without raw errors', async () => {
  const db = store(); let calls = 0;
  const result = await trackSeoJob({ ...db, run: async started => { calls++; await started(newAt); return { keywords: 14, problems: ['secret provider response'] }; } });
  assert.equal(calls, 1); assert.equal(result.keywords, 14);
  assert.deepEqual(db.get(), { name: 'seo', last_run_at: newAt, last_result: '14 search terms; 1 source(s) unavailable' });
  assert.equal(db.writes[0].last_result, 'running');
  assert.ok(!JSON.stringify(db.writes).includes('secret provider response'));
});

test('a rejected busy request cannot overwrite the active job or alter its schedule', async () => {
  const db = store({ name: 'seo', last_run_at: newAt, last_result: 'running' });
  await assert.rejects(trackSeoJob({ ...db, run: async () => { throw new Error('An SEO check is already running'); } }), /already running/);
  assert.equal(db.writes.length, 0); assert.equal(db.get().last_result, 'running');
});

test('failed work records a bounded safe outcome, without provider bodies or credentials', async () => {
  const db = store(), error = new Error('OpenAI 429: secret-token-value '+ 'private'.repeat(1000));
  await assert.rejects(trackSeoJob({ ...db, run: async started => { await started(newAt); throw error; } }), e => e === error);
  assert.equal(db.get().last_run_at, newAt);
  assert.match(db.get().last_result, /usage limit|credits/);
  assert.ok(db.get().last_result.length < 200);
  assert.ok(!db.get().last_result.includes('secret-token-value'));
  assert.ok(!seoFailureSummary(new Error('unknown secret-token-value')).includes('secret-token-value'));
});

test('a pause restores the prior due timestamp and is rethrown for existing scheduler pause handling', async () => {
  const db = store(), error = Object.assign(new Error('paused'), { name: 'Paused' });
  await assert.rejects(trackSeoJob({ ...db, run: async started => { await started(newAt); throw error; } }), e => e === error);
  assert.equal(db.get().last_run_at, oldAt); assert.equal(db.get().last_result, 'paused');
});

test('an older completion cannot overwrite a newer run that owns the job row', async () => {
  const db = store();
  await trackSeoJob({ ...db, run: async started => {
    await started(newAt);
    await db.writeStarted({ name: 'seo', last_run_at: '2026-10-26T10:10:00.000Z', last_result: 'running' });
    return { keywords: 14, problems: [] };
  } });
  assert.equal(db.get().last_run_at, '2026-10-26T10:10:00.000Z');
  assert.equal(db.get().last_result, 'running');
});

test('a display-status write failure never repeats or loses successfully completed SEO work', async () => {
  const db = store(); let calls = 0;
  const result = await trackSeoJob({ ...db, writeFinished: async () => { throw new Error('metadata unavailable'); },
    run: async started => { calls++; await started(newAt); return { keywords: 14, problems: [] }; },
  });
  assert.equal(calls, 1); assert.equal(result.keywords, 14);
});

test('the UI can prefer a newer actual SEO run over an old scheduler failure without rerunning it', () => {
  assert.deepEqual(latestSeoJob(oldJob, { started_at: newAt, status: 'done', state: { keywords: 14, problems: ['one'] } }),
    { name: 'seo', last_run_at: newAt, last_result: '14 search terms; 1 source(s) unavailable' });
  assert.equal(latestSeoJob({ ...oldJob, last_run_at: '2026-10-27T00:00:00.000Z' }, { started_at: newAt, status: 'done', state: {} }).last_result, oldJob.last_result);
  assert.equal(latestSeoJob({ name: 'seo', last_run_at: newAt, last_result: 'running' }, { started_at: newAt, status: 'done', state: { keywords: 14 } }).last_result, '14 search terms');
  assert.equal(latestSeoJob({ name: 'seo', last_run_at: newAt, last_result: 'failed: storage unavailable' }, { started_at: newAt, status: 'running' }).last_result, 'failed: storage unavailable');
});
