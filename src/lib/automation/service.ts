import 'server-only';
import {prepareCampaignRetry} from '@/lib/agents/campaign-checkpoint-core.mjs';
import { randomUUID } from 'node:crypto';
import { conversationUser } from '@/lib/agents/conversation-api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { byId } from '@/lib/agents/people';
import { canManageDepartment, templateFor, textInput, UUID, mayTransition } from './core.mjs';
import type { AutomationTask } from './types';
import { resumeHeadWorkflow } from './head-task-core.mjs';

export class WorkflowError extends Error { constructor(message:string,public status=400){super(message);} }
export async function workflowSession() {
  const session=await conversationUser();
  if(!session)throw new WorkflowError('Please sign in.',401);
  const depts=await session.db.from('departments').select('id,name,human_head_role,ai_lead_agent');
  if(depts.error)throw new WorkflowError('Could not verify department access.',503);
  return {...session,departments:depts.data||[],admin:supabaseAdmin()};
}
export type WorkflowSession=Awaited<ReturnType<typeof workflowSession>>;
export function requireDepartment(s:WorkflowSession,departmentId:string) {
  if(!canManageDepartment(s.role,departmentId,s.departments))throw new WorkflowError('This workflow belongs to another department.',403);
}
export function requireAdmin(s:WorkflowSession) {if(s.role!=='super_admin')throw new WorkflowError('Only the Super Admin can change automation settings.',403);}
export async function taskFor(s:WorkflowSession,id:unknown) {
  if(typeof id!=='string'||!UUID.test(id))throw new WorkflowError('Choose a valid task.');
  const r=await s.db.from('automation_tasks').select('*').eq('id',id).maybeSingle();
  if(r.error)throw new WorkflowError('Could not read this task.',503);
  if(!r.data)throw new WorkflowError('Task not found.',404);
  requireDepartment(s,r.data.department_id);
  return r.data as AutomationTask;
}
export async function taskEvent(s:WorkflowSession,id:string,text:string,kind='decision',agentId?:string) {
  const result=await s.admin.from('automation_events').insert({task_id:id,kind,text:text.slice(0,6000),agent_id:agentId||null});
  if(result.error)throw new WorkflowError('The change was saved, but its activity note could not be saved. Refresh before retrying.',503);
}
export async function requireQueueCapacity(s:WorkflowSession) {
  const open=await s.admin.from('automation_tasks').select('id',{count:'exact',head:true}).eq('created_by',s.user.id).in('status',['queued','running']);
  if(open.error)throw new WorkflowError('Could not check the work queue.',503);
  if((open.count||0)>=20)throw new WorkflowError('Twenty tasks are already queued or running. Let some finish before adding more.',429);
}
export async function createTask(s:WorkflowSession,body:Record<string,any>,sourceKey?:string) {
  const template=templateFor(body.kind);if(!template)throw new WorkflowError('Choose a workflow.');
  const chosenOwner=['follow_up','head_task'].includes(body.kind);
  const ownerId=chosenOwner?textInput(body.ownerAgent,80,true):template.ownerAgent;
  const owner=await s.db.from('agents').select('id,department_id,enabled,is_lead').eq('id',ownerId).maybeSingle();
  if(owner.error||!owner.data?.enabled||!byId[ownerId]||byId[ownerId].human)throw new WorkflowError('Choose an enabled AI agent.');
  const selectedOwner=owner.data;
  if(body.kind==='head_task'&&(!selectedOwner.is_lead||!s.departments.some(d=>d.id===selectedOwner.department_id&&d.ai_lead_agent===ownerId&&d.human_head_role!=='viewer')))throw new WorkflowError('Choose the enabled AI head assigned to this department.');
  const dept=chosenOwner?selectedOwner.department_id:template.departmentId;
  requireDepartment(s,dept);
  const title=textInput(body.title||template.label,180,true),brief=textInput(body.brief||template.description,6000,true);
  const requestId=body.requestId;
  if(!sourceKey&&(typeof requestId!=='string'||!UUID.test(requestId)))throw new WorkflowError('A valid request identifier is required.');
  const key=sourceKey||`manual:${s.user.id}:${requestId}`;
  const existing=await s.admin.from('automation_tasks').select('id,kind,created_by,brief,title,owner_agent,department_id').eq('source_key',key).maybeSingle();
  if(existing.error)throw new WorkflowError('Could not verify the request.',503);
  if(existing.data){
    if(existing.data.created_by!==s.user.id||existing.data.kind!==body.kind||existing.data.brief!==brief||existing.data.title!==title||existing.data.owner_agent!==ownerId||existing.data.department_id!==dept)throw new WorkflowError('This request identifier was already used for different work.',409);
    return existing.data.id as string;
  }
  const dependencies=Array.isArray(body.dependsOn)?[...new Set(body.dependsOn)]:[];
  if(dependencies.length>12||dependencies.some(id=>typeof id!=='string'||!UUID.test(id)))throw new WorkflowError('Choose up to 12 valid prerequisite tasks.');
  for(const id of dependencies)await taskFor(s,id);
  const parent=body.parentId?await taskFor(s,body.parentId):null;
  let dueAt:string|null=null;
  if(body.dueAt){const d=new Date(body.dueAt);if(!Number.isFinite(d.getTime()))throw new WorkflowError('Enter a valid deadline.');dueAt=d.toISOString();}
  const priority=Number(body.priority||2);if(![1,2,3].includes(priority))throw new WorkflowError('Choose a valid priority.');
  // Only known inputs reach a handler; callers cannot inject queue state or executable tool payloads.
  const input:Record<string,unknown>={trigger:'manual'};
  if(body.kind==='head_task')input.allowedDepartments=s.departments.filter(d=>canManageDepartment(s.role,d.id,s.departments)).map(d=>d.id);
  if(body.kind==='customer') {
    if(body.input?.inquiryId){
      const inquiry=await s.db.from('automation_inquiries').select('id').eq('id',body.input.inquiryId).maybeSingle();
      if(inquiry.error||!inquiry.data)throw new WorkflowError('Choose an enquiry you can access.');input.inquiryId=inquiry.data.id;
    } else input.inquiry=brief;
  }
  if(body.kind==='catalogue'&&Array.isArray(body.input?.productIds))input.productIds=body.input.productIds.filter((id:unknown)=>Number.isSafeInteger(id)&&Number(id)>0).slice(0,3);
  await requireQueueCapacity(s);
  const row={kind:template.kind,department_id:dept,owner_agent:ownerId,created_by:s.user.id,title,brief,priority,input,
    source_key:key,parent_id:parent?.id||null,depends_on:dependencies,due_at:dueAt,
  };
  const saved=await s.admin.from('automation_tasks').insert(row).select('id').single();
  if(saved.error){
    if(saved.error.code==='23505'){
      const again=await s.admin.from('automation_tasks').select('id,kind,created_by,brief,title,owner_agent,department_id').eq('source_key',key).maybeSingle();
      if(again.data){
        if(again.data.created_by!==s.user.id||again.data.kind!==body.kind||again.data.brief!==brief||again.data.title!==title||again.data.owner_agent!==ownerId||again.data.department_id!==dept)throw new WorkflowError('This request identifier was already used for different work.',409);
        return again.data.id as string;
      }
    }
    throw new WorkflowError('Could not save this workflow.',503);
  }
  await taskEvent(s,saved.data.id,`Assigned to ${byId[ownerId].name}.`,'created',ownerId);
  return saved.data.id as string;
}
export async function transitionTask(s:WorkflowSession,body:Record<string,any>) {
  const task=await taskFor(s,body.id);
  if(!Number.isInteger(body.revision)||task.revision!==body.revision)throw new WorkflowError('This task changed. Refresh before deciding.',409);
  if(task.state.executionPending)throw new WorkflowError('An action is in progress or needs reconciliation. Check its result first.',409);
  if(!mayTransition(task.status,body.action))throw new WorkflowError('This action is not available in the current task state.',409);
  if(task.kind==='head_task'&&['accept','complete'].includes(body.action))throw new WorkflowError('Review this head-approved output in Approvals. Accept, send back or reject it there.',409);
  if(task.kind==='head_task'&&body.action==='cancel') {
    const cancelled=await s.admin.rpc('cancel_head_task',{p_task_id:task.id,p_revision:body.revision,p_user_id:s.user.id});
    if(cancelled.error||!cancelled.data)throw new WorkflowError('This task changed. Refresh before cancelling.',409);
    return task.id;
  }
  if(body.action==='complete'&&task.kind!=='follow_up')throw new WorkflowError('Retry the workflow after resolving its missing inputs.');
  const note=textInput(body.note,3000,body.action==='complete');
  const status=body.action==='retry'?'queued':body.action==='cancel'?'cancelled':'completed';
  const patch:Record<string,unknown>={status,claimed_by:null,lease_until:null,error:null,finished_at:status==='queued'?null:new Date().toISOString()};
  if(status==='queued')patch.next_run_at=new Date().toISOString();
  if(note)patch.state={...task.state,completionNote:note};
  if(task.kind==='head_task'&&body.action==='retry') {
    const state:Record<string,any>={...task.state,headWorkflow:resumeHeadWorkflow(task.state.headWorkflow)};
    delete state.blockedReason;delete state.retryAt;
    patch.state=state;
    patch.result=null;
  }
  const changed=await s.admin.from('automation_tasks').update(patch).eq('id',task.id).eq('revision',body.revision).eq('status',task.status).select('id').maybeSingle();
  if(changed.error||!changed.data)throw new WorkflowError('This task changed. Refresh before deciding.',409);
  if(body.action==='cancel'&&task.kind==='campaign') {
    const stopped=await s.admin.from('agent_runs').update({status:'cancelled'}).eq('automation_task_id',task.id).eq('status','running');
    if(stopped.error)throw new WorkflowError('The task was cancelled, but campaign production needs a manual check.',503);
  }
  if(body.action==='retry'&&task.kind==='campaign') {
    const run=await s.admin.from('agent_runs').select('id,state').eq('automation_task_id',task.id).eq('status','failed').maybeSingle();
    if(run.error)throw new WorkflowError('Could not check campaign retry progress.',503);
    if(run.data){const state=prepareCampaignRetry(run.data.state);const retried=await s.admin.from('agent_runs').update({status:'running',error:null,state}).eq('id',run.data.id).eq('status','failed');if(retried.error)throw new WorkflowError('The workflow is queued, but campaign production needs a manual check.',503);}
  }
  await taskEvent(s,task.id,`${body.action==='accept'?'Deliverable accepted':body.action==='complete'?'Follow-up completed':body.action==='retry'?'Retry queued':'Task cancelled'}${note?`: ${note}`:'.'}`);
  return task.id;
}
export async function createFollowUp(s:WorkflowSession,body:Record<string,any>) {
  const parent=await taskFor(s,body.id);
  if(parent.revision!==body.revision)throw new WorkflowError('This task changed. Refresh first.',409);
  return createTask(s,{...body,kind:'follow_up',parentId:parent.id,requestId:body.requestId||randomUUID()});
}
