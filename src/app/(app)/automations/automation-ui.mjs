import { headQualityCurrent } from '../../../lib/automation/head-task-core.mjs';

/** Display rules shared by the task board and its forms. */
export function taskStatus(task) {
  if (task.status === 'queued' && task.state?.blockedReason === 'ai_budget') return 'Waiting for text budget';
  if(task.kind==='head_task'){
    const flow=task.state?.headWorkflow;
    if(task.status==='cancelled'&&flow?.humanDecision==='cancelled')return 'Cancelled';
    if(flow?.phase==='rejected')return 'Rejected by human';
    if(task.status==='review')return flow?.review?.decision==='approve'&&headReportHref(task)&&(!flow.quality||(flow.quality.decision==='pass'&&headQualityCurrent(flow)))?'Ready for human review':'AI review pending';
    if(['queued','running'].includes(task.status)&&flow?.phase){
      const label=({plan:'Head planning',work:flow.revisionRound?'Specialists revising':'Specialists working',review:'AI head reviewing',quality:'Independent QC reviewing',handoff:'Preparing human handoff'})[flow.phase];
      if(label)return task.status==='queued'?`${label} · queued`:label;
    }
  }
  return ({queued:'Queued',running:'Working',blocked:'Needs input',review:'Ready for review',completed:'Completed',cancelled:'Cancelled',failed:'Needs attention'})[task.status] || 'Unknown';
}

export function isOverdue(task, now = Date.now()) {
  const due = Date.parse(task.due_at || '');
  return Number.isFinite(due) && due < now && !['completed', 'cancelled'].includes(task.status);
}

/** datetime-local fields on this page explicitly use the business's IST timezone. */
export function dueInIST(value) {
  if (!value) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a valid due date and time.');
  const date = new Date(`${value}:00+05:30`);
  if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid due date and time.');
  const roundTrip = new Date(date.getTime() + 330 * 60_000).toISOString().slice(0,16);
  if (roundTrip !== value) throw new Error('Choose a valid due date and time.');
  return date.toISOString();
}

/** Retain the same id after an uncertain response, but make a new one for an edited request. */
export function submissionKey(previous, body, makeId) {
  const signature = JSON.stringify(body);
  return previous?.signature === signature ? previous : {signature, id:makeId()};
}

export function productIds(value) {
  if (!String(value || '').trim()) return [];
  const parts = String(value).split(/[\s,]+/).filter(Boolean);
  if (parts.length > 3 || parts.some(part => !/^\d+$/.test(part) || !Number.isSafeInteger(Number(part)) || Number(part) <= 0)) {
    throw new Error('Enter up to 3 numeric product IDs, separated by commas.');
  }
  return [...new Set(parts.map(Number))];
}

export function actionLabel(kind, fallback = '') {
  return ({catalogue_copy:'Apply copy to Shopify',shopify_copy:'Apply copy to Shopify',create_campaign:'Start campaign production',follow_up:'Assign follow-up',inquiry_reply:'Save approved reply'})[kind] || fallback || 'Review action';
}

export function safeHref(value) {
  if (typeof value !== 'string') return null;
  if (/^\/(?!\/)/.test(value)) return value;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export function instagramReplyAvailability(inquiry, now = Date.now()) {
  if (inquiry.channel !== 'instagram') return {allowed:false,reason:'This enquiry came through another channel.'};
  if (inquiry.provider_deleted_at) return {allowed:false,reason:'The customer removed this message.'};
  if (inquiry.replied_at || inquiry.status === 'closed') return {allowed:false,reason:'This enquiry has already been handled.'};
  if (!inquiry.reply_text) return {allowed:false,reason:'Review and save the reply draft first.'};
  const received=Date.parse(inquiry.provider_received_at || '');
  if (!inquiry.provider_account_id || !Number.isFinite(received)) return {allowed:false,reason:'This enquiry has no verified Instagram message receipt. Reply in Instagram and record completion here.'};
  if (received > now + 60_000 || now - received > 86_400_000) return {allowed:false,reason:'The verified reply window has closed. Handle the conversation in Instagram.'};
  return {allowed:true,reason:''};
}

export function suggestedWorkflow(agent,templates) {
  const available=templates.filter(template=>template.canRun&&template.kind!=='follow_up');
  const direct=available.find(template=>template.ownerAgent===agent?.id);
  if(direct)return direct.kind;
  const kind=({board:'briefing',insights:'briefing',datahub:'data_quality',creative:'campaign',strategy:'campaign',forecast:'inventory',crm:'customer',customer:'customer',social:'customer',catalog:'catalogue',seo:'catalogue',lang:'catalogue',perf:'advertising'})[agent?.department_id];
  return available.find(template=>template.kind===kind)?.kind||available[0]?.kind||null;
}

/** Select only an accessible enabled lead supplied by the API. */
export function headOwnerFor(agents,agentId) {
  const selected=agents.find(agent=>agent.id===agentId),heads=agents.filter(agent=>agent.is_lead===true&&agent.enabled!==false);
  return heads.find(agent=>agent.id===agentId)||heads.find(agent=>agent.department_id===selected?.department_id)||heads[0]||null;
}

/** A report link is always an internal route built from a stored UUID. */
export function headReportHref(task) {
  const id=task?.state?.headWorkflow?.reportId;
  return typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)?`/approvals?report=${encodeURIComponent(id)}#report-${encodeURIComponent(id)}`:null;
}
/** An older draft remains readable while the specialist prepares the requested correction. */
export function headAssignmentProgress(flow,agentId) {
  const output=flow?.outputs?.[agentId];
  const hasBody=typeof output?.body==='string'&&!!output.body.trim();
  const correction=flow?.review?.decision==='revise'&&Array.isArray(flow.review.revisionRequests)&&flow.review.revisionRequests.some(row=>row?.agentId===agentId);
  const revising=correction&&Number(output?.revision||0)<Number(flow?.revisionRound||1);
  return {label:output?.blocked?'Needs input':revising?'Correction requested':hasBody?'Returned to head':'Assigned',returned:hasBody&&!revising,blocked:!!output?.blocked,revising};
}
export function headReviewAttribution(flow) {
  return flow?.quality?.decision==='revise'&&flow?.review?.decision==='revise'?'Independent QC':'AI head';
}
/** Progress reflects persisted outputs and decisions, never elapsed time or a model promise. */
export function headTaskProgress(task) {
  const flow=task?.state?.headWorkflow||{},assignments=Array.isArray(flow.plan?.assignments)?flow.plan.assignments.filter(row=>typeof row?.agentId==='string'):[];
  const planDone=assignments.length>0,returned=assignments.filter(row=>headAssignmentProgress(flow,row.agentId).returned).length;
  const cancelled=task.status==='cancelled'&&flow.humanDecision==='cancelled';
  const approved=flow.review?.decision==='approve',qcPassed=flow.quality?.decision==='pass'&&headQualityCurrent(flow),delivered=!!headReportHref(task),decided=!cancelled&&['completed','rejected'].includes(flow.phase);
  const phase=flow.phase==='blocked'?flow.resumePhase:flow.phase;
  const position=cancelled?(!planDone?1:returned<assignments.length?2:!approved?3:!qcPassed?4:5):({plan:1,work:2,review:3,quality:4,handoff:5,human_review:5,completed:5,rejected:5})[phase]??1;
  const stopped=['blocked','failed','cancelled'].includes(task.status);
  return [
    {label:'Assigned to AI head',detail:'Your brief is saved.',done:true},
    {label:'Head understands and delegates',detail:planDone?`${assignments.length} specialist assignment${assignments.length===1?'':'s'} saved.`:cancelled?'Task cancelled before delegation.':'The head will prepare the plan.',done:planDone},
    {label:'Specialists return their work',detail:planDone?`${returned} of ${assignments.length} returned${flow.revisionRound?' · revision round':''}.`:cancelled?'Task cancelled before specialist work.':'Waiting for delegation.',done:planDone&&returned===assignments.length&&flow.phase!=='work'},
    {label:'AI head reviews',detail:approved?'Approved by the AI head.':flow.review?.decision==='revise'?`${headReviewAttribution(flow)} requested corrections.`:flow.review?.decision==='blocked'?'The head needs more input.':cancelled?'Task cancelled before AI review.':'Checks the deliverable against your brief.',done:approved},
    {label:'Independent QC',detail:qcPassed?'Current deliverable passed independent QC.':flow.quality?flow.quality.decision==='pass'?'Earlier QC pass is invalid for the current version.':flow.quality.decision==='revise'?'QC requested a correction; the revised version needs another check.':'QC needs more input.':cancelled?'Task cancelled before independent QC.':delivered?'No independent QC check recorded for this delivery.':'Checks the exact deliverable and source evidence.',done:qcPassed},
    {label:'Human review',detail:cancelled?(delivered?'Review closed when the task was cancelled.':'Task cancelled before human review.'):flow.phase==='completed'?'Accepted by the human reviewer.':flow.phase==='rejected'?'Rejected by the human reviewer.':delivered?'Delivered to Approvals.':'Sent after AI head approval and independent QC.',done:decided},
  ].map((step,index)=>({...step,state:step.done?'done':index===position?(stopped?'waiting':'current'):'pending'}));
}
