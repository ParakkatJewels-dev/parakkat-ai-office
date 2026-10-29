import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignCheckpoint,campaignHasPendingCall,campaignCheckpointFingerprint,prepareCampaignRetry} from '../src/lib/agents/campaign-checkpoint-core.mjs';

function fixture(initial={}) {
  let stored=structuredClone(initial),writes=0,reuses=0,active=true,failWrite=0;
  const state=structuredClone(initial);
  const cp=createCampaignCheckpoint(state,{persist:async()=>{writes++;if(writes===failWrite)throw new Error('save failed');stored=structuredClone(state);},assertActive:async()=>{if(!active)throw new Error('cancelled');},isSafeFailure:e=>e.code==='budget',onReuse:async()=>{reuses++;}});
  return {state,cp,get stored(){return stored;},get reuses(){return reuses;},set active(v){active=v;},set failWrite(v){failWrite=v;}};
}
test('completed paid work resumes after a later failure with no repeated call',async()=>{
  const h=fixture();let calls=0;
  await h.cp.run('writer',{source:'facts',system:'instructions'},async()=>{calls++;return {body:'Saved'};});
  await assert.rejects(h.cp.run('review',{source:'facts'},async()=>{calls++;throw new Error('transport lost');}));
  assert.equal(campaignHasPendingCall(h.stored),true);
  const next=fixture(prepareCampaignRetry(h.stored));
  assert.deepEqual(await next.cp.run('writer',{system:'instructions',source:'facts'},async()=>{calls++;return null;}),{body:'Saved'});
  await next.cp.run('review',{source:'facts'},async()=>{calls++;return {decision:'forward'};});
  assert.equal(calls,3);assert.equal(next.reuses,1);assert.equal(campaignHasPendingCall(next.stored),false);
});
test('source and current saved instructions invalidate completed checkpoints',async()=>{
  const h=fixture();let calls=0;
  for(const input of [{source:'a',system:'one'},{source:'a',system:'one'},{source:'b',system:'one'},{source:'b',system:'two'}])await h.cp.run('writer',input,async()=>++calls);
  assert.equal(calls,3);assert.equal(h.reuses,1);
  assert.equal(campaignCheckpointFingerprint({b:2,a:1}),campaignCheckpointFingerprint({a:1,b:2}));
});
test('a pending unknown attempt cannot be replaced even if its source changes',async()=>{
  const h=fixture();await assert.rejects(h.cp.run('writer',{source:'a'},async()=>{throw new Error('lost response');}));
  let calls=0;await assert.rejects(fixture(h.stored).cp.run('writer',{source:'b'},async()=>++calls),{code:'campaign_pending_call'});assert.equal(calls,0);
});
test('reservation save failure sends no paid request; result save failure retains pending state',async()=>{
  const h=fixture();h.failWrite=1;let calls=0;await assert.rejects(h.cp.run('writer',{},async()=>++calls));assert.equal(calls,0);assert.equal(campaignHasPendingCall(h.state),false);
  const result=fixture();result.failWrite=2;await assert.rejects(result.cp.run('writer',{},async()=>++calls));assert.equal(calls,1);assert.equal(campaignHasPendingCall(result.state),true);assert.equal(campaignHasPendingCall(result.stored),true);
});
test('known preflight budget refusals release pending, but multi-call image failures remain uncertain',async()=>{
  for(const uncertainOnError of [false,true]) {
    const h=fixture();await assert.rejects(h.cp.run('step',{},async()=>{throw Object.assign(new Error('budget'),{code:'budget'});},{uncertainOnError}));
    assert.equal(campaignHasPendingCall(h.stored),uncertainOnError);
  }
});
test('cancellation or lost lease prevents replay and new requests',async()=>{
  const h=fixture();await h.cp.run('writer',{},async()=>1);h.active=false;
  await assert.rejects(h.cp.run('writer',{},async()=>2),/cancelled/);await assert.rejects(h.cp.memo('id',{},()=>3),/cancelled/);
});
test('same-operation concurrency does not send duplicate paid requests',async()=>{
  const h=fixture();let release,calls=0;
  const first=h.cp.run('writer',{},async()=>{calls++;return new Promise(resolve=>{release=resolve;});});
  while(!release)await Promise.resolve();await assert.rejects(h.cp.run('writer',{},async()=>++calls),{code:'campaign_pending_call'});
  release('complete');await first;assert.equal(calls,1);
});
test('observed completed artwork can resolve an uncertain image attempt without another generation',async()=>{
  const h=fixture();await assert.rejects(h.cp.run('artwork',{id:'asset'},async()=>{throw new Error('save response lost');}));
  await h.cp.adopt('artwork',{id:'asset'},{image_path:'saved.png',art_status:'ready'});
  assert.equal(campaignHasPendingCall(h.stored),false);
  assert.deepEqual(await h.cp.run('artwork',{id:'asset'},async()=>{throw new Error('must not regenerate');}),{image_path:'saved.png',art_status:'ready'});
});
