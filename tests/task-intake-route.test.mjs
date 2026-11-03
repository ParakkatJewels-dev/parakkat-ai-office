import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as intake from '../src/lib/agents/task-intake-core.mjs';

const code=ts.transpileModule(readFileSync(new URL('../src/app/api/tasks/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const userId='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222';
const heads=[{id:'cmo',name:'AI CMO',department_id:'board',is_lead:true,enabled:true},{id:'creativeDirector',name:'Creative Director',department_id:'creative',is_lead:true,enabled:true},{id:'seoLead',name:'SEO Lead',department_id:'seo',is_lead:true,enabled:true}];
const departments=heads.map(head=>({id:head.department_id,ai_lead_agent:head.id,human_head_role:'super_admin'}));
function harness(existing=null) {
  const state={created:[],enqueued:[],ran:[],prior:existing};
  const db={from:table=>{
    const filters=[];
    const q={select:()=>q,eq:(key,value)=>{filters.push(row=>row[key]===value);return q;},order:()=>q,limit:()=>q,maybeSingle:async()=>({data:((table==='agent_tasks'&&existing?.kind==='conversation')||(table==='automation_tasks'&&existing?.kind==='task'))?existing:null,error:null}),then:(resolve,reject)=>Promise.resolve({data:(table==='agents'?heads:table==='agent_threads'||table==='automation_tasks'?[]:[]).filter(row=>filters.every(fn=>fn(row))),error:null}).then(resolve,reject)};return q;
  },rpc:async(_name,args)=>{state.enqueued.push(args);return {data:{created:true,threadId:'33333333-3333-4333-8333-333333333333',taskId:'44444444-4444-4444-8444-444444444444'},error:null};}};
  const s={db,user:{id:userId},role:'super_admin',departments};
  const modules={
    'next/server':{after:fn=>void fn()},'@/lib/llm/openai':{canWrite:async()=>true,chatJSON:async()=>({agentId:'cmo'})},'@/lib/pause':{checkPause:async()=>{}},'@/lib/supabase/admin':{supabaseAdmin:()=>({})},
    '@/lib/agents/conversation':{runConversationTask:async()=>{state.ran.push('conversation');}},'@/lib/agents/conversation-api':{conversationError:()=> 'Could not start',uuid:value=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value)},
    '@/lib/agents/task-intake-core.mjs':intake,'@/lib/automation/core.mjs':{workflowOriginAllowed:origin=>origin==='https://office.example',canManageDepartment:()=>true},
    '@/lib/automation/service':{workflowSession:async()=>s,WorkflowError:class WorkflowError extends Error{constructor(message,status=400){super(message);this.status=status;}},createTask:async(_s,body)=>{state.created.push(body);return '55555555-5555-4555-8555-555555555555';}},
    '@/lib/automation/runner':{runAutomationQueue:async()=>{state.ran.push('automation');}},
  };
  const api={};new Function('exports','require',code)(api,name=>{assert.ok(name in modules,`Unexpected import ${name}`);return modules[name];});
  const post=(message,mode='auto')=>api.POST(new Request('https://office.example/api/tasks',{method:'POST',headers:{origin:'https://office.example','content-type':'application/json'},body:JSON.stringify({message,mode,clientId})}));
  return {state,post,api};
}

test('image work reaches the creative head and existing generation conversation',async()=>{
  const h=harness(),response=await h.post('Find the top selling chain and create 3 posters');
  assert.equal(response.status,202);assert.equal((await response.json()).agentId,'creativeDirector');
  assert.equal(h.state.enqueued[0].p_agent,'creativeDirector');assert.deepEqual(h.state.ran,['conversation']);assert.equal(h.state.created.length,0);
});

test('product artwork stays with the creative head even when the brief mentions sales',async()=>{
  const h=harness(),response=await h.post('Create three product designs for our sales campaign using Shopify product ID 123');
  assert.equal(response.status,202);assert.equal((await response.json()).agentId,'creativeDirector');
  assert.equal(h.state.enqueued[0].p_agent,'creativeDirector');
});

test('ordinary work enters the reviewed AI head workflow',async()=>{
  const h=harness(),response=await h.post('Prepare an SEO content audit');
  assert.equal(response.status,202);assert.equal((await response.json()).agentId,'seoLead');
  assert.equal(h.state.created[0].kind,'head_task');assert.equal(h.state.created[0].ownerAgent,'seoLead');assert.deepEqual(h.state.ran,['automation']);
});

test('a repeated client request returns its saved task without dispatching twice',async()=>{
  const h=harness({kind:'task',id:'saved-id',owner_agent:'seoLead'}),response=await h.post('Prepare an SEO content audit');
  assert.equal((await response.json()).id,'saved-id');assert.deepEqual(h.state.created,[]);assert.deepEqual(h.state.ran,[]);
});

test('cross-origin requests cannot enqueue work',async()=>{
  const h=harness();const response=await h.api.POST(new Request('https://office.example/api/tasks',{method:'POST',headers:{origin:'https://other.example','content-type':'application/json'},body:JSON.stringify({message:'Prepare an audit',clientId})}));
  assert.equal(response.status,403);assert.deepEqual(h.state.created,[]);assert.deepEqual(h.state.enqueued,[]);
});
