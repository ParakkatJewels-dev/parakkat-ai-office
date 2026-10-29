import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkPause, isPaused, Paused } from '@/lib/pause';
import { withAgentWork } from '@/lib/agents/agent-work';
import { withUsage } from '@/lib/usage';
import { emit } from '@/lib/agents/events';
import { templateFor, scheduleSlot, validOutcome } from './core.mjs';
import type { AutomationContext, AutomationTask, AutomationOutcome } from './types';
import { handleAutomation } from './handlers';
import { handleHeadTask } from './head-task';
import { headTaskDepartments } from './head-task-access.mjs';
import { getChatGPTStatus } from '@/lib/chatgpt/auth.mjs';
import { isAiBudgetError } from '@/lib/ai-budget';

const safeError = (error: unknown) => error instanceof Paused ? error.message : (error as {code?:string})?.code==='head_task_access' ? 'The task creator’s access or assigned AI head changed. Restore the required department access and enabled head before retrying.' :
  'The workflow could not finish. Its saved progress is preserved; check its inputs and connections, then retry.';

async function queueSchedules(db: SupabaseClient) {
  const read = await db.from('automation_schedules').select('*').eq('enabled', true);
  if (read.error) throw new Error('Could not read workflow schedules.');
  const now = new Date();
  for (const schedule of read.data || []) {
    const slot = scheduleSlot(schedule, now), template = templateFor(schedule.kind);
    if (!slot || !template) continue;
    const owner = await db.from('agents').select('enabled').eq('id', template.ownerAgent).maybeSingle();
    if (owner.error || !owner.data?.enabled) continue;
    // Keep one unfinished automatic copy/ad batch. New schedules do not regenerate
    // material that is already awaiting a head's decision or a missing input.
    if(['catalogue','advertising'].includes(template.kind)) {
      const pending=await db.from('automation_tasks').select('id').eq('kind',template.kind).in('status',['queued','running','review','blocked']).limit(1);
      if(pending.error)throw new Error('Could not check outstanding workflow work.');
      if(pending.data?.length)continue;
    }
    // The unique source key makes replaying a scheduler tick harmless after a crash.
    const saved = await db.from('automation_tasks').upsert({ kind: template.kind, title: template.label,
      brief: template.description, department_id: template.departmentId, owner_agent: template.ownerAgent,
      source_key: `scheduled:${template.kind}:${slot}`, input: { trigger: 'schedule' },
      due_at: new Date(now.getTime() + 4 * 3600000).toISOString(),
    }, { onConflict: 'source_key', ignoreDuplicates: true });
    if (saved.error) throw new Error('Could not queue a scheduled workflow.');
    const updated = await db.from('automation_schedules').update({last_queued_at: now.toISOString()}).eq('kind', schedule.kind).eq('enabled', true);
    if (updated.error) throw new Error('Could not save the workflow schedule checkpoint.');
  }
}

async function campaign(ctx: AutomationContext): Promise<AutomationOutcome> {
  await ctx.assertActive();
  let read = await ctx.db.from('agent_runs').select('id,status,stage,state,error').eq('automation_task_id', ctx.task.id).maybeSingle();
  if (read.error) throw new Error('Could not read campaign progress.');
  if (!read.data) {
    // This insert and the unique task index are the durable checkpoint. Never call an
    // uncheckpointed provider action here: the existing campaign worker owns its stages.
    const inserted = await ctx.db.from('agent_runs').insert({kind:'campaign',occasion:ctx.task.title,
      stage:'analyse',automation_task_id:ctx.task.id,state:{origin:{by:ctx.task.owner_agent,why:ctx.task.brief}}}).select('id,status,stage,state,error').single();
    if (inserted.error) {
      read = await ctx.db.from('agent_runs').select('id,status,stage,state,error').eq('automation_task_id',ctx.task.id).maybeSingle();
      if (read.error || !read.data) throw new Error('Could not start campaign production.');
    } else read = inserted;
    // Cancellation can win after the initial ownership check but before this insert.
    // Close that newly inserted run without treating a normal pause as cancellation.
    try {await ctx.assertActive();} catch(error) {
      const current=await ctx.db.from('automation_tasks').select('status').eq('id',ctx.task.id).maybeSingle();
      if(!current.error&&current.data?.status==='cancelled')await ctx.db.from('agent_runs').update({status:'cancelled',finished_at:new Date().toISOString()}).eq('automation_task_id',ctx.task.id).eq('status','running');
      throw error;
    }
    await ctx.event(ctx.task.owner_agent, 'Campaign production is queued. The existing team will prepare the plan, copy and artwork for review.');
  }
  const run = read.data!;
  const campaigns = await ctx.db.from('campaigns').select('id,name,status').eq('run_id',run.id).limit(1).maybeSingle();
  if (campaigns.error) throw new Error('Could not read the campaign approval state.');
  const c = campaigns.data;
  const evidence = [{source:'Campaign production',detail:`Run ${run.id}; stage ${run.stage}; status ${run.status}.`}];
  const link = c ? `/approvals?campaign=${c.id}` : '/office';
  if (run.status==='failed') return {status:'blocked',summary:'Campaign production needs attention.',markdown:`The campaign stopped at **${run.stage}**. Review its progress in [AI Office](${link}).`,warnings:['The campaign has not been published.'],evidence,state:{runId:run.id}};
  if (run.stage==='done' || c?.status==='in_approval' || ['approved','publishing','publish_review','live'].includes(c?.status||'')) {
    const images = c ? await ctx.db.from('creatives').select('id,language,art_status').eq('campaign_id',c.id) : {data:[],error:null};
    if(images.error)throw new Error('Could not check campaign deliverables.');
    const rows=images.data||[];
    const warnings=rows.some(row=>row.art_status!=='ready')?['Some artwork is not ready. Check each creative before approving publication.']:[];
    return {status:'review',summary:`${c?.name||ctx.task.title}: campaign package prepared.`,markdown:`[Open the campaign approval package](${link}).\n\nThe team completed its planning stages. Publication remains governed by the campaign’s department and final approvals.\n\nCurrent campaign status: **${c?.status||run.status}**.`,evidence,warnings,metrics:{creative_items:rows.length},state:{runId:run.id,campaignId:c?.id}};
  }
  return {status:'queued',summary:`Campaign production: ${run.stage}.`,markdown:`The team is working through the campaign stages. [View the office](/office).`,evidence,warnings:[],state:{runId:run.id,campaignId:c?.id},nextRunAt:new Date(Date.now()+90000).toISOString()};
}

/** One bounded, leased unit of work. Durable tasks survive app restarts. */
export async function runAutomationQueue(db = supabaseAdmin()) {
  if (await isPaused(true)) return {paused:true};
  const holder=randomUUID();
  const lock=await db.rpc('acquire_job_lock',{p_name:'business_automation',p_holder:holder,p_seconds:225});
  if(lock.error)throw new Error('Could not check workflow ownership.');
  if(!lock.data)return {busy:true};
  let task:AutomationTask|undefined;
  try {
    const chatgpt=process.env.LLM_PROVIDER==='chatgpt'?await getChatGPTStatus():null;
    if(chatgpt?.connected&&!chatgpt.usageBlocked){
      const resumed=await db.from('automation_tasks').update({status:'queued',error:null,next_run_at:new Date().toISOString()}).eq('status','blocked').contains('state',{blockedReason:'chatgpt_usage'});
      if(resumed.error)throw new Error('Could not resume usage-waiting workflows.');
    }
    await queueSchedules(db);
    const claim=await db.rpc('claim_automation_task',{p_holder:holder,p_seconds:210});
    if(claim.error)throw new Error('Could not claim a workflow.');
    task=(Array.isArray(claim.data)?claim.data[0]:claim.data)||undefined;
    if(!task)return {idle:true};
    const current=task;
    const originalHeadScope=current.input.allowedDepartments;
    const signal=AbortSignal.timeout(180000);
    const assertActive=async()=>{
      signal.throwIfAborted();await checkPause();
      const result=await db.from('automation_tasks').select('id').eq('id',current.id).eq('status','running').eq('claimed_by',holder).gt('lease_until',new Date().toISOString()).maybeSingle();
      if(result.error||!result.data)throw new Error('Workflow ownership changed.');
      const owner=await db.from('agents').select('id,enabled,is_lead,department_id').eq('id',current.owner_agent).maybeSingle();
      if(owner.error||!owner.data?.enabled)throw new Error('The assigned agent is unavailable.');
      if(current.kind==='head_task') {
        const [creator,departments]=await Promise.all([
          db.from('profiles').select('role').eq('id',current.created_by||'00000000-0000-0000-0000-000000000000').abortSignal(signal).maybeSingle(),
          db.from('departments').select('id,human_head_role,ai_lead_agent').abortSignal(signal),
        ]);
        const allowed=!creator.error&&creator.data&&!departments.error?headTaskDepartments(creator.data.role,owner.data,{...current,input:{...current.input,allowedDepartments:originalHeadScope}},departments.data||[]):[];
        if(!allowed.length)throw Object.assign(new Error('Head task access changed.'),{code:'head_task_access'});
        current.input={...current.input,allowedDepartments:allowed};
      }
    };
    const save=async(patch:Record<string,unknown>)=>{
      signal.throwIfAborted();
      const result=await db.from('automation_tasks').update(patch).eq('id',current.id).eq('status','running').eq('claimed_by',holder).gt('lease_until',new Date().toISOString()).select('id').maybeSingle();
      if(result.error||!result.data)throw new Error('Workflow ownership changed.');
    };
    const context:AutomationContext={db,task:current,signal,assertActive,
      checkpoint:async state=>{await assertActive();await save({state:{...current.state,...state}});current.state={...current.state,...state};},
      event:async(agentId,text,kind='progress')=>{
        await assertActive();
        const result=await db.from('automation_events').insert({task_id:current.id,agent_id:agentId,kind,text:text.slice(0,6000)});
        if(result.error)throw new Error('Could not save workflow progress.');
      },
    };
    await assertActive();
    if(chatgpt?.usageBlocked&&!['briefing','data_quality','inventory'].includes(current.kind)&&!(current.kind==='head_task'&&current.state.headWorkflow?.phase==='handoff')) {
      const result:AutomationOutcome={status:'blocked',summary:'Waiting for ChatGPT usage to become available.',markdown:'The connected ChatGPT account reached its app allowance. Review ChatGPT usage, then resume requests in [Settings → AI providers](/admin?tab=ai#chatgpt). This task stays saved and will resume after access is restored.',evidence:[],warnings:['The required ChatGPT review is waiting for plan usage.']};
      await save({status:'blocked',result,state:{...current.state,blockedReason:'chatgpt_usage'},claimed_by:null,lease_until:null,error:result.summary});
      return {id:current.id,status:'blocked'};
    }
    await context.event(current.owner_agent,'Started the assigned workflow.');
    const execute=()=>withUsage({feature:`automation:${current.kind}`,agent:current.owner_agent,scheduled:!current.created_by},async()=>{
      if(current.kind==='head_task')return handleHeadTask(context);
      if(current.kind==='campaign')return campaign(context);
      return handleAutomation(context);
    });
    const outcome=await (current.kind==='head_task'?execute():withAgentWork({agentId:current.owner_agent,kind:'text',timeoutMs:185000,signal},execute));
    await assertActive();
    const result=validOutcome(outcome);
    if(current.kind==='head_task'&&result.status==='review') {
      const forwarded=await db.rpc('handoff_head_task',{p_task_id:current.id,p_holder:holder,p_result:result});
      if(forwarded.error||!forwarded.data)throw new Error('The approved output could not be handed to the human head. Saved review progress is preserved.');
      return {id:current.id,status:'review',reportId:forwarded.data};
    }
    await context.event(current.owner_agent,result.summary,'result');
    const nextState={...current.state,...result.state};
    if(['ai_budget','chatgpt_usage'].includes(nextState.blockedReason)){delete nextState.blockedReason;delete nextState.retryAt;}
    await save({status:result.status,result,state:nextState,claimed_by:null,lease_until:null,
      next_run_at:result.nextRunAt||new Date().toISOString(),finished_at:['completed','review'].includes(result.status)?new Date().toISOString():null,error:null});
    // Public map events contain only generic status; enquiry details and drafts stay scoped to the task.
    await emit(db,null,'say',current.owner_agent,`${templateFor(current.kind)?.label||'Assigned task'}: ${result.status==='queued'?'work continues':result.status==='blocked'?'needs attention':'result saved'}.`).catch(()=>null);
    if(current.kind==='customer'&&typeof current.input.inquiryId==='string')await db.from('automation_inquiries').update({status:result.status==='review'?'review':'drafting'}).eq('id',current.input.inquiryId).eq('task_id',current.id);
    return {id:current.id,status:result.status};
  } catch(error) {
    if(task) {
      if(isAiBudgetError(error)) {
        const retryAt=error.retryAt;
        const unavailable=error.reason==='budget_unavailable';
        const result:AutomationOutcome={status:retryAt?'queued':'blocked',summary:retryAt?'Waiting for the app’s text usage budget.':unavailable?'The text budget could not be checked.':'This request exceeds the app’s prompt or token limit.',markdown:retryAt?`This work is saved and will become eligible again after ${retryAt}. No extra model call was made.`:unavailable?'Ask an administrator to check the text budget service before retrying. No model call was made.':'Shorten this task or reduce the supplied evidence before retrying. No model call was made.',warnings:['These are AI Office limits; ChatGPT has a separate shared allowance.'],evidence:[]};
        await db.from('automation_tasks').update({status:result.status,result,state:{...task.state,blockedReason:'ai_budget',retryAt},error:result.summary,claimed_by:null,lease_until:null,...(retryAt?{next_run_at:retryAt}:{})}).eq('id',task.id).eq('status','running').eq('claimed_by',holder).gt('lease_until',new Date().toISOString());
        return {id:task.id,status:result.status};
      }
      const paused=error instanceof Paused;
      await db.from('automation_tasks').update({status:paused?'queued':'failed',claimed_by:null,lease_until:null,error:safeError(error),next_run_at:new Date(Date.now()+60000).toISOString()})
        .eq('id',task.id).eq('status','running').eq('claimed_by',holder).gt('lease_until',new Date().toISOString());
      return {id:task.id,status:paused?'queued':'failed'};
    }
    throw error;
  } finally {await db.rpc('release_job_lock',{p_name:'business_automation',p_holder:holder});}
}
