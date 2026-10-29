import { after } from 'next/server';
import { randomUUID } from 'node:crypto';
import { isPaused } from '@/lib/pause';
import { byId } from '@/lib/agents/people';
import { TEMPLATES, canManageDepartment, textInput, UUID, workflowOriginAllowed } from '@/lib/automation/core.mjs';
import { workflowSession, WorkflowError, createTask, transitionTask, createFollowUp, requireAdmin, requireDepartment } from '@/lib/automation/service';
import { runAutomationQueue } from '@/lib/automation/runner';
import { executeTaskAction, sendApprovedReply } from '@/lib/automation/actions';
import { instagramInboxStatus, syncInstagramInbox } from '@/lib/connectors/instagram-inbox';
import { getAiBudgetStatus, saveAiBudgetSettings } from '@/lib/ai-budget';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const failure=(e:unknown)=>e instanceof WorkflowError?json({error:e.message},e.status):json({error:'The request could not be completed. Check your entries and connections, then refresh before retrying.'},400);

export async function GET() {
  try {
    const s=await workflowSession();
    const [active,recent,events,schedules,settings,inquiries,agents,actions]=await Promise.all([
      s.db.from('automation_tasks').select('*').in('status',['queued','running','blocked','review','failed']).order('created_at',{ascending:false}).limit(150),
      s.db.from('automation_tasks').select('*').in('status',['completed','cancelled']).order('updated_at',{ascending:false}).limit(50),
      s.db.from('automation_events').select('*').order('id',{ascending:false}).limit(400),
      s.db.from('automation_schedules').select('*').order('kind'),
      s.db.from('automation_settings').select('*').eq('id',1).maybeSingle(),
      s.db.from('automation_inquiries').select('*').order('created_at',{ascending:false}).limit(100),
      s.db.from('agents').select('id,name,department_id,enabled,is_lead').eq('enabled',true),
      s.db.from('automation_actions').select('id,task_id,action_index,kind,status,result,error,created_at,finished_at').order('created_at',{ascending:false}).limit(150),
    ]);
    if([active,recent,events,schedules,settings,inquiries,agents,actions].some(r=>r.error))throw new WorkflowError('Automation data is unavailable. Please refresh in a moment.',503);
    const canCrm=canManageDepartment(s.role,'crm',s.departments);
    const instagram=canCrm?await instagramInboxStatus().catch(()=>({connected:false,canRead:false,canSend:false,reason:'Instagram inbox access could not be checked.'})):null;
    return json({tasks:[...(active.data||[]),...(recent.data||[])],events:events.data||[],schedules:schedules.data||[],settings:settings.data,inquiries:inquiries.data||[],
      templates:TEMPLATES.map(t=>({...t,ownerName:byId[t.ownerAgent]?.name||t.ownerAgent,canRun:t.kind==='head_task'?(agents.data||[]).some(a=>a.is_lead&&byId[a.id]&&!byId[a.id].human&&s.departments.some(d=>d.id===a.department_id&&d.ai_lead_agent===a.id&&d.human_head_role!=='viewer')&&canManageDepartment(s.role,a.department_id,s.departments)):canManageDepartment(s.role,t.departmentId,s.departments)})),
      agents:(agents.data||[]).filter(a=>byId[a.id]&&!byId[a.id].human&&canManageDepartment(s.role,a.department_id,s.departments)).map(a=>({...a,is_lead:a.is_lead&&s.departments.some(d=>d.id===a.department_id&&d.ai_lead_agent===a.id&&d.human_head_role!=='viewer'),human_head_role:s.departments.find(d=>d.id===a.department_id)?.human_head_role})),
      departments:s.departments.filter(d=>canManageDepartment(s.role,d.id,s.departments)),actionAttempts:actions.data||[],
      paused:await isPaused(),isAdmin:s.role==='super_admin',role:s.role,instagram,
      aiBudget:s.role==='super_admin'?await getAiBudgetStatus(s.admin):null,
      coverage:{activeLimit:150,completedLimit:50,inquiryLimit:100}});
  }catch(e){return failure(e);}
}

export async function POST(req:Request) {
  try {
    const origin=req.headers.get('origin');
    if(!workflowOriginAllowed(origin,req.url,process.env.APP_URL))throw new WorkflowError('The request must come from AI Office.',403);
    if(!req.headers.get('content-type')?.includes('application/json'))throw new WorkflowError('Send a JSON request.');
    const raw=await req.text();if(raw.length>64000)throw new WorkflowError('This request is too large.',413);
    const body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw new WorkflowError('Invalid request.');
    const s=await workflowSession();let id:string|undefined;
    if(body.action==='create')id=await createTask(s,body);
    else if(['retry','cancel','accept','complete'].includes(body.action))id=await transitionTask(s,body);
    else if(body.action==='follow_up')id=await createFollowUp(s,body);
    else if(body.action==='execute')id=await executeTaskAction(s,body);
    else if(body.action==='send_reply'){await sendApprovedReply(s,body.inquiryId);}
    else if(body.action==='ai_budget'){requireAdmin(s);await saveAiBudgetSettings(s.admin,body.settings);}
    else if(body.action==='schedule') {
      requireAdmin(s);
      if(!TEMPLATES.some(t=>t.kind===body.kind&&t.scheduled))throw new WorkflowError('Choose a recurring workflow.');
      const cadence=Number(body.cadenceHours),hour=Number(body.localHour);
      if(typeof body.enabled!=='boolean'||!Number.isInteger(cadence)||cadence<6||cadence>168||!Number.isInteger(hour)||hour<0||hour>23)throw new WorkflowError('Choose a schedule from 6 to 168 hours and a valid IST start hour.');
      const saved=await s.admin.from('automation_schedules').update({enabled:body.enabled,cadence_hours:cadence,local_hour:hour}).eq('kind',body.kind);
      if(saved.error)throw new WorkflowError('Could not save this schedule.',503);
    } else if(body.action==='settings') {
      requireAdmin(s);const patch:Record<string,unknown>={};
      if(body.inventoryRules!==undefined){
        const rules=body.inventoryRules;
        if(!rules||!Array.isArray(rules.locations)||rules.locations.length>100)throw new WorkflowError('Add up to 100 branch-to-warehouse mappings.');
        const reviewDays=Number(rules.reviewDays??7);if(!Number.isFinite(reviewDays)||reviewDays<1||reviewDays>90)throw new WorkflowError('Review coverage must be 1 to 90 days.');
        const locations=rules.locations.map((row:Record<string,any>)=>{
          const branch=textInput(row.branch,200,true),warehouse=textInput(row.warehouse,200,true),leadDays=Number(row.leadDays),minStock=Number(row.minStock);
          if(!Number.isFinite(leadDays)||leadDays<0||leadDays>180||!Number.isFinite(minStock)||minStock<0||minStock>100000)throw new WorkflowError('Check lead days (0–180) and minimum stock for each branch.');
          return {branch,warehouse,leadDays,minStock};
        });
        if(new Set(locations.map((l:{branch:string})=>l.branch)).size!==locations.length)throw new WorkflowError('Use each branch only once.');
        if(new Set(locations.map((l:{warehouse:string})=>l.warehouse)).size!==locations.length)throw new WorkflowError('Use each warehouse only once so stock is not counted twice.');
        patch.inventory_rules={locations,reviewDays};
      }
      if(body.customerChannel!==undefined){if(!['unconfigured','manual','instagram','whatsapp','email'].includes(body.customerChannel))throw new WorkflowError('Choose a valid customer channel.');patch.customer_channel=body.customerChannel;}
      const saved=await s.admin.from('automation_settings').update(patch).eq('id',1);if(saved.error)throw new WorkflowError('Could not save settings.',503);
    } else if(body.action==='inquiry') {
      requireDepartment(s,'crm');
      const channel=['manual','whatsapp','instagram','email'].includes(body.channel)?body.channel:'manual';
      const requestId=typeof body.requestId==='string'&&UUID.test(body.requestId)?body.requestId:randomUUID();
      // Manually captured social messages do not establish an API recipient or a service window.
      const fields={channel,external_id:`manual:${s.user.id}:${requestId}`,contact_name:textInput(body.contactName,200),contact_ref:textInput(body.contactRef,300),body:textInput(body.body,6000,true),consent:body.consent===true,created_by:s.user.id};
      const added=await s.admin.from('automation_inquiries').upsert(fields,{onConflict:'channel,external_id',ignoreDuplicates:true});
      if(added.error)throw new WorkflowError('Could not save the enquiry.',503);
      const inquiry=await s.admin.from('automation_inquiries').select('id,body').eq('channel',channel).eq('external_id',fields.external_id).single();
      if(inquiry.error)throw new WorkflowError('Could not read the saved enquiry.',503);
      id=await createTask(s,{kind:'customer',title:'Customer enquiry',brief:'Prepare a helpful reply to the saved customer enquiry using verified business information.',input:{inquiryId:inquiry.data.id}},`inquiry:${inquiry.data.id}`);
      const link=await s.admin.from('automation_inquiries').update({task_id:id,status:'drafting'}).eq('id',inquiry.data.id);if(link.error)throw new WorkflowError('The enquiry and task are saved. Refresh to check their status.',503);
    } else if(body.action==='instagram_sync') {
      requireDepartment(s,'crm');const result=await syncInstagramInbox(s.admin);
      after(()=>runAutomationQueue().catch(()=>null));return json({ok:true,result});
    } else if(body.action==='inquiry_done') {
      requireDepartment(s,'crm');const note=textInput(body.note,2000,true);
      const inquiry=await s.db.from('automation_inquiries').select('id,task_id').eq('id',body.inquiryId).maybeSingle();
      if(inquiry.error||!inquiry.data)throw new WorkflowError('Enquiry not found.',404);
      const saved=await s.admin.from('automation_inquiries').update({status:'replied',replied_at:new Date().toISOString()}).eq('id',inquiry.data.id);
      if(saved.error)throw new WorkflowError('Could not save the reply status.',503);
      if(inquiry.data.task_id){const event=await s.admin.from('automation_events').insert({task_id:inquiry.data.task_id,kind:'manual_reply',text:`Human reply recorded: ${note}`});if(event.error)throw new WorkflowError('Reply status saved; the completion note could not be saved.',503);}
    } else throw new WorkflowError('Unknown automation action.');
    if(['create','retry','schedule','inquiry','execute'].includes(body.action))after(()=>runAutomationQueue().catch(()=>null));
    return json({ok:true,id});
  }catch(e){return failure(e);}
}
