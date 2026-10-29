import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
export const campaignCheckpointFingerprint = input => createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
export const campaignHasPendingCall = state => Object.values(state?.checkpoints?.entries || {}).some(entry => entry?.status === 'pending');
export function campaignPendingCall() {
  return Object.assign(new Error('A campaign operation may already have run, but its completion was not saved. Review the saved work, then explicitly retry to authorize another attempt. Completed work will be reused.'), { code: 'campaign_pending_call' });
}

/** Only explicit user retry may discard an uncertain attempt. Completed work survives. */
export function prepareCampaignRetry(state) {
  const next = structuredClone(state && typeof state === 'object' ? state : {});
  delete next.retry; delete next.stageFailures;
  if (next.checkpoints?.version === 1) {
    next.checkpoints.entries = Object.fromEntries(Object.entries(next.checkpoints.entries || {}).filter(([, entry]) => entry?.status === 'complete'));
    next.checkpoints.retryAuthorizedAt = new Date().toISOString();
  }
  return next;
}

/** Durable, within-run memoization. No prompt text is stored in checkpoint keys. */
export function createCampaignCheckpoint(state, { persist, assertActive = async () => {}, isSafeFailure = () => false, onReuse = async () => {} }) {
  if (state.checkpoints && state.checkpoints.version !== 1) throw new Error('Unknown campaign checkpoint version; automatic replay is disabled.');
  state.checkpoints ||= { version: 1, entries: {} };
  state.checkpoints.entries ||= {};
  const entries = state.checkpoints.entries;
  let writes = Promise.resolve();
  const active = new Set();
  const write = (key, entry) => {
    const work = writes.then(async () => {
      const previous = entries[key];
      if (entry === undefined) delete entries[key]; else entries[key] = entry;
      try { await persist(); }
      catch (error) { if (previous === undefined) delete entries[key]; else entries[key] = previous; throw error; }
    });
    writes = work.catch(() => {});
    return work;
  };
  return {
    async adopt(key, input, value) {
      await assertActive();
      await write(key, {status:'complete',fingerprint:campaignCheckpointFingerprint(input),value:structuredClone(value)});
    },
    async memo(key, input, make) {
      await assertActive();
      const fingerprint = campaignCheckpointFingerprint(input), saved = entries[key];
      if (saved?.status === 'pending') throw campaignPendingCall();
      if (saved?.status === 'complete' && saved.fingerprint === fingerprint) return structuredClone(saved.value);
      const value = make();
      await write(key, { status: 'complete', fingerprint, value: structuredClone(value) });
      return value;
    },
    async run(key, input, operation, options = {}) {
      if (active.has(key)) throw campaignPendingCall();
      active.add(key);
      try {
      await assertActive();
      const fingerprint = campaignCheckpointFingerprint(input), saved = entries[key];
      if (saved?.status === 'pending') throw campaignPendingCall();
      if (saved?.status === 'complete' && saved.fingerprint === fingerprint) {
        await onReuse();
        return structuredClone(saved.value);
      }
      const pending = { status: 'pending', fingerprint, startedAt: new Date().toISOString(), ...(options.resourceId?{resourceId:options.resourceId}:{}) };
      await write(key, pending); // A failed reservation must never send a model request.
      let value;
      try { value = await operation(); }
      catch (error) {
        if (!options.uncertainOnError && isSafeFailure(error)) await write(key, undefined);
        throw error;
      }
      // If this save fails, write() restores the pending marker: the paid result is uncertain.
      await write(key, { status: 'complete', fingerprint, value: structuredClone(value) });
      return value;
      } finally { active.delete(key); }
    },
  };
}
