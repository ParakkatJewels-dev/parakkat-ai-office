import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OUTCOME_CADENCE_SECONDS,withOutcomeMonitoringLease} from '../src/lib/outcomes/cadence.mjs';
function fixture(){
 const state={monitor_after:null,last_attempt_at:null,last_refreshed_at:null};let holder=null;const counts={reads:0,writes:0,releases:0};
 const db={rpc:async(name,p)=>{if(name==='acquire_job_lock'){if(holder)return {data:false};holder=p.p_holder;return {data:true};}assert.equal(name,'release_job_lock');assert.equal(holder,p.p_holder);holder=null;counts.releases++;return {data:true};},from:table=>{assert.equal(table,'outcome_scan_state');let patch=null;const q={select(){return q;},eq(k,v){assert.equal(k,'singleton');assert.equal(v,true);return q;},abortSignal(){return q;},update(v){patch=v;return q;},single:async()=>{counts.reads++;return {data:{...state}};},then(resolve,reject){counts.writes++;Object.assign(state,patch);return Promise.resolve({error:null}).then(resolve,reject);}};return q;}};
 return {db,state,counts};
}
test('persisted cadence skips repeated ticks until five minutes and explicit changes can force a check',async()=>{
 const {db,state,counts}=fixture();let runs=0,clock=new Date('2026-10-26T15:00:00Z');const opts={now:()=>clock},sweep=async()=>({checked:++runs});
 assert.equal(OUTCOME_CADENCE_SECONDS,300);assert.equal((await withOutcomeMonitoringLease(db,sweep,opts)).checked,1);assert.equal(state.last_attempt_at,clock.toISOString());
 clock=new Date('2026-10-26T15:04:59Z');const skipped=await withOutcomeMonitoringLease(db,sweep,opts);assert.equal(skipped.skipped,'cooldown');assert.equal(skipped.nextReviewAt,'2026-10-26T15:05:00.000Z');assert.equal(runs,1);assert.equal(counts.writes,1);
 clock=new Date('2026-10-26T15:05:00Z');await withOutcomeMonitoringLease(db,sweep,opts);assert.equal(runs,2);
 await withOutcomeMonitoringLease(db,sweep,{...opts,force:true});assert.equal(runs,3);assert.equal(counts.writes,3);assert.equal(counts.releases,4);
});
test('concurrent ticks cannot both sweep even if the loser requests force',async()=>{
 const {db,counts}=fixture();let begin,finish,runs=0;const started=new Promise(resolve=>begin=resolve),wait=new Promise(resolve=>finish=resolve);
 const first=withOutcomeMonitoringLease(db,async()=>{runs++;begin();await wait;return {checked:1};});await started;
 assert.equal((await withOutcomeMonitoringLease(db,async()=>{runs++;},{force:true})).busy,true);assert.equal(runs,1);assert.equal(counts.reads,1);assert.equal(counts.writes,1);
 finish();await first;assert.equal(counts.releases,1);
});
test('a failed sweep releases its lock and retains cooldown instead of retrying every tick',async()=>{
 const {db,state,counts}=fixture(),now=()=>new Date('2026-10-26T15:00:00Z');let runs=0;
 await assert.rejects(withOutcomeMonitoringLease(db,async()=>{runs++;throw new Error('Failed read');},{now}),/Failed read/);
 assert.equal(state.last_attempt_at,now().toISOString());assert.equal(counts.releases,1);
 assert.equal((await withOutcomeMonitoringLease(db,async()=>{runs++;},{now})).skipped,'cooldown');assert.equal(runs,1);assert.equal(counts.releases,2);
});
test('successful refresh timestamps from existing state also enforce cooldown',async()=>{
 const {db,state,counts}=fixture();state.last_refreshed_at='2026-10-26T15:00:00Z';
 assert.equal((await withOutcomeMonitoringLease(db,async()=>{throw new Error('Unexpected sweep');},{now:()=>new Date('2026-10-26T15:02:00Z')})).skipped,'cooldown');assert.equal(counts.writes,0);assert.equal(counts.releases,1);
});
