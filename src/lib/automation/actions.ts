import 'server-only';
import { checkPause } from '@/lib/pause';
import { prepareCatalogueUpdate, applyCatalogueUpdate } from '@/lib/connectors/shopify-catalogue';
import { sendInstagramReply } from '@/lib/connectors/instagram-inbox';
import { validateInstagramReply } from '@/lib/connectors/instagram-inbox-core.mjs';
import { WorkflowError, taskFor, createTask, taskEvent, requireDepartment, requireQueueCapacity, type WorkflowSession } from './service';
import type { AutomationTask } from './types';

async function claimAction(s:WorkflowSession,task:AutomationTask,index:number,kind:string,payload:Record<string,unknown>) {
  const claim=await s.admin.rpc('claim_automation_action',{p_task_id:task.id,p_revision:task.revision,p_index:index,p_kind:kind,p_payload:payload,p_user_id:s.user.id});
  if(claim.error||!claim.data)throw new WorkflowError(['23505','40001'].includes(claim.error?.code||'')?'This task or action changed. Refresh and check the recorded result before continuing.':'Could not record this action.',409);
  return claim.data as string;
}
async function finishAction(s:WorkflowSession,task:AutomationTask,id:string,result:Record<string,unknown>,complete=false) {
  const action=await s.admin.from('automation_actions').update({status:'completed',result,finished_at:new Date().toISOString()}).eq('id',id).eq('status','executing').select('id').maybeSingle();
  if(action.error||!action.data)throw new Error('The action result could not be checkpointed.');
  const state={...task.state};delete state.executionPending;
  const saved=await s.admin.from('automation_tasks').update({status:complete?'completed':'review',state,finished_at:complete?new Date().toISOString():task.finished_at,error:null}).eq('id',task.id).eq('status','blocked').contains('state',{executionPending:id}).select('id').maybeSingle();
  if(saved.error||!saved.data)throw new Error('The action finished, but the task needs reconciliation.');
}
async function ambiguousAction(s:WorkflowSession,id:string) {
  await s.admin.from('automation_actions').update({status:'review',error:'The action could not be fully confirmed. Check the destination before any retry; automatic retry is disabled.',finished_at:new Date().toISOString()}).eq('id',id).eq('status','executing');
}

/** Only saved, application-built proposals can become actions. Browser payloads never choose tool arguments. */
export async function executeTaskAction(s:WorkflowSession,body:Record<string,any>) {
  const task=await taskFor(s,body.id);
  if(task.status!=='review'||task.revision!==body.revision||task.state.executionPending)throw new WorkflowError('Refresh this task before reviewing an action.',409);
  const index=body.actionIndex;
  if(!Number.isInteger(index)||index<0||index>7)throw new WorkflowError('Choose a saved proposal.');
  const proposed=task.result?.actions?.[index];if(!proposed)throw new WorkflowError('This proposal was not found.');
  const payload=proposed.payload as Record<string,any>;
  if(!['catalogue_copy','create_campaign','follow_up','inquiry_reply'].includes(proposed.kind))throw new WorkflowError('This action is not supported.');
  if(proposed.kind==='catalogue_copy'){
    requireDepartment(s,'catalog');
    try {await prepareCatalogueUpdate(payload);}catch(e){throw new WorkflowError(e instanceof Error?e.message:'Shopify copy could not be checked.');}
  }
  if(['create_campaign','follow_up'].includes(proposed.kind))await requireQueueCapacity(s);
  if(proposed.kind==='create_campaign')requireDepartment(s,'creative');
  if(proposed.kind==='follow_up') {
    const owner=await s.db.from('agents').select('id,department_id,enabled').eq('id',payload.ownerAgent||task.owner_agent).maybeSingle();
    if(owner.error||!owner.data?.enabled)throw new WorkflowError('This follow-up needs an enabled owner.');
    requireDepartment(s,owner.data.department_id);
    if(typeof payload.title!=='string'||!payload.title.trim()||typeof payload.brief!=='string'||!payload.brief.trim())throw new WorkflowError('The follow-up proposal needs a title and deliverable.');
  }
  if(proposed.kind==='inquiry_reply'){
    requireDepartment(s,'crm');
    if(typeof payload.reply!=='string'||!payload.reply.trim()||payload.reply.length>6000)throw new WorkflowError('The saved reply is invalid.');
    const inquiry=await s.db.from('automation_inquiries').select('id,task_id,provider_deleted_at,replied_at').eq('id',payload.inquiryId).maybeSingle();
    if(inquiry.error||!inquiry.data||inquiry.data.task_id!==task.id||inquiry.data.provider_deleted_at||inquiry.data.replied_at)throw new WorkflowError('This enquiry is no longer available for a reply.',409);
  }
  await checkPause();
  const id=await claimAction(s,task,index,proposed.kind,payload);
  try {
    let result:Record<string,unknown>;
    if(proposed.kind==='catalogue_copy') {
      const ready=await prepareCatalogueUpdate(payload);
      const before=await s.admin.from('automation_actions').update({result:{before:ready.before,proposed:ready.change}}).eq('id',id).eq('status','executing');
      if(before.error)throw new Error('Could not preserve the original product.');
      result=await applyCatalogueUpdate(payload);
    } else if(proposed.kind==='create_campaign') {
      const child=await createTask(s,{kind:'campaign',title:`Campaign: ${task.title}`.slice(0,180),brief:String(payload.brief||task.brief).slice(0,6000),parentId:task.id},`action:${task.id}:${index}`);
      result={taskId:child,summary:'Campaign production queued. No campaign was published.'};
    } else if(proposed.kind==='follow_up') {
      const hours=Math.max(1,Math.min(Number(payload.dueInHours)||24,720));
      const child=await createTask(s,{kind:'follow_up',title:String(payload.title||'Follow-up').slice(0,180),brief:String(payload.brief||task.brief).slice(0,6000),ownerAgent:payload.ownerAgent||task.owner_agent,parentId:task.id,dueAt:new Date(Date.now()+hours*3600000).toISOString()},`action:${task.id}:${index}`);
      result={taskId:child,summary:'Follow-up assigned.'};
    } else {
      const saved=await s.admin.from('automation_inquiries').update({reply_text:payload.reply,status:'review'}).eq('id',payload.inquiryId).eq('task_id',task.id).is('provider_deleted_at',null).is('replied_at',null).select('id').maybeSingle();
      if(saved.error||!saved.data)throw new Error('The enquiry changed before its reply was saved.');
      result={inquiryId:payload.inquiryId,summary:'Approved reply saved. It has not been sent.'};
    }
    await finishAction(s,task,id,result);
    await taskEvent(s,task.id,proposed.kind==='catalogue_copy'?'Approved catalogue copy was applied to Shopify.':String(result.summary),'action');
    return task.id;
  }catch{await ambiguousAction(s,id);throw new WorkflowError('This action needs review. Check the saved action record and destination before retrying.',409);}
}

/** Sends only a saved, explicitly approved reply to the saved inbound sender. */
export async function sendApprovedReply(s:WorkflowSession,inquiryId:unknown) {
  requireDepartment(s,'crm');
  const read=await s.db.from('automation_inquiries').select('*').eq('id',inquiryId).maybeSingle();
  const inquiry=read.data;
  if(read.error||!inquiry||inquiry.channel!=='instagram'||!inquiry.reply_text||inquiry.provider_deleted_at||inquiry.replied_at||!inquiry.task_id)throw new WorkflowError('Choose an unsent, approved Instagram reply.');
  const received=Date.parse(inquiry.provider_received_at||'');
  if(!Number.isFinite(received)||Date.now()-received>86400000||received>Date.now()+60000||!inquiry.provider_account_id)throw new WorkflowError('This message is outside the verified Instagram reply window. Handle it in Instagram.');
  try {validateInstagramReply({recipientId:inquiry.contact_ref,text:inquiry.reply_text,inquiryReceivedAt:inquiry.provider_received_at});}
  catch(e){throw new WorkflowError(e instanceof Error?e.message:'This reply is not ready to send.');}
  const task=await taskFor(s,inquiry.task_id);
  if(task.state.executionPending||!['review','completed'].includes(task.status))throw new WorkflowError('Finish reviewing this enquiry before sending.',409);
  await checkPause();
  const id=await claimAction(s,task,10000,'instagram_reply',{inquiryId:inquiry.id,recipientId:inquiry.contact_ref,text:inquiry.reply_text,accountId:inquiry.provider_account_id});
  try {
    const fresh=await s.db.from('automation_inquiries').select('reply_text,provider_deleted_at,replied_at').eq('id',inquiry.id).single();
    if(fresh.error||fresh.data.provider_deleted_at||fresh.data.replied_at||fresh.data.reply_text!==inquiry.reply_text)throw new Error('The enquiry changed.');
    const sent=await sendInstagramReply({recipientId:inquiry.contact_ref,text:inquiry.reply_text,inquiryReceivedAt:inquiry.provider_received_at,accountId:inquiry.provider_account_id,beforeSend:async()=>{
      await checkPause();
      const latest=await s.db.from('automation_inquiries').select('reply_text,provider_deleted_at,replied_at').eq('id',inquiry.id).single();
      if(latest.error||latest.data.provider_deleted_at||latest.data.replied_at||latest.data.reply_text!==inquiry.reply_text)throw new Error('The enquiry changed before sending.');
    }});
    const checkpoint=await s.admin.from('automation_actions').update({result:{messageId:sent.messageId,inquiryId:inquiry.id}}).eq('id',id).eq('status','executing');
    if(checkpoint.error)throw new Error('Could not save the provider receipt.');
    const saved=await s.admin.from('automation_inquiries').update({reply_message_id:sent.messageId,replied_at:new Date().toISOString(),status:'replied'}).eq('id',inquiry.id);
    if(saved.error)throw new Error('Could not save the reply status.');
    await finishAction(s,task,id,{messageId:sent.messageId,inquiryId:inquiry.id},true);
    await taskEvent(s,task.id,'The approved reply was sent through the connected Instagram account.','sent');
  }catch{await ambiguousAction(s,id);throw new WorkflowError('Instagram reply delivery could not be fully confirmed. Check the Instagram conversation before any retry.',409);}
}
