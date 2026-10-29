import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import * as core from '../src/lib/task-usage-core.mjs';
import * as budget from '../src/lib/ai-budget-core.mjs';
import * as cost from '../src/lib/usage-cost.mjs';
function load(file,modules){const source=readFileSync(new URL(file,import.meta.url),'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};new Function('exports','require',compiled)(exports,name=>{assert.ok(name in modules,name);return modules[name];});return exports;}
test('task identity is explicit, campaigns inherit through nested features, and other run types never become campaigns',()=>{
  const id=randomUUID(),scope=core.mergeUsageScope({}, {run_id:id,feature:'campaign'});
  assert.deepEqual(scope.task,{kind:'campaign',id});assert.deepEqual(core.mergeUsageScope(scope,{feature:'design',agent:'designer'}).task,scope.task);
  assert.equal(core.mergeUsageScope({}, {run_id:id,feature:'seo'}).task,null);assert.equal(core.mergeUsageScope({}, {run_id:id,feature:'opportunities'}).task,null);
  assert.equal(core.taskUsageIdentity({kind:'conversation',id:'private prompt'}),null);
  assert.equal(core.taskUsageIdentity({kind:'unknown',id}),null);
  const explicit={kind:'head_task',id:randomUUID()};assert.deepEqual(core.mergeUsageScope(scope,{task:explicit}).task,explicit);
});
test('event payloads whitelist metering fields, retain unknowns, and never copy arbitrary task content',()=>{
  const scope={task:{kind:'conversation',id:randomUUID()},agent:'cmo',feature:'agent_conversation'},secret='PRIVATE PROMPT';
  const row=core.taskUsageEventRow(scope,{event:'provider_attempt',provider:'chatgpt',model:'model',estimatedTokens:2400,inputTokens:0,outputTokens:0,usageKnown:false,prompt:secret,title:secret});
  assert.equal(row.input_tokens,null);assert.equal(row.output_tokens,null);assert.equal(row.estimated_tokens,2400);assert.doesNotMatch(JSON.stringify(row),/PRIVATE|prompt|title/);
  assert.equal(core.taskUsageEventRow({...scope,stage:'specialist'},{event:'provider_attempt',provider:'nim'}).feature,'agent_conversation:specialist');
  assert.deepEqual(core.taskUsageSettlement({status:'failed',inputTokens:9,outputTokens:4,usageKnown:true}),{status:'failed',input_tokens:9,output_tokens:4});
  assert.equal(core.taskUsageSettlement({status:'failed',inputTokens:NaN,outputTokens:2,usageKnown:true}).input_tokens,null);
  assert.equal(core.taskUsageEventRow({}, {event:'deterministic_reuse'}),null);
  const reused=core.taskUsageEventRow(scope,{event:'checkpoint_reuse',inputTokens:999,outputTokens:999,usageKnown:true,estimatedTokens:999});assert.equal(reused.estimated_tokens,0);assert.equal(reused.input_tokens,null);assert.equal(reused.provider,null);
});
test('server telemetry isolates concurrent task scopes and logging failures never fail the task',async()=>{
  const rows=[],updates=[];let fail=false;
  const db={from(table){assert.equal(table,'task_usage_events');let row;const q={insert(value){row={id:randomUUID(),...value};rows.push(row);return q;},select:()=>q,abortSignal:()=>q,eq:()=>q,update(value){updates.push(value);return q;},maybeSingle:async()=>{if(fail)throw new Error('Database unavailable');return {data:row,error:null};},then(resolve,reject){return (fail?Promise.reject(new Error('Database unavailable')):Promise.resolve({error:null})).then(resolve,reject);}};return q;}};
  const u=load('../src/lib/usage.ts',{'server-only':{},'node:async_hooks':{AsyncLocalStorage},'@/lib/supabase/admin':{supabaseAdmin:()=>db},'@/office/roster.mjs':{PEOPLE:[]},'./usage-cost.mjs':cost,'./task-usage-core.mjs':core});
  const first=randomUUID(),second=randomUUID();
  await Promise.all([u.withUsage({task:{kind:'conversation',id:first}},async()=>{await new Promise(resolve=>setTimeout(resolve,8));await u.recordTaskUsageEvent({event:'deterministic_reuse'});}),u.withUsage({task:{kind:'head_task',id:second}},()=>u.recordTaskUsageEvent({event:'checkpoint_reuse'}))]);
  assert.deepEqual(rows.map(row=>[row.task_kind,row.task_id]),[['head_task',second],['conversation',first]]);
  assert.equal(await u.recordTaskUsageEvent({event:'deterministic_reuse'}),null,'unscoped work is not assigned a guessed task');
  fail=true;assert.equal(await u.withUsage({task:{kind:'conversation',id:first}},()=>u.recordTaskUsageEvent({event:'deterministic_reuse'})),null);await u.settleTaskUsageEvent(first,{status:'failed'});
});
function runner(){
  const als=new AsyncLocalStorage(),state={settings:{...budget.AI_BUDGET_DEFAULTS},events:[],settled:[],reservations:[],cache:new Map(),blocked:false};
  const db={from(table){let key;const q={select:()=>q,eq:(name,value)=>{if(name==='cache_key')key=value;return q;},gt:()=>q,maybeSingle:async()=>({data:table==='ai_usage_settings'?state.settings:state.cache.get(key)||null,error:null})};return q;},async rpc(name,args){
    if(name==='reserve_ai_request'){if(state.blocked)return {data:{allowed:false,reason:'daily_calls'}};const id=randomUUID(),maxOutputTokens=state.settings.max_output_tokens,estimatedTokens=args.p_input_tokens_estimate+maxOutputTokens;state.reservations.push({id,...args,maxOutputTokens,estimatedTokens});return {data:{allowed:true,id,maxOutputTokens,estimatedTokens}};}
    if(name==='settle_ai_request'){state.settled.push(args);return {data:true};}
    if(name==='store_ai_response_cache'){state.cache.set(args.p_key,{value:args.p_value});return {data:null};}
    assert.fail(name);
  }};
  const usage={currentUsageScope:()=>als.getStore(),recordTaskUsageEvent:async value=>{const event={id:randomUUID(),task:als.getStore().task,...value};state.events.push(event);return event.id;},settleTaskUsageEvent:async(id,outcome)=>{Object.assign(state.events.find(event=>event.id===id),outcome);}};
  const module=load('../src/lib/ai-budget.ts',{'server-only':{},'@/lib/supabase/admin':{supabaseAdmin:()=>db},'@/lib/usage':usage,'./ai-budget-core.mjs':budget});
  const input={provider:'chatgpt',accountKey:'telemetry-test',model:'configured-model',system:'System',user:randomUUID()};
  return {state,run:(id,work,patch={})=>als.run({feature:'automation:catalogue',agent:'catalogLead',task:{kind:'head_task',id}},()=>module.runAiBudgetedText({...input,...patch},work))};
}
test('budget telemetry attributes one paid owner and one shared waiter, then a cache hit without another reservation',async()=>{
  const h=runner(),a=randomUUID(),b=randomUUID(),c=randomUUID();let finish,started;
  const ready=new Promise(resolve=>started=resolve),work=async run=>{started();await new Promise(resolve=>finish=resolve);run.reportUsage({inputTokens:100,outputTokens:25,usageKnown:true});return {result:'saved'};};
  const first=h.run(a,work);await ready;const second=h.run(b,()=>assert.fail('Duplicate provider work'));finish();
  assert.deepEqual(await first,{result:'saved'});assert.deepEqual(await second,{result:'saved'});assert.deepEqual(await h.run(c,()=>assert.fail('Cache should reuse')),{result:'saved'});
  assert.equal(h.state.reservations.length,1);assert.deepEqual(h.state.events.map(event=>[event.event,event.task.id]),[['provider_attempt',a],['inflight_reuse',b],['cache_reuse',c]]);
  const attempt=h.state.events[0];assert.equal(attempt.inputTokens,100);assert.equal(attempt.outputTokens,25);assert.equal(attempt.status,'complete');assert.equal(attempt.estimatedTokens,h.state.reservations[0].estimatedTokens);
});
test('known failed counts and unknown failed estimates are distinct; blocked work has no fabricated event',async()=>{
  const h=runner(),id=randomUUID();
  await assert.rejects(h.run(id,async run=>{run.reportUsage({inputTokens:30,outputTokens:7,usageKnown:true});throw new Error('Known failure');}),/Known failure/);
  assert.equal(h.state.events[0].status,'failed');assert.equal(h.state.events[0].inputTokens,30);
  await assert.rejects(h.run(id,async()=>{throw new Error('Unknown failure');},{user:randomUUID()}),/Unknown failure/);
  assert.equal(h.state.events[1].status,'failed');assert.equal(h.state.events[1].usageKnown,false);assert.equal(h.state.events[1].estimatedTokens,h.state.reservations[1].estimatedTokens);
  h.state.blocked=true;await assert.rejects(h.run(id,()=>assert.fail('Blocked provider'),{user:randomUUID()}),error=>error.code==='ai_budget');assert.equal(h.state.events.length,2);assert.equal(h.state.reservations.length,2);
});
