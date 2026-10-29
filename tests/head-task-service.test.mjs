import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as core from '../src/lib/automation/core.mjs';
import * as headCore from '../src/lib/automation/head-task-core.mjs';
import {headTaskDepartments} from '../src/lib/automation/head-task-access.mjs';
const depts=[{id:'creative',human_head_role:'creative_head',ai_lead_agent:'creativeDirector'},{id:'board',human_head_role:'super_admin',ai_lead_agent:'cmo'}];
const owner={id:'creativeDirector',department_id:'creative',enabled:true,is_lead:true};
const task={id:'00000000-0000-4000-8000-000000000001',kind:'head_task',owner_agent:'creativeDirector',department_id:'creative',created_by:'person',revision:2,status:'review',state:{headWorkflow:{}},input:{allowedDepartments:['creative','board']}};
const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/automation/service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(role='creative_head') {
 const state={task:structuredClone(task),owner:{...owner},inserted:[],existing:null,rpc:[],updates:[],count:0};
 const db={from(table){let operation='select',payload,head=false;const filters={};const q={select:(_cols,opts)=>{head=!!opts?.head;return q;},eq:(k,v)=>{filters[k]=v;return q;},in:()=>q,insert:p=>{operation='insert';payload=p;return q;},update:p=>{operation='update';payload=p;return q;},single:()=>q,maybeSingle:()=>q,then:(resolve,reject)=>Promise.resolve().then(()=>{
  if(table==='agents')return {data:state.owner,error:null};
  if(table==='automation_events')return {error:null};
  if(table==='automation_tasks'){
   if(operation==='insert'){state.inserted.push(payload);return {data:{id:task.id},error:null};}
   if(operation==='update'){state.updates.push(payload);return {data:{id:task.id},error:null};}
   if(head)return {count:state.count,error:null};
   return {data:filters.source_key?state.existing:state.task,error:null};
  }
  throw new Error(`Unexpected table ${table}`);
 }).then(resolve,reject)};return q;},rpc:async(name,args)=>{state.rpc.push({name,args});return {data:task.id,error:null};}};
 const modules={'server-only':{},'node:crypto':{randomUUID:()=>task.id},'@/lib/agents/conversation-api':{},'@/lib/supabase/admin':{},'@/lib/agents/people':{byId:{creativeDirector:{name:'Creative head'},cmo:{name:'CMO'}}},'./core.mjs':core,'./head-task-core.mjs':headCore};
 const exports={};new Function('exports','require',compiled)(exports,name=>modules[name]);
 return {state,api:exports,session:{db,admin:db,user:{id:'person'},role,departments:depts}};
}
const request={kind:'head_task',ownerAgent:'creativeDirector',title:'Write a draft',brief:'Prepare a short caption for review.',requestId:'00000000-0000-4000-8000-000000000002',input:{allowedDepartments:['board']}};
test('head task creation derives current authorized scope and ignores browser-forged departments',async()=>{
 const h=harness();await h.api.createTask(h.session,request);
 assert.deepEqual(h.state.inserted[0].input.allowedDepartments,['creative']);assert.equal(h.state.inserted[0].owner_agent,'creativeDirector');assert.equal(h.state.inserted[0].department_id,'creative');
});
test('creation rejects ordinary agents, unassigned heads and other departments before saving',async()=>{
 const h=harness();h.state.owner.is_lead=false;await assert.rejects(h.api.createTask(h.session,request),/assigned to this department/);
 h.state.owner={...owner,id:'cmo',department_id:'board'};await assert.rejects(h.api.createTask(h.session,{...request,ownerAgent:'cmo'}),/another department/);
 h.state.owner={...owner,id:'cmo'};await assert.rejects(h.api.createTask(h.session,{...request,ownerAgent:'cmo'}),/assigned to this department/);assert.equal(h.state.inserted.length,0);
});
test('request identifier cannot silently redirect a task previously assigned to another head',async()=>{
 const h=harness();h.state.existing={...request,id:task.id,created_by:'person',owner_agent:'cmo',department_id:'board'};
 await assert.rejects(h.api.createTask(h.session,request),e=>e.status===409);assert.equal(h.state.inserted.length,0);
});
test('human acceptance uses Approvals and cancellation uses the atomic linked-report RPC',async()=>{
 const h=harness();await assert.rejects(h.api.transitionTask(h.session,{id:task.id,revision:2,action:'accept'}),/Approvals/);
 await h.api.transitionTask(h.session,{id:task.id,revision:2,action:'cancel'});
 assert.deepEqual(h.state.rpc,[{name:'cancel_head_task',args:{p_task_id:task.id,p_revision:2,p_user_id:'person'}}]);assert.equal(h.state.updates.length,0);
});
test('retry after a handoff storage failure preserves approved work without replanning',async()=>{
 const h=harness();h.state.task.status='failed';h.state.task.state={blockedReason:'ai_budget',retryAt:'later',headWorkflow:{version:1,phase:'handoff',headAgentId:'creativeDirector',review:{decision:'approve',finalMarkdown:'Saved delivery'},outputs:{copywriter:{body:'Saved draft'}}}};
 await h.api.transitionTask(h.session,{id:task.id,revision:2,action:'retry'});
 assert.equal(h.state.updates[0].state.headWorkflow.phase,'handoff');assert.equal(h.state.updates[0].state.headWorkflow.review.finalMarkdown,'Saved delivery');assert.equal(h.state.updates[0].state.blockedReason,undefined);
});
test('runtime access can only narrow original scope and rejects revoked roles or changed head assignment',()=>{
 assert.deepEqual(headTaskDepartments('super_admin',owner,task,depts),['creative','board']);
 assert.deepEqual(headTaskDepartments('creative_head',owner,task,depts),['creative']);
 assert.deepEqual(headTaskDepartments('viewer',owner,task,depts),[]);
 assert.deepEqual(headTaskDepartments('super_admin',{...owner,is_lead:false},task,depts),[]);
 assert.deepEqual(headTaskDepartments('super_admin',owner,task,[{...depts[0],ai_lead_agent:'other'},depts[1]]),[]);
 assert.deepEqual(headTaskDepartments('super_admin',owner,{...task,input:{allowedDepartments:['creative']}},depts),['creative']);
 assert.deepEqual(headTaskDepartments('super_admin',owner,{...task,created_by:null},depts),[]);
});
