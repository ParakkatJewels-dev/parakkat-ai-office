import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import * as core from '../src/lib/ai-budget-core.mjs';

test('budget settings enforce bounded integers, weekly consistency and output caps',()=>{
  assert.equal(core.AI_BUDGET_DEFAULTS.enabled,false,'rolling allowances are opt-in; accounting stays active');
  assert.equal(core.AI_BUDGET_DEFAULTS.max_input_chars,100000);
  assert.equal(core.AI_BUDGET_DEFAULTS.max_output_tokens,8000);
  assert.equal(core.validateAiBudgetSettings({max_output_tokens:256}).max_output_tokens,256);
  for(const patch of [{max_output_tokens:255},{max_output_tokens:8001},{daily_call_limit:1.5},{weekly_call_limit:1},{enabled:'true'},{secret:'no'}])assert.throws(()=>core.validateAiBudgetSettings(patch));
  assert.equal(core.validateAiBudgetSettings({enabled:false}).enabled,false);
});
test('input estimate counts Unicode bytes conservatively and never truncates text',()=>{
  const plain=core.estimateAiInput('','a'.repeat(100)),unicode=core.estimateAiInput('','💎'.repeat(100));
  assert.equal(plain.chars,unicode.chars);assert.equal(unicode.estimatedTokens-plain.estimatedTokens,150);
  assert.ok(core.estimateAiInput('','a'.repeat(40000)).chars>40000);
  assert.equal(core.actualAiUsage({inputTokens:0,outputTokens:0,usageKnown:false}),null);
  assert.equal(core.actualAiUsage({inputTokens:10,outputTokens:undefined}),null);
  assert.equal(core.actualAiUsage({inputTokens:10,outputTokens:4}),null);
  assert.deepEqual(core.actualAiUsage({inputTokens:10,outputTokens:4,usageKnown:true}),{inputTokens:10,outputTokens:4});
});
const request={provider:'chatgpt',accountKey:'account1',model:'gpt-6.1-sol',feature:'automation:catalogue',agent:'catalogLead',system:'Current instructions revision1',user:'Product42',maxOutputTokens:2400};
test('exact cache identity isolates accounts, models, instructions, evidence, feature and agents',()=>{
  const key=core.aiRequestKey(request);assert.match(key,/^[a-f0-9]{64}$/);
  for(const [field,value] of Object.entries({accountKey:'account2',model:'other',system:'revision2',user:'Product43',feature:'automation:advertising',agent:'other',maxOutputTokens:512}))assert.notEqual(core.aiRequestKey({...request,[field]:value}),key);
  for(const feature of ['automation:customer','conversation','chat','automation:follow_up',undefined])assert.equal(core.aiRequestKey({...request,feature}),null);
  assert.equal(core.aiRequestKey({...request,accountKey:''}),null);
});
test('inflight automatic requests share work without one cancellation aborting other callers',async()=>{
  const cache=core.createAiRequestCoalescer(),stop=new AbortController();let calls=0,finish;
  const work=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const a=cache.run('same',work,stop.signal),b=cache.run('same',work);
  await Promise.resolve();stop.abort(new Error('Caller stopped'));await assert.rejects(a,/Caller stopped/);
  finish({items:[1]});const result=await b;assert.deepEqual(result,{items:[1]});assert.equal(calls,1);assert.equal(cache.size,0);
  const [c,d]=await Promise.all([cache.run('new',async()=>({items:[]})),cache.run('new',async()=>assert.fail())]);c.items.push(1);assert.deepEqual(d.items,[]);
  await assert.rejects(cache.run('failed',async()=>{throw new Error('provider');}),/provider/);
  assert.equal(await cache.run('failed',async()=>7),7);
});

const source=readFileSync(new URL('../src/lib/ai-budget.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(feature='automation:catalogue') {
  const state={settings:{...core.AI_BUDGET_DEFAULTS},scope:{feature,agent:'catalogLead'},reservations:[],cache:new Map(),block:false,unavailable:false,settlementFails:false};
  const db={from(table){let key;const q={select:()=>q,eq:(name,value)=>{if(name==='cache_key')key=value;return q;},gt:()=>q,maybeSingle:async()=>({data:table==='ai_usage_settings'?state.settings:state.cache.get(key)||null,error:state.unavailable?{}:null})};return q;},
    async rpc(name,args){
      if(name==='reserve_ai_request'){if(state.block)return {data:{allowed:false,reason:'daily_calls',retryAt:'2026-10-27T12:00:00Z'},error:null};const row={id:randomUUID(),...args,maxOutputTokens:state.settings.max_output_tokens};state.reservations.push(row);return {data:{allowed:true,id:row.id,maxOutputTokens:row.maxOutputTokens,estimatedTokens:args.p_input_tokens_estimate+row.maxOutputTokens},error:null};}
      if(name==='settle_ai_request'){if(state.settlementFails)return {data:false,error:{}};Object.assign(state.reservations.find(row=>row.id===args.p_id),args);return {data:true,error:null};}
      if(name==='store_ai_response_cache'){state.cache.set(args.p_key,{value:args.p_value});return {data:null,error:null};}
      throw new Error(`Unknown RPC ${name}`);
    }};
  const modules={'server-only':{},'@/lib/supabase/admin':{supabaseAdmin:()=>db},'@/lib/usage':{currentUsageScope:()=>state.scope,recordTaskUsageEvent:async()=>null,settleTaskUsageEvent:async()=>{}},'./ai-budget-core.mjs':core};
  const exports={};new Function('exports','require',compiled)(exports,name=>{assert.ok(name in modules,name);return modules[name];});
  return {state,run:(work,input={})=>exports.runAiBudgetedText({...request,user:randomUUID(),...input},work)};
}
test('real budget runner blocks before provider invocation and oversized prompts are explicit',async()=>{
  const h=harness();h.state.block=true;let calls=0;
  await assert.rejects(h.run(async()=>{calls++;}),e=>core.isAiBudgetError(e)&&e.retryAt==='2026-10-27T12:00:00Z');
  assert.equal(calls,0);assert.equal(h.state.reservations.length,0);
  h.state.block=false;await assert.rejects(h.run(async()=>{calls++;},{user:'x'.repeat(100001)}),e=>e.reason==='input_too_long');assert.equal(calls,0);
  h.state.unavailable=true;await assert.rejects(h.run(async()=>{calls++;}),e=>e.reason==='budget_unavailable');assert.equal(calls,0);
});
test('real runner reserves once, caps output, settles known usage and caches only completed automatic results',async()=>{
  const h=harness();let calls=0;const input={user:randomUUID()};
  const work=async run=>{calls++;assert.equal(run.maxOutputTokens,2400);assert.equal(h.state.reservations.length,1);run.reportUsage({inputTokens:100,outputTokens:20,usageKnown:true});return {draft:'Source-based copy'};};
  assert.deepEqual(await h.run(work,input),{draft:'Source-based copy'});assert.equal(h.state.reservations[0].p_input_tokens,100);
  assert.deepEqual(await h.run(work,input),{draft:'Source-based copy'});assert.equal(calls,1);assert.equal(h.state.reservations.length,1);
  const bad={user:randomUUID()};await assert.rejects(h.run(async()=>{throw new Error('uncertain');},bad),/uncertain/);
  assert.equal(h.state.reservations[1].p_status,'failed');assert.equal(h.state.reservations[1].p_input_tokens,null);
  await h.run(async()=>({fixed:true}),bad);assert.equal(h.state.reservations.length,3);
});
test('manual/customer requests are never cached and failed settlement keeps successful result without reattempt',async()=>{
  const h=harness('automation:customer'),input={user:'Private customer question'};h.state.settlementFails=true;
  for(let i=0;i<2;i++)assert.deepEqual(await h.run(async()=>({reply:'Saved reply draft'}),input),{reply:'Saved reply draft'});
  assert.equal(h.state.reservations.length,2);assert.equal(h.state.cache.size,0);assert.equal(h.state.reservations[0].p_status,undefined);
});
test('small decision output caps remain below the saved ceiling and have separate cache identities',async()=>{
  const h=harness(),user=randomUUID();let calls=0;
  for(const cap of [800,1200,800]){
    const value=await h.run(async run=>{calls++;assert.equal(run.maxOutputTokens,cap);return {cap};},{user,maxOutputTokens:cap});
    assert.equal(value.cap,cap);
  }
  assert.equal(calls,2);
  assert.equal(await h.run(async run=>run.maxOutputTokens,{maxOutputTokens:undefined}),8000);
  assert.equal(await h.run(async run=>run.maxOutputTokens,{maxOutputTokens:99999}),8000);
  h.state.settings.max_output_tokens=512;
  assert.equal(await h.run(async run=>run.maxOutputTokens,{maxOutputTokens:800}),512);
  assert.equal(await h.run(async run=>run.maxOutputTokens,{maxOutputTokens:1}),256);
  const count=h.state.reservations.length;
  await assert.rejects(h.run(async()=>assert.fail('Invalid cap reached provider'),{maxOutputTokens:NaN}),/positive integer/);
  assert.equal(h.state.reservations.length,count);
});
