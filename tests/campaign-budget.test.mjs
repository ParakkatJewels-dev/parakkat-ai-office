import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as quality from '../src/lib/agents/quality-core.mjs';
import * as checkpoints from '../src/lib/agents/campaign-checkpoint-core.mjs';
import { AiBudgetError,isAiBudgetError } from '../src/lib/ai-budget-core.mjs';

const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/agents/campaign.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(error) {
  const state={run:{id:'run',occasion:'Campaign',stage:'plan',status:'running',state:{insights:['Saved prior insight']}},task:{status:'running'},requester:null,approval:null,provenanceError:false,taskReadError:false,reads:0,events:[],error,lock:null,lockError:false,claims:[],releases:[],waitAtMemory:null,usage:[]};
  const db={from:table=>{let payload;const q={select:()=>q,eq:()=>q,gt:()=>q,single:async()=>({data:structuredClone(state.run),error:null}),maybeSingle:async()=>({data:structuredClone(table==='profiles'?state.requester:table==='approvals'?state.approval:state.task),error:(table==='profiles'||table==='approvals'?state.provenanceError:state.taskReadError)?{}:null}),update:v=>{payload=v;return q;},then:(resolve,reject)=>Promise.resolve().then(()=>{if(payload&&table==='agent_runs')Object.assign(state.run,structuredClone(payload));return {error:null};}).then(resolve,reject)};return q;},
    rpc:async(name,args)=>{
      if(name==='acquire_job_lock'){if(state.lockError)return {data:null,error:{}};if(state.lock)return {data:false,error:null};state.lock={...args};state.claims.push({...args});return {data:true,error:null};}
      if(name==='release_job_lock'){state.releases.push({...args});if(state.lock?.p_holder===args.p_holder)state.lock=null;return {data:null,error:null};}
      throw new Error(`Unexpected RPC ${name}`);
    }};
  const modules={'./quality-core.mjs':quality,'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>false},'node:crypto':crypto,'@/lib/ai-budget':{isAiBudgetError},'@/lib/pause':{Paused:class Paused extends Error {}},'@/lib/errors':{errText:e=>e.message},'@/lib/usage':{withUsage:(scope,fn)=>{state.usage.push(scope);return fn();}},
    './memory':{loadMemory:async()=>{state.reads++;if(state.waitAtMemory)await state.waitAtMemory;if(state.error)throw state.error;}},'./events':{emit:async(...args)=>{state.events.push(args);}}};
  const exports={};new Function('exports','require',compiled)(exports,name=>modules[name]||(name==='./campaign-checkpoint-core.mjs'?checkpoints:{}));return {state,advance:()=>exports.advance(db,'run'),steps:()=>exports.runSteps(state.run,false)};
}
test('campaign budget exhaustion uses the actual rolling retryAt and blocks manual early retries',async()=>{
  const retryAt=new Date(Date.now()+5*86400000).toISOString(),h=harness(new AiBudgetError('private upstream',retryAt,'weekly_calls'));
  await h.advance();assert.equal(h.state.run.status,'running');assert.equal(h.state.run.state.retry.at,retryAt);assert.equal(h.state.run.state.retry.reason,'ai_budget');
  assert.equal(h.steps().pill[0],'Waiting for text budget');assert.deepEqual(h.state.run.state.insights,['Saved prior insight']);
  await h.advance();assert.equal(h.state.reads,1);assert.equal(h.state.events.length,1);assert.doesNotMatch(h.state.run.error,/private|60 minute/);
});
test('oversized campaign input stops with a safe correction request and no automatic retry',async()=>{
  const h=harness(new AiBudgetError('secret prompt data',null,'input_too_long'));await h.advance();
  assert.equal(h.state.run.status,'failed');assert.equal(h.state.run.state.retry,undefined);assert.match(h.state.run.error,/Shorten its brief/);assert.doesNotMatch(h.state.run.error,/secret/);
  await h.advance();assert.equal(h.state.reads,1);
});
test('an unavailable budget without a release time stops automatic campaign retries',async()=>{
  const h=harness(new AiBudgetError('secret SQL',null,'budget_unavailable'));await h.advance();assert.equal(h.state.run.status,'failed');assert.equal(h.state.run.state.retry,undefined);assert.match(h.state.run.error,/administrator/);
});
test('late inserted campaign linked to a cancelled or missing task stops before memory or inference',async()=>{
  for(const task of [{status:'cancelled'},null]) {
    const h=harness(new Error('Provider must not run'));h.state.run.automation_task_id='cancelled-task';h.state.task=task;
    await h.advance();assert.equal(h.state.run.status,'cancelled');assert.equal(h.state.reads,0);assert.equal(h.state.events.length,0);
    await h.advance();assert.equal(h.state.reads,0);
  }
});
test('campaign task-read failure fails closed without advancing or marking a legitimate task cancelled',async()=>{
  const h=harness(new Error('Provider must not run'));h.state.run.automation_task_id='task';h.state.taskReadError=true;
  await assert.rejects(h.advance(),/Could not verify/);assert.equal(h.state.run.status,'running');assert.equal(h.state.reads,0);
});
test('ordinary retries enforce manual backoff and stop after the third failed attempt',async()=>{
  const h=harness(new Error('private upstream secret'));
  await h.advance();assert.equal(h.state.reads,1);assert.equal(h.state.run.state.stageFailures.n,1);
  for(let i=0;i<4;i++)await h.advance();assert.equal(h.state.reads,1,'manual advance cannot bypass a future provider retry');
  h.state.run.state.retry.at=new Date(Date.now()-1000).toISOString();await h.advance();assert.equal(h.state.reads,2);assert.equal(h.state.run.state.stageFailures.n,2);
  await h.advance();assert.equal(h.state.reads,2);
  h.state.run.state.retry.at=new Date(Date.now()-1000).toISOString();await h.advance();assert.equal(h.state.reads,3);assert.equal(h.state.run.status,'failed');assert.equal(h.state.run.state.retry,undefined);
  assert.equal(h.state.run.state.stageFailures.n,3);assert.deepEqual(h.state.run.state.insights,['Saved prior insight']);assert.match(h.state.run.error,/three failed attempts.*explicitly retry/);assert.doesNotMatch(h.state.run.error,/private|secret/);
  await h.advance();assert.equal(h.state.reads,3);
});
test('budget deferrals neither consume nor reset the ordinary failure counter',async()=>{
  const h=harness(new Error('temporary failure'));await h.advance();assert.equal(h.state.run.state.stageFailures.n,1);
  h.state.run.state.retry.at=new Date(Date.now()-1000).toISOString();h.state.error=new AiBudgetError('allowance',new Date(Date.now()+86400000).toISOString(),'daily_calls');
  await h.advance();assert.equal(h.state.run.state.retry.reason,'ai_budget');assert.equal(h.state.run.state.stageFailures.n,1);assert.equal(h.state.run.state.retry.n,0);
  await h.advance();assert.equal(h.state.reads,2);
  h.state.run.state.retry.at=new Date(Date.now()-1000).toISOString();h.state.error=new Error('temporary failure');await h.advance();assert.equal(h.state.run.state.stageFailures.n,2);assert.equal(h.state.run.status,'running');
});
test('legacy runs already beyond three failures stop without one additional attempt',async()=>{
  const h=harness(new Error('Provider must not run'));h.state.run.state.retry={stage:'plan',n:8,at:new Date(Date.now()-1000).toISOString()};
  await h.advance();assert.equal(h.state.run.status,'failed');assert.equal(h.state.reads,0);assert.equal(h.state.run.state.retry,undefined);assert.deepEqual(h.state.run.state.insights,['Saved prior insight']);
});
test('concurrent manual and scheduled advancement shares one durable campaign lease',async()=>{
  const h=harness(new Error('temporary provider failure'));let finish;
  h.state.waitAtMemory=new Promise(resolve=>{finish=resolve;});const owner=h.advance();
  while(h.state.reads===0)await Promise.resolve();const captured={...h.state.lock};
  assert.equal(await h.advance(),'plan');assert.equal(h.state.reads,1);assert.equal(h.state.claims.length,1);assert.equal(h.state.releases.length,0,'busy contender cannot release owner lease');
  assert.equal(captured.p_name,'campaign:run');assert.equal(captured.p_seconds,900);
  finish();await owner;assert.equal(h.state.reads,1);assert.equal(h.state.releases.length,1);assert.equal(h.state.releases[0].p_holder,captured.p_holder);assert.equal(h.state.lock,null);
});
test('campaign lock acquisition errors fail closed and owned read errors still release the lease',async()=>{
  const h=harness(new Error('Provider must not run'));h.state.lockError=true;await assert.rejects(h.advance(),/Could not reserve/);assert.equal(h.state.reads,0);assert.equal(h.state.releases.length,0);
  h.state.lockError=false;h.state.run.automation_task_id='task';h.state.taskReadError=true;await assert.rejects(h.advance(),/Could not verify/);
  assert.equal(h.state.reads,0);assert.equal(h.state.releases.length,1);assert.equal(h.state.lock,null);
});


test('campaign stages recover scheduled origin across queue claims and preserve the human task allocation',async()=>{
  const cases=[{origin:undefined,linked:false,created_by:null,scheduled:false},{origin:{by:'cmo',why:'Scheduled'},linked:false,created_by:null,scheduled:true},{origin:{by:'cmo',why:'Task'},linked:true,created_by:'human',scheduled:false},{origin:undefined,linked:true,created_by:null,scheduled:true}];
  for(const c of cases){const h=harness(null);h.state.run.state.origin=c.origin;if(c.linked){h.state.run.automation_task_id='task';h.state.task.created_by=c.created_by;}await h.advance();assert.equal(h.state.usage[0].scheduled,c.scheduled);}
});


test('a verified human rereview uses manual allowance only during its review cycle',async()=>{
  const requester='00000000-0000-4000-8000-000000000001',approval='00000000-0000-4000-8000-000000000002';
  for(const problem of [null,'wrong_campaign','missing_user','viewer','wrong_role','not_archived','invalid_id','future','read_failed','other_stage']){
    const h=harness(null);h.state.run.stage='review';h.state.run.automation_task_id='task';h.state.task.created_by=null;
    h.state.run.state={origin:{by:'cmo'},campaign_id:'campaign',qualityReviewRequest:{requestedBy:requester,approvalId:approval,requestedAt:'2026-01-01T00:00:00Z'}};
    h.state.requester={role:'creative_head'};h.state.approval={id:approval,campaign_id:'campaign',status:'changes',required_roles:['creative_head']};
    if(problem==='wrong_campaign')h.state.approval.campaign_id='another';if(problem==='missing_user')h.state.requester=null;if(problem==='viewer')h.state.requester.role='viewer';if(problem==='wrong_role')h.state.requester.role='ecom_manager';if(problem==='not_archived')h.state.approval.status='pending';if(problem==='invalid_id')h.state.run.state.qualityReviewRequest.requestedBy='forged';if(problem==='future')h.state.run.state.qualityReviewRequest.requestedAt='2999-01-01';if(problem==='read_failed')h.state.provenanceError=true;if(problem==='other_stage')h.state.run.stage='create';
    await h.advance();assert.equal(h.state.usage[0].scheduled,problem!==null,problem||'valid explicit rereview');
  }
});
