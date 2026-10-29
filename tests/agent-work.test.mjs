import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createAgentWorkRuntime} from '../src/lib/agents/agent-work-core.mjs';
import {agentFromPrompt} from '../src/lib/usage-cost.mjs';

const people=[{id:'host'},{id:'worker'},{id:'human',human:true}];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness() {
  let now=1_000_000,id=0;const timers=new Map();
  const add=(fn,ms,repeat)=>{const key=++id;timers.set(key,{fn,ms,repeat,at:now+ms});return key;};
  const runtime=createAgentWorkRuntime({people,now:()=>now,makeId:()=>`work${++id}`,setTimeout:(fn,ms)=>add(fn,ms,false),clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>add(fn,ms,true),clearInterval:id=>timers.delete(id)});
  const advance=(ms,stalled=false)=>{
    const end=now+ms;
    while(true){const item=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;
      const [key,value]=item;now=stalled?end:value.at;if(value.repeat)value.at=now+value.ms;else timers.delete(key);value.fn();}
    now=end;
  };
  return {runtime,advance,timers,now:()=>now,read:(ids=['host','worker','human'])=>runtime.read(ids)};
}

test('live work appears only during an executing scope and clears after success or original failure',async()=>{
  const h=harness(),work=deferred();const pending=h.runtime.run({agentId:'host',kind:'conversation'},()=>work.promise);
  assert.deepEqual(Object.keys(h.read()),['host']);assert.equal(h.read().host.label,'Working on a manager’s task');
  work.resolve('actual result');assert.equal(await pending,'actual result');assert.deepEqual(h.read(),{});assert.equal(h.timers.size,0);
  const error=new Error('provider private body');await assert.rejects(h.runtime.run({agentId:'host'},async()=>{throw error;}),e=>e===error);assert.deepEqual(h.read(),{});
});
test('concurrent work for the same agent has independent ownership and completion cannot clear its sibling',async()=>{
  const h=harness(),one=deferred(),two=deferred();
  const first=h.runtime.run({agentId:'host',kind:'text'},()=>one.promise);h.advance(1000);
  const second=h.runtime.run({agentId:'host',kind:'image'},()=>two.promise);assert.equal(h.read().host.label,'Creating an image');
  two.resolve();await second;assert.equal(h.read().host.label,'Preparing a response');
  one.resolve();await first;assert.deepEqual(h.read(),{});
});
test('nested same-agent model work reuses its outer lifetime while another specialist receives its own status',async()=>{
  const h=harness(),outer=deferred();
  const pending=h.runtime.run({agentId:'host',kind:'conversation'},async()=>{
    await h.runtime.run({agentId:'host',kind:'text'},async()=>{assert.equal(h.read().host.label,'Working on a manager’s task');});
    await h.runtime.run({agentId:'worker',kind:'review'},async()=>{assert.deepEqual(Object.keys(h.read()).sort(),['host','worker']);});
    assert.deepEqual(Object.keys(h.read()),['host']);return outer.promise;
  });
  await Promise.resolve();await Promise.resolve();assert.equal(h.read().host.label,'Working on a manager’s task');outer.resolve();await pending;assert.deepEqual(h.read(),{});
});
test('renewals cannot exceed caller hard deadline and client snapshots expire within twelve seconds',async()=>{
  const h=harness(),work=deferred();const pending=h.runtime.run({agentId:'host',timeoutMs:45_000},()=>work.promise);
  assert.equal(Date.parse(h.read().host.expiresAt)-h.now(),12_000);h.advance(40_000);
  assert.equal(Date.parse(h.read().host.expiresAt)-h.now(),5000);h.advance(5001);assert.deepEqual(h.read(),{});assert.equal(h.timers.size,0);
  work.resolve();await pending;
});
test('a stalled process cannot renew an expired work lease, and restart has no historical status',async()=>{
  const h=harness(),work=deferred();const pending=h.runtime.run({agentId:'host',timeoutMs:300_000},()=>work.promise);
  h.advance(75_000,true);assert.deepEqual(h.read(),{});assert.equal(h.timers.size,0);
  assert.deepEqual(createAgentWorkRuntime({people}).read(['host']),{});work.resolve();await pending;
});
test('abort clears status immediately without replacing the callback outcome',async()=>{
  const h=harness(),work=deferred(),controller=new AbortController();const pending=h.runtime.run({agentId:'host',signal:controller.signal},()=>work.promise);
  controller.abort();assert.deepEqual(h.read(),{});assert.equal(h.timers.size,0);work.resolve('late actual outcome');assert.equal(await pending,'late actual outcome');
  let called=0;await h.runtime.run({agentId:'host',signal:controller.signal},async()=>{called++;assert.deepEqual(h.read(),{});});assert.equal(called,1);
});
test('read allowlists and fixed labels cannot expose private content, humans or unknown agents',async()=>{
  const h=harness(),work=deferred();const pending=h.runtime.run({agentId:'host',kind:'PRIVATE prompt',label:'PRIVATE campaign',taskId:'PRIVATE task'},()=>work.promise);
  assert.deepEqual(h.read(['worker']),{});assert.doesNotMatch(JSON.stringify(h.read()),/PRIVATE|taskId|work\d/);assert.equal(h.read().host.label,'Preparing a response');
  for(const agentId of ['human','missing'])await h.runtime.run({agentId,kind:'image'},async()=>assert.equal(h.read()[agentId],undefined));
  work.resolve();await pending;
});
test('hard deadlines are capped even when a caller supplies an unbounded duration',async()=>{
  const h=harness(),work=deferred();const pending=h.runtime.run({agentId:'host',timeoutMs:10_000_000},()=>work.promise);
  h.advance(300_001);assert.deepEqual(h.read(),{});work.resolve();await pending;
});

test('separately bundled server helpers share live state and resolve stable prompt identity without leaking text',async()=>{
  const source=readFileSync(new URL('../src/lib/agents/agent-work.ts',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'').replace(/^export type .*;\s*$/gm,'');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const build=()=>{const exports={};new Function('exports','PEOPLE','agentFromPrompt','currentUsageScope','createAgentWorkRuntime',compiled)(exports,people,agentFromPrompt,()=>({feature:'agent_conversation'}),createAgentWorkRuntime);return exports;};
  const a=build(),b=build(),work=deferred();const pending=a.withModelWork('Agent identity: worker\nPRIVATE task',{timeoutMs:10_000},()=>work.promise);
  assert.equal(b.readAgentWork(['worker']).worker.label,'Working on a manager’s task');assert.deepEqual(b.readAgentWork(['host']),{});assert.doesNotMatch(JSON.stringify(b.readAgentWork(['worker'])),/PRIVATE/);
  work.resolve();await pending;assert.deepEqual(b.readAgentWork(['worker']),{});
});

test('central model and named non-model workflows remain wired to real execution scopes',()=>{
  const read=path=>readFileSync(new URL(`../src/lib/${path}`,import.meta.url),'utf8');
  for(const path of ['llm/openai.ts','llm/gemini.ts'])assert.match(read(path),/return withModelWork\(/);
  assert.match(read('llm/jev.ts'),/return withAgentWork\(\{agentId:agent.id,kind:'classification'/);
  assert.match(read('agents/conversation.ts'),/withAgentWork\(\{agentId:task.agent_id,kind:'conversation'/);
  assert.match(read('agents/library.ts'),/withAgentWork\(\{agentId:'designer',kind:'library_scan'/);
  assert.match(read('agents/sync.ts'),/withAgentWork\(\{agentId:j.bot/);
  assert.match(read('agents/sync.ts'),/withAgentWork\(\{agentId:'shopifySync',kind:'sync_odoo'/);
  assert.match(read('agents/autopilot.ts'),/withAgentWork\(\{\.\.\.JOB_AGENTS\[job.name\]/);
});
