import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { localWorkSnapshot } from '../src/office/work-status-feed.mjs';
import { activityState, isWorkingStatus } from '../src/lib/agents/activity-core.mjs';

const code=ts.transpileModule(readFileSync(new URL('../src/components/useAgentWorkStatus.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const start=Date.parse('2026-10-26T12:00:00Z');
const payload=(ids=[],at=start)=>({observedAt:new Date(at).toISOString(),statuses:Object.fromEntries(ids.map(id=>[id,{state:'working',label:'Preparing a response',expiresAt:new Date(at+12000).toISOString()}]))});

/** Execute the real hook with deterministic state/effect lifetimes, clock and fetch. */
function harness(){
  let now=start,cursor=0,dirty=false,mounted=true,nextTimer=0,authCallback,unsubscribed=false,writesAfterUnmount=0;
  let value,hook;const states=[],effects=[],pendingEffects=[],timers=new Map(),requests=[],listeners=new Map();
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],next=>{if(!mounted){writesAfterUnmount++;return;}const result=typeof next==='function'?next(states[index]):next;if(!Object.is(result,states[index])){states[index]=result;dirty=true;}}];},
    useEffect(fn,deps){const index=cursor++,previous=effects[index];if(!previous||!same(previous.deps,deps)){pendingEffects.push(()=>{previous?.cleanup?.();effects[index]={deps,cleanup:fn()};});}},
  };
  const document={visibilityState:'visible',addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);}};
  const fetch=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));
  const schedule=(fn,ms,repeat=false)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms,ms,repeat});return id;};
  const clear=id=>timers.delete(id);
  const modules={react,'@/office/work-status-feed.mjs':{localWorkSnapshot},'@/lib/supabase/browser':{supabaseBrowser:()=>({auth:{onAuthStateChange:fn=>{authCallback=fn;return {data:{subscription:{unsubscribe:()=>{unsubscribed=true;}}}};}}})}};
  const exports={};
  new Function('exports','require','fetch','document','performance','Date','setTimeout','clearTimeout','setInterval','clearInterval','AbortController','AbortSignal',code)(exports,id=>{assert.ok(id in modules,`Unmocked import ${id}`);return modules[id];},fetch,document,{now:()=>now-start},{now:()=>now,parse:Date.parse},(fn,ms)=>schedule(fn,ms),clear,(fn,ms)=>schedule(fn,ms,true),clear,AbortController,{any:AbortSignal.any,timeout:()=>new AbortController().signal});
  hook=exports.useAgentWorkStatus;
  const render=()=>{cursor=0;dirty=false;value=hook(new Date(start).toISOString());while(pendingEffects.length)pendingEffects.shift()();};
  const flush=async()=>{for(let i=0;i<12;i++){await Promise.resolve();if(dirty&&mounted)render();}};
  const advance=async ms=>{const end=now+ms;let count=0;while(true){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;if(++count>100)throw new Error('Unexpected timer/fetch loop');const [id,timer]=next;now=timer.at;if(timer.repeat)timer.at+=timer.ms;else timers.delete(id);timer.fn();await flush();}now=end;await flush();};
  const respond=async(index,data,ok=true)=>{assert.ok(requests[index],`No pending fetch ${index}`);requests[index].resolve({ok,json:async()=>data});await flush();};
  render();
  return {requests,timers,document,flush,advance,respond,get value(){return value;},get now(){return now;},get writesAfterUnmount(){return writesAfterUnmount;},get unsubscribed(){return unsubscribed;},
    fail:async(index)=>{requests[index].reject(new Error('Network failed'));await flush();},
    auth:async(event,id)=>{authCallback(event,id?{user:{id}}:null);await flush();},
    visibility:async state=>{document.visibilityState=state;listeners.get('visibilitychange')?.();await flush();},
    unmount:()=>{mounted=false;for(const effect of effects)effect?.cleanup?.();},
  };
}

test('healthy empty snapshot means ready/zero; failed or malformed feed is unavailable, then recovers',async()=>{
  const h=harness();assert.equal(h.value.availability,'loading');assert.equal(h.requests.length,1);
  await h.respond(0,payload());assert.equal(h.value.availability,'ready');assert.deepEqual(h.value.statuses,{});
  await h.advance(4000);await h.fail(1);assert.equal(h.value.availability,'unavailable');assert.deepEqual(h.value.statuses,{});
  await h.advance(4000);await h.respond(2,{observedAt:'invalid',statuses:{}});assert.equal(h.value.availability,'unavailable');
  await h.advance(4000);await h.respond(3,payload([],h.now));assert.equal(h.value.availability,'ready');h.unmount();
});

test('actual work starts and completion clears it on next snapshot without a historical grace period',async()=>{
  const h=harness();await h.respond(0,payload(['designer']));assert.equal(isWorkingStatus(h.value.statuses.designer,h.value.now),true);
  await h.advance(4000);await h.respond(1,payload([],h.now));assert.deepEqual(h.value.statuses,{});assert.equal(h.value.availability,'ready');
  assert.equal(activityState(start,h.value.statuses.designer,h.value.now),'today');h.unmount();
});

test('clock renders never create extra polls and slow requests never overlap',async()=>{
  const h=harness();await h.respond(0,payload(['designer']));await h.advance(3999);assert.equal(h.requests.length,1);
  await h.advance(1);assert.equal(h.requests.length,2);await h.advance(9000);assert.equal(h.requests.length,2,'in-flight fetch does not spawn overlapping polls');
  assert.equal(h.value.availability,'unavailable','an unanswered fetch cannot keep an old snapshot current');assert.equal(isWorkingStatus(h.value.statuses.designer,h.value.now),false);
  await h.respond(1,payload([],h.now));assert.equal(h.value.availability,'ready');h.unmount();
});

test('HTTP auth/server failures clear active leases instead of reporting a healthy zero',async()=>{
  const h=harness();await h.respond(0,payload(['designer']));await h.advance(4000);await h.respond(1,{error:'Not allowed'},false);
  assert.equal(h.value.availability,'unavailable');assert.deepEqual(h.value.statuses,{});h.unmount();
});

test('a late response from the previous signed-in account cannot restore its working statuses',async()=>{
  const h=harness();await h.auth('INITIAL_SESSION','old-account');await h.auth('SIGNED_IN','new-account');
  assert.equal(h.requests.length,1);assert.equal(h.value.availability,'unavailable');
  await h.respond(0,payload(['oldAgent']));assert.deepEqual(h.value.statuses,{});assert.equal(h.value.availability,'unavailable');
  await h.advance(0);assert.equal(h.requests.length,2);await h.respond(1,payload(['newAgent'],h.now));
  assert.deepEqual(Object.keys(h.value.statuses),['newAgent']);h.unmount();
});

test('sign-out immediately clears live work and rejects an old in-flight response',async()=>{
  const h=harness();await h.auth('INITIAL_SESSION','person');await h.respond(0,payload(['designer']));
  await h.advance(4000);await h.auth('SIGNED_OUT',null);assert.equal(h.value.availability,'unavailable');assert.deepEqual(h.value.statuses,{});
  await h.respond(1,payload(['designer'],h.now));assert.deepEqual(h.value.statuses,{});assert.equal(h.value.availability,'unavailable');h.unmount();
});

test('hidden-page response is rejected and visibility recovery performs one fresh request',async()=>{
  const h=harness();await h.visibility('hidden');await h.respond(0,payload(['designer']));assert.equal(h.value.availability,'loading');assert.deepEqual(h.value.statuses,{});
  await h.advance(8000);assert.equal(h.requests.length,1);await h.visibility('visible');assert.equal(h.requests.length,2);
  await h.respond(1,payload([],h.now));assert.equal(h.value.availability,'ready');h.unmount();
});

test('unmount clears timers/subscription and a late response cannot update component state',async()=>{
  const h=harness();const signal=h.requests[0].options.signal;h.unmount();assert.equal(signal.aborted,true);assert.equal(h.unsubscribed,true);assert.equal(h.timers.size,0);
  await h.respond(0,payload(['designer']));assert.equal(h.writesAfterUnmount,0);assert.equal(h.requests.length,1);
});

// Inspect the actual UI classifier: history may stay visible but stale feed is never live work.
const activityCode=ts.transpileModule(readFileSync(new URL('../src/components/AgentActivity.tsx',import.meta.url),'utf8')+'\nexport const testedStateOf = stateOf;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const activityExports={};
const activityModules={react:{createContext:()=>({}),useContext:()=>{},useEffect:()=>{},useState:()=>{}},'react/jsx-runtime':{jsx:()=>{},jsxs:()=>{}},'@/lib/agents/activity-core.mjs':{activityState,isWorkingStatus},'./useAgentWorkStatus':{},'./Icon':{}};
new Function('exports','require',activityCode)(activityExports,id=>{assert.ok(id in activityModules,`Unmocked import ${id}`);return activityModules[id];});
test('badge/summary classifier gates live state on ready feed while preserving today’s observed completed work',()=>{
  const activity={history:{designer:null},seen:{designer:start-1000},statuses:localWorkSnapshot(payload(['designer']),0,start),availability:'ready',now:start};
  assert.equal(activityExports.testedStateOf(activity,'designer'),'now');
  assert.equal(activityExports.testedStateOf({...activity,availability:'unavailable'},'designer'),'today');
  assert.equal(activityExports.testedStateOf({...activity,availability:'loading'},'designer'),'today');
  assert.equal(activityExports.testedStateOf({...activity,statuses:{}},'designer'),'today');
});

test('future history cannot hide valid work observed today after its live lease finishes',()=>{
  const activity={history:{designer:new Date(start+86400000).toISOString()},seen:{designer:start-1000},statuses:{},availability:'ready',now:start};
  assert.equal(activityExports.testedStateOf(activity,'designer'),'today');
  assert.equal(activityExports.testedStateOf({...activity,seen:{}},'designer'),'quiet');
});
