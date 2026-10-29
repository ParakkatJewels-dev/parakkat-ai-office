import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as core from '../src/lib/llm/jev-core.mjs';

const source=name=>readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8');
function load(name,modules) {const compiled=ts.transpileModule(source(name),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('exports','require',compiled)(exports,id=>modules[id]||{});return exports;}
const key='jev-test-only-not-a-real-key-12345';
const questions={topic:{instructions:'Choose the recorded topic.',criteria:{stock:'Inventory',shipping:'Delivery'}}};
const response={model:'jev-latest',usage:{input_tokens:101,output_tokens:9},answers:{topic:{type:'choice',choice:'stock',confidence:.9,probabilities:{stock:.95,shipping:.05}}}};
function classifier(options={}) {
  const state={prompts:0,requests:[],budget:[],reported:[],usage:[],health:[],fallback:0,work:[],pauseChecks:0};
  const config={apiKey:options.missing?'':key,model:'jev-latest',source:options.missing?'none':'saved'};
  const modules={
    'server-only':{},'node:crypto':crypto,
    './openai':{chatJSON:async()=>{state.fallback++;return {topic:{choice:'stock',confidence:.8}};}},
    '@/lib/usage':{recordUsage:async value=>state.usage.push(value)},
    '@/lib/pause':{checkPause:async()=>{state.pauseChecks++;if(options.paused)throw Object.assign(new Error('Paused'),{name:'Paused'});}},
    '@/lib/agents/agent-instructions':{agentPrompt:async()=>{state.prompts++;return 'Agent identity: sales\nUnique saved guidance';}},
    '@/lib/agents/agent-work':{withAgentWork:(scope,fn)=>{state.work.push(scope);return fn();}},
    '@/lib/ai-budget':{runAiBudgetedText:async(input,work)=>{state.budget.push(input);if(options.budgetError)throw options.budgetError;return work({signal:AbortSignal.timeout(1000),maxOutputTokens:800,reportUsage:value=>state.reported.push(value)});}},
    './jev-config':{getJevConfig:async()=>config,canClassifyWithJev:async()=>!!config.apiKey,recordJevResult:async(_config,error)=>state.health.push(error||null)},
    './jev-core.mjs':{...core,jevRequest:async request=>{state.requests.push(request);if(options.failure)throw options.failure;return options.response||response;}},
  };
  return {state,adapter:load('lib/llm/jev.ts',modules)};
}

test('configured classifier sends guidance once, budgets the actual serialized body once and records real usage',async()=>{
  const h=classifier();await h.adapter.classify('Recorded inventory',questions,{db:{},id:'sales'});
  assert.equal(h.state.requests.length,1);assert.equal(h.state.prompts,1);assert.equal(h.state.fallback,0);assert.equal(h.state.budget[0].system,'');
  assert.equal(h.state.budget[0].user,JSON.stringify(h.state.requests[0].body));assert.equal(h.state.budget[0].timeoutMs,30000);assert.equal(h.state.work[0].timeoutMs,30000);
  assert.equal(h.state.budget[0].user.split('Unique saved guidance').length-1,1);assert.ok(!h.state.budget[0].accountKey.includes(key));
  assert.deepEqual(h.state.reported,[{inputTokens:101,outputTokens:9,usageKnown:true}]);assert.equal(h.state.usage[0].input,101);assert.equal(h.state.usage[0].output,9);assert.equal(h.state.usage[0].ok,true);
});

test('supplied current system avoids an extra prompt read, and another agent identity is rejected',async()=>{
  const h=classifier();await h.adapter.classify('facts',questions,{db:{},id:'sales'},{system:'Agent identity: sales\nPrepared fresh guidance',requireJev:true});
  assert.equal(h.state.prompts,0);assert.match(h.state.requests[0].body.state.agentGuidance,/Prepared fresh guidance/);
  await assert.rejects(h.adapter.classify('facts',questions,{db:{},id:'sales'},{system:'Agent identity: cmo\nOther guidance',requireJev:true}),e=>e.code==='invalid_request');assert.equal(h.state.requests.length,1);
});

test('invalid answers settle known failed usage; transport failures stay unknown and never trigger paid fallback',async()=>{
  const invalid=classifier({response:{...response,answers:{}}});await assert.rejects(invalid.adapter.classify('facts',questions,{db:{},id:'sales'}),e=>e.code==='invalid_response');
  assert.deepEqual(invalid.state.reported,[{inputTokens:101,outputTokens:9,usageKnown:true}]);assert.equal(invalid.state.usage[0].ok,false);assert.equal(invalid.state.usage[0].input,101);assert.equal(invalid.state.requests.length,1);assert.equal(invalid.state.fallback,0);
  const network=classifier({failure:new core.JevError('Jev unavailable','network')});await assert.rejects(network.adapter.classify('facts',questions,{db:{},id:'sales'}));
  assert.equal(network.state.requests.length,1);assert.equal(network.state.reported.length,0);assert.equal(network.state.usage[0].input,undefined);assert.equal(network.state.fallback,0);
});

test('pause and budget refusal prevent Jev requests, health updates and fallback calls',async()=>{
  for(const options of [{paused:true},{budgetError:new Error('Budget blocked')}]) {
    const h=classifier(options);await assert.rejects(h.adapter.classify('facts',questions,{db:{},id:'sales'}));assert.equal(h.state.requests.length,0);assert.equal(h.state.health.length,0);assert.equal(h.state.fallback,0);
  }
});

test('missing key can preserve legacy compliance fallback but required Jev routing never spends elsewhere',async()=>{
  const legacy=classifier({missing:true});await legacy.adapter.classify('facts',questions,{db:{},id:'sales'});assert.equal(legacy.state.fallback,1);assert.equal(legacy.state.requests.length,0);
  const required=classifier({missing:true});await assert.rejects(required.adapter.classify('facts',questions,{db:{},id:'sales'},{requireJev:true}),e=>e.code==='missing_key');assert.equal(required.state.fallback,0);assert.equal(required.state.requests.length,0);assert.equal(required.state.prompts,0);
});

function actions(options={}) {
  const state={config:0,checks:0,saves:[],tests:0,syncs:0,restores:0,locks:[],usage:[]};
  const modules={
    'node:crypto':crypto,'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect:location=>{throw Object.assign(new Error('redirect'),{location});}},
    '@/lib/auth/session':{requireUser:async()=>({role:options.role||'super_admin'})},
    '@/lib/supabase/admin':{supabaseAdmin:()=>({rpc:async(name,args)=>{state.locks.push({name,args});return {data:!options.locked,error:null};}})},
    '@/lib/llm/jev-config':{getJevConfig:async()=>{state.config++;return {apiKey:key,model:'jev-latest'};},saveJevOverride:async value=>state.saves.push(value),syncJevStatus:async()=>state.syncs++,removeJevOverride:async()=>state.restores++,safeJevError:error=>error instanceof core.JevError?error.message:'The Jev connection could not be updated.'},
    '@/lib/llm/jev-core.mjs':{...core,checkJevModels:async()=>{state.checks++;if(options.checkError)throw options.checkError;return true;}},
    '@/lib/llm/jev':{testJevClassification:async()=>{state.tests++;if(options.testError)throw options.testError;}},
    '@/lib/pause':{Paused:class extends Error{}},'@/lib/usage':{withUsage:(scope,fn)=>{state.usage.push(scope);return fn();}},'@/lib/ai-budget':{isAiBudgetError:error=>error?.code==='ai_budget'},
  };
  return {state,actions:load('app/(app)/admin/jev-actions.ts',modules)};
}
const form=values=>{const result=new FormData();for(const [key,value]of Object.entries(values))result.set(key,value);return result;};
const redirect=fn=>assert.rejects(fn,error=>typeof error.location==='string');

test('all Jev mutations require Super Admin before configuration or provider access',async()=>{
  for(const action of ['saveJevKey','runJevTest','useJevServerKey']) {
    const h=actions({role:'creative_head'});await assert.rejects(h.actions[action](form({key,classify:'yes'})),e=>e.location==='/office');assert.equal(h.state.config,0);assert.equal(h.state.checks,0);assert.equal(h.state.tests,0);assert.equal(h.state.restores,0);assert.equal(h.state.locks.length,0);
  }
});

test('Save validates model access and stores the key without running classification',async()=>{
  const h=actions();await redirect(h.actions.saveJevKey(form({key})));assert.equal(h.state.checks,1);assert.deepEqual(h.state.saves,[key]);assert.equal(h.state.tests,0);assert.equal(h.state.syncs,1);
  const invalid=actions({checkError:new Error(key)});await assert.rejects(invalid.actions.saveJevKey(form({key})),e=>e.location.includes('error=')&&!e.location.includes(key));assert.equal(invalid.state.saves.length,0);
});

test('classification test requires explicit input, holds one lock, and releases it on failure',async()=>{
  const missing=actions();await redirect(missing.actions.runJevTest(form({})));assert.equal(missing.state.tests,0);assert.equal(missing.state.locks.length,0);
  const h=actions({testError:new core.JevError('Jev unavailable','network')});await redirect(h.actions.runJevTest(form({classify:'yes'})));assert.equal(h.state.tests,1);assert.deepEqual(h.state.locks.map(x=>x.name),['acquire_job_lock','release_job_lock']);assert.equal(h.state.usage[0].feature,'connection_test');
  const locked=actions({locked:true});await redirect(locked.actions.runJevTest(form({classify:'yes'})));assert.equal(locked.state.tests,0);
});

test('Jev settings UI only receives public status, keeps a blank password field and separates paid Test from Save',()=>{
  const card=source('app/(app)/admin/JevCard.tsx'),integrations=source('app/(app)/admin/Integrations.tsx'),sync=source('lib/agents/sync.ts');
  assert.match(card,/getJevStatus/);assert.doesNotMatch(card,/getJevConfig|config\.apiKey|defaultValue=/);assert.match(card,/type="password"/);assert.match(card,/action=\{saveJevKey\}/);assert.match(card,/action=\{runJevTest\}/);assert.match(card,/usage charges may apply/);assert.match(integrations,/<JevCard \/>/);assert.match(sync,/await syncJevStatus\(\)/);assert.doesNotMatch(sync,/\['jev', 'JEV_API_KEY'\]/);
});
