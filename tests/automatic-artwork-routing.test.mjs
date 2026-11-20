import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as routing from '../src/lib/artwork/provider-routing.mjs';

const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/artwork/automatic-routing.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const id='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222';
function harness(options={}) {
  const state={decision:null,chatJob:null,higgsJob:null,started:[],aiCalls:0,preflights:0};
  const db={from(table){
    const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:table==='designs'?{artwork_request_id:requestId,format:options.format||'portrait',brief:'Premium chain poster',headline:'Fine chain'}:table==='artwork_provider_decisions'?state.decision:table==='chatgpt_image_jobs'?state.chatJob:table==='artwork_generation_jobs'?state.higgsJob:null,error:null}),upsert:async proposal=>{state.decision??=proposal;return {error:null};}};
    return q;
  }};
  const modules={
    'server-only':{},'@/lib/supabase/admin':{supabaseAdmin:()=>db},'@/lib/llm/openai':{chatJSON:async()=>{state.aiCalls++;return options.suggestion||{provider:'higgsfield',reason:'The planned layout suits the connected Higgsfield workflow.'};}},
    './import-core.mjs':{validId:()=>true},'./server':{ArtworkError:class extends Error{},generationArtwork:async()=>{state.preflights++;if(options.referenceError)throw new Error('Google sign-in expired or was revoked');return {packet:{format:options.format||'portrait'},files:[{name:'official-product.png'}]};}},
    './generation-jobs':{authorizeGenerationPreparation:async()=>{}},'./generation':{higgsfieldRoutingAvailability:async()=>({ready:options.higgsfield!==false,models:['flux_context'],reason:'Disconnected'}),startAutomaticArtwork:async input=>{state.started.push({provider:'higgsfield',input});return {started:true};}},
    './chatgpt-worker':{chatGPTWorkerRoutingAvailability:async()=>({ready:options.chatgpt!==false}),startChatGPTArtwork:async input=>{state.started.push({provider:'chatgpt',input});return {started:true};}},
    './provider-routing.mjs':routing,
  };
  const exports={};new Function('exports','require',compiled)(exports,name=>{assert.ok(name in modules,`Unexpected import ${name}`);return modules[name];});
  return {state,route:()=>exports.routeAndStartArtwork({source:'design',item:{id},userId:id,role:'creative_head'})};
}

test('AI provider choice is saved and reused across an artwork retry',async()=>{
  const h=harness();
  assert.equal((await h.route()).provider,'higgsfield');
  assert.equal(h.state.decision.basis,'ai');
  assert.equal((await h.route()).provider,'higgsfield');
  assert.equal(h.state.aiCalls,1);
  assert.equal(h.state.started.length,2);
});
test('unhealthy ChatGPT worker routes to ready Higgsfield without calling AI',async()=>{
  const h=harness({chatgpt:false});
  assert.equal((await h.route()).provider,'higgsfield');
  assert.equal(h.state.decision.basis,'availability');
  assert.equal(h.state.aiCalls,0);
});
test('reference preflight fails before saving a provider or starting a job',async()=>{
  const h=harness({referenceError:true});
  await assert.rejects(h.route(),/Google sign-in expired/);
  assert.equal(h.state.decision,null);
  assert.equal(h.state.started.length,0);
});
