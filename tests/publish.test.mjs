import test from 'node:test';
import assert from 'node:assert/strict';
import { publishApprovedPlan, publicationBlock, hasConfirmedPublication } from '../src/lib/agents/publish-core.mjs';

function fixture(changes = {}) {
  const state = {
    approval: { id: 'approval', status: 'approved' },
    campaign: { id: 'campaign', status: 'approved', channels: ['meta'], budget_daily: 500, plan: { days: 7 }, external_ids: null, ...changes },
    calls: { launch: 0, prepare: 0, claim: 0, notify: 0 }, fail: {},
  };
  const assertAttempt = attempt => {
    assert.equal(state.campaign.status, 'publishing');
    assert.equal(state.campaign.external_ids._publish.attempt_id, attempt);
  };
  const store = {
    async read() { return structuredClone({ approval: state.approval, campaign: state.campaign }); },
    async claim(id, ids) {
      state.calls.claim++;
      if (state.campaign.status !== 'approved') return false;
      state.campaign.status = 'publishing'; state.campaign.external_ids = structuredClone(ids); return true;
    },
    async checkpoint(id, attempt, ids) {
      assertAttempt(attempt);
      if (state.fail.checkpoint) throw new Error('DB unavailable');
      state.campaign.external_ids = structuredClone(ids);
    },
    async finish(id, approval, ids) {
      assert.ok(hasConfirmedPublication(state.campaign, approval));
      if (state.fail.finishCampaign) throw new Error('DB unavailable');
      state.campaign.status = 'live'; state.campaign.external_ids = structuredClone(ids);
      if (state.fail.finishApproval) throw new Error('DB unavailable');
      state.approval.status = 'published';
    },
    async review(id, attempt, ids) { assertAttempt(attempt); state.campaign.status = 'publish_review'; state.campaign.external_ids = structuredClone(ids); },
    async release(id, attempt, ids) { assertAttempt(attempt); state.campaign.status = 'approved'; state.campaign.external_ids = structuredClone(ids); },
  };
  const options = {
    approvalId: 'approval', store,
    async checkPause() {},
    async prepare() { state.calls.prepare++; if (state.fail.prepare) throw new Error('Missing Meta configuration'); return {}; },
    async launch() { state.calls.launch++; if (state.fail.launch) throw new Error('provider secret=DO_NOT_ECHO'); return { campaign_id: '123', adset_id: '456', ad_id: '789' }; },
    async notify() { state.calls.notify++; if (state.fail.notify) throw new Error('Events unavailable'); },
  };
  return { state, options, run: () => publishApprovedPlan(options) };
}

test('a successful launch persists provider IDs and final state; a repeat creates no ads', async () => {
  const f = fixture();
  await f.run(); await f.run();
  assert.equal(f.state.calls.launch, 1);
  assert.equal(f.state.approval.status, 'published');
  assert.equal(f.state.campaign.status, 'live');
  assert.equal(f.state.campaign.external_ids.meta.campaign_id, '123');
});

test('concurrent approval publication requests make exactly one external launch', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.run(), f.run()]);
  assert.equal(f.state.calls.launch, 1);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /already started/);
});

test('pending approvals and invalid budgets cannot reach a provider', async () => {
  const pending = fixture(); pending.state.approval.status = 'pending';
  await assert.rejects(pending.run(), /Super Admin approved/);
  for (const amount of [0, -1, null, 'not-a-number']) {
    const f = fixture({ budget_daily: amount }); await assert.rejects(f.run(), /daily budget/);
    assert.equal(f.state.calls.launch, 0);
  }
});

test('Google-only, mixed and unknown channel plans stay approved without any launch', async () => {
  for (const channels of [['google'], ['meta', 'google'], ['email'], []]) {
    const f = fixture({ channels }); await assert.rejects(f.run(), /manual|channel/);
    assert.equal(f.state.calls.launch, 0); assert.equal(f.state.calls.claim, 0);
    assert.equal(f.state.approval.status, 'approved'); assert.equal(f.state.campaign.status, 'approved');
  }
});

test('missing connection or image does not claim or mark a campaign live', async () => {
  const f = fixture(); f.state.fail.prepare = true;
  await assert.rejects(f.run(), /configuration/);
  assert.equal(f.state.calls.launch, 0); assert.equal(f.state.calls.claim, 0);
  assert.equal(f.state.campaign.status, 'approved');
});

test('ambiguous Meta errors block retries and never expose the provider response', async () => {
  const f = fixture(); f.state.fail.launch = true;
  await assert.rejects(f.run(), error => /automatic retry is blocked/.test(error.message) && !error.message.includes('DO_NOT_ECHO'));
  assert.equal(f.state.campaign.status, 'publish_review');
  f.state.fail.launch = false;
  await assert.rejects(f.run(), /automatic retry is blocked/);
  assert.equal(f.state.calls.launch, 1);
});

test('an ID-checkpoint failure requires review while preserving returned IDs when possible', async () => {
  const f = fixture(); f.state.fail.checkpoint = true;
  await assert.rejects(f.run(), /automatic retry is blocked/);
  assert.equal(f.state.campaign.external_ids.meta.campaign_id, '123');
  assert.equal(f.state.campaign.status, 'publish_review');
  await assert.rejects(f.run(), /automatic retry is blocked/);
  assert.equal(f.state.calls.launch, 1);
});

test('final campaign or approval DB failure can be completed without republishing', async () => {
  for (const stage of ['finishCampaign', 'finishApproval']) {
    const f = fixture(); f.state.fail[stage] = true;
    await assert.rejects(f.run(), /no new ads/);
    f.state.fail[stage] = false;
    await f.run();
    assert.equal(f.state.calls.launch, 1); assert.equal(f.state.approval.status, 'published');
  }
});

test('pause after claim releases it safely, while office event failure preserves success', async () => {
  const f = fixture(); let checks = 0;
  f.options.checkPause = async () => { if (++checks === 2) throw new Error('Paused'); };
  await assert.rejects(f.run(), /before contacting Meta/);
  assert.equal(f.state.calls.launch, 0); assert.equal(f.state.campaign.status, 'approved');
  f.state.fail.notify = true;
  await f.run();
  assert.equal(f.state.approval.status, 'published');
});

test('existing live or uncertain records are not overwritten or automatically relaunched', async () => {
  for (const status of ['live', 'publishing', 'publish_review']) {
    const f = fixture({ status, external_ids: { meta: { campaign_id: 'old' } } });
    const original = structuredClone(f.state.campaign);
    await assert.rejects(f.run());
    assert.deepEqual(f.state.campaign, original); assert.equal(f.state.calls.launch, 0);
  }
  assert.match(publicationBlock({ status: 'publish_review' }), /reconcile/);
});

test('legacy published flags without actual Meta IDs do not report successful publication', async () => {
  for (const external_ids of [{}, { google: { status: 'manual' } }, { meta: { campaign_id: 'incomplete' } }]) {
    const f = fixture({ status: 'live', external_ids }); f.state.approval.status = 'published';
    await assert.rejects(f.run(), /do not confirm a Meta launch/);
    assert.equal(f.state.calls.launch, 0); assert.equal(f.state.campaign.status, 'live');
  }
  const f = fixture({ status: 'live', external_ids: { meta: { campaign_id: 'legacy', adset_id: 'set', ad_id: 'ad' } } });
  f.state.approval.status = 'published';
  assert.equal((await f.run()).meta.campaign_id, 'legacy');
  assert.equal(f.state.calls.launch, 0);
});
