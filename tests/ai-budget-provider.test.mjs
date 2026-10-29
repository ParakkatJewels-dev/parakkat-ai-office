import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import {AiBudgetError} from '../src/lib/ai-budget-core.mjs';
import * as modelRouting from '../src/lib/llm/model-routing.mjs';
const source=readFileSync(new URL('../src/lib/llm/openai.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(){
  const state={status:{enabled:true,connected:true,usageBlocked:false,activeAccountId:'account1',models:{manager:'selected-manager',worker:'selected-worker'}},reservations:[],calls:[],usage:[],providerError:null,budgetError:null,observed:null,provider:'chatgpt'};
  class ChatGPTError extends Error {constructor(message,code){super(message);this.code=code;}}
  const modules={
    'server-only':{},'node:crypto':crypto,'@/lib/env':{has:()=>true,opt:(key,fallback)=>key==='LLM_PROVIDER'?state.provider:fallback},
    '@/lib/usage':{recordUsage:async value=>state.usage.push(value)},'./gemini':{geminiChat:async()=>assert.fail('No paid fallback from ChatGPT')},
    '@/lib/pause':{checkPause:async()=>{}},'@/lib/chatgpt/auth.mjs':{getChatGPTStatus:async()=>state.status},
    './chatgpt.mjs':{ChatGPTError,chatGPTJSON:async(tier,system,user,options)=>{state.calls.push({tier,system,user,options});if(state.providerError)throw state.providerError;return {value:{reply:'Done'},model:'selected-manager',inputTokens:120,outputTokens:40,usageKnown:true};}},
    '@/lib/agents/agent-work':{withModelWork:(_system,_options,fn)=>fn()},'./gemini-config':{getGeminiConfig:async()=>({apiKey:'unused-test-key'})},
    './nim-config':{canUseNim:async()=>false},'./nim':{nimChat:async()=>assert.fail('NIM is not selected in this test')},'./model-routing.mjs':modelRouting,
    '@/lib/ai-budget':{runAiBudgetedText:async(input,work)=>{if(state.budgetError)throw state.budgetError;state.reservations.push(input);return work({signal:new AbortController().signal,maxOutputTokens:512,reportUsage:value=>state.observed=value});}},
  };
  const exports={};new Function('exports','require',compiled)(exports,name=>{assert.ok(name in modules,name);return modules[name];});return {state,ChatGPTError,chat:(options)=>exports.chatJSON('manager','Current instructions','Saved facts',options)};
}
test('ChatGPT hook pins account/model, forwards budget output cap and reconciles actual metadata',async()=>{
  const h=harness();assert.deepEqual(await h.chat(),{reply:'Done'});assert.equal(h.state.reservations.length,1);assert.equal(h.state.calls.length,1);
  assert.equal(h.state.reservations[0].accountKey,'account1');assert.equal(h.state.reservations[0].model,'selected-manager');
  assert.equal(h.state.calls[0].options.maxOutputTokens,512);assert.equal(h.state.calls[0].options.expectedAccountId,'account1');assert.equal(h.state.calls[0].options.expectedModel,'selected-manager');
  assert.deepEqual(h.state.observed,{inputTokens:120,outputTokens:40,usageKnown:true});
});
test('known disconnected/paused provider eligibility rejects before reserving any allowance',async()=>{
  const h=harness();h.state.status.connected=false;await assert.rejects(h.chat(),e=>e.code==='authentication');h.state.status.connected=true;h.state.status.usageBlocked=true;
  await assert.rejects(h.chat(),e=>e.code==='usage_paused');assert.equal(h.state.reservations.length,0);assert.equal(h.state.calls.length,0);assert.equal(h.state.usage.length,0);
});
test('budget deferrals make no provider attempt or failed usage record, and provider errors never use paid fallback',async()=>{
  const h=harness();h.state.budgetError=new AiBudgetError('Wait','2026-10-27T10:00:00Z');await assert.rejects(h.chat(),e=>e.code==='ai_budget');assert.equal(h.state.calls.length,0);assert.equal(h.state.usage.length,0);
  h.state.budgetError=null;h.state.providerError=new Error('Provider rejected');await assert.rejects(h.chat(),/Provider rejected/);assert.equal(h.state.calls.length,1);assert.equal(h.state.usage.length,1);assert.equal(h.state.usage[0].ok,false);
});
test('review output caps reach admission and known failed usage reaches both budget and telemetry',async()=>{
  const h=harness();await h.chat({maxOutputTokens:800});assert.equal(h.state.reservations[0].maxOutputTokens,800);
  const usage={model:'selected-manager',inputTokens:321,outputTokens:800,usageKnown:true,reasoningTokens:200};
  h.state.providerError=Object.assign(new h.ChatGPTError('Response incomplete','incomplete'),{usage});
  await assert.rejects(h.chat(),error=>error.code==='incomplete');assert.deepEqual(h.state.observed,usage);
  const recorded=h.state.usage.at(-1);assert.equal(recorded.ok,false);assert.equal(recorded.input,321);assert.equal(recorded.output,800);assert.equal(recorded.model,'selected-manager');
  assert.equal(h.state.calls.length,2,'failed inference is never automatically retried');
});
