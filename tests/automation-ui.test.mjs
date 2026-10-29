import test from 'node:test';
import assert from 'node:assert/strict';
import {taskStatus,isOverdue,dueInIST,submissionKey,productIds,safeHref,actionLabel,instagramReplyAvailability,suggestedWorkflow,headOwnerFor,headReportHref,headTaskProgress,headAssignmentProgress,headReviewAttribution} from '../src/app/(app)/automations/automation-ui.mjs';
import {headQualityArtifact} from '../src/lib/automation/head-task-core.mjs';
import {mergeTextUsageDraft,sameTextUsageSettings} from '../src/components/text-usage-form.mjs';

test('follow-ups distinguish queued, active, blocked and reviewed agent work',()=>{
  assert.equal(taskStatus({kind:'follow_up',status:'queued'}),'Queued');
  assert.equal(taskStatus({kind:'follow_up',status:'blocked'}),'Needs input');
  assert.equal(taskStatus({kind:'follow_up',status:'review'}),'Ready for review');
  assert.equal(taskStatus({kind:'briefing',status:'running'}),'Working');
  assert.equal(taskStatus({kind:'follow_up',status:'completed'}),'Completed');
});

test('IST due dates are independent of the viewing browser timezone and reject invalid dates',()=>{
  assert.equal(dueInIST('2026-10-27T09:00'),'2026-10-27T03:30:00.000Z');
  assert.equal(dueInIST(''),undefined);
  assert.throws(()=>dueInIST('2026-02-30T09:00'));
  assert.throws(()=>dueInIST('2026-10-27T24:10'));
  assert.throws(()=>dueInIST('tomorrow'));
});

test('completed and cancelled tasks do not show as overdue',()=>{
  const task={due_at:'2026-10-26T10:00:00Z',status:'review'},now=Date.parse('2026-10-26T11:00:00Z');
  assert.equal(isOverdue(task,now),true);
  for(const status of ['completed','cancelled'])assert.equal(isOverdue({...task,status},now),false);
  assert.equal(isOverdue({...task,due_at:null},now),false);
});

test('uncertain submissions reuse an id but edited requests receive a fresh one',()=>{
  let ids=0;const makeId=()=>String(++ids),body={kind:'campaign',brief:'Wedding campaign'};
  const first=submissionKey(null,body,makeId),retry=submissionKey(first,body,makeId);
  assert.equal(first,retry);assert.equal(ids,1);
  assert.equal(submissionKey(first,{...body,brief:'Onam campaign'},makeId).id,'2');
});

test('product selection uses real bounded numeric ids and rejects expressions or unsafe numbers',()=>{
  assert.deepEqual(productIds('123,456 123'),[123,456]);
  assert.deepEqual(productIds(''),[]);
  for(const value of ['1;delete','1.5','0','-1','9007199254740993'])assert.throws(()=>productIds(value));
});

test('saved deliverables cannot produce executable or protocol-relative links',()=>{
  for(const value of ['javascript:alert(1)','data:text/html,test','//evil.example',null])assert.equal(safeHref(value),null);
  assert.equal(safeHref('/approvals#reports'),'/approvals#reports');
  assert.equal(safeHref('https://example.com/evidence'),'https://example.com/evidence');
  assert.equal(actionLabel('inquiry_reply'),'Save approved reply');
});

test('Instagram send is offered only for an unsent approved reply with a verified open receipt',()=>{
  const now=Date.parse('2026-10-26T10:00:00Z'),inquiry={channel:'instagram',status:'review',reply_text:'Thank you for your enquiry.',provider_account_id:'verified-account',provider_received_at:'2026-10-26T09:00:00Z'};
  assert.equal(instagramReplyAvailability(inquiry,now).allowed,true);
  for(const patch of [{provider_account_id:null},{provider_received_at:null},{provider_deleted_at:'2026-10-26T09:30:00Z'},{replied_at:'2026-10-26T09:30:00Z'},{reply_text:null},{provider_received_at:'2026-10-25T09:59:59Z'},{provider_received_at:'2026-10-27T10:00:00Z'}])assert.equal(instagramReplyAvailability({...inquiry,...patch},now).allowed,false);
  assert.match(instagramReplyAvailability({...inquiry,provider_received_at:null},now).reason,/no verified Instagram/);
});

test('conversation workflow suggestions respect available department permissions',()=>{
  const templates=[{kind:'briefing',ownerAgent:'cmo',canRun:false},{kind:'campaign',ownerAgent:'creativeDirector',canRun:true},{kind:'catalogue',ownerAgent:'catalogLead',canRun:true}];
  assert.equal(suggestedWorkflow({id:'creativeDirector',department_id:'creative'},templates),'campaign');
  assert.equal(suggestedWorkflow({id:'seoWriter',department_id:'catalog'},templates),'catalogue');
  assert.equal(suggestedWorkflow({id:'cmo',department_id:'board'},templates),'campaign');
  assert.equal(suggestedWorkflow({id:'cmo',department_id:'board'},templates.map(row=>({...row,canRun:false}))),null);
});

test('text limit polling updates clean forms but preserves unsaved manager edits',()=>{
  const saved={enabled:true,daily_call_limit:40,weekly_call_limit:200,daily_token_limit:200000,weekly_token_limit:1000000,max_input_chars:30000,max_output_tokens:2400};
  const incoming={...saved,daily_call_limit:30},edited={...saved,max_output_tokens:1600};
  assert.deepEqual(mergeTextUsageDraft(null,null,saved),saved);
  assert.deepEqual(mergeTextUsageDraft({...saved},saved,incoming),incoming);
  assert.equal(mergeTextUsageDraft(edited,saved,incoming),edited);
  assert.equal(sameTextUsageSettings(edited,incoming),false);
  assert.equal(sameTextUsageSettings({...saved,updated_at:'changed metadata'},saved),true);
});

test('budget-deferred work is clearly waiting and is not shown as active work',()=>{
  assert.equal(taskStatus({kind:'catalogue',status:'queued',state:{blockedReason:'ai_budget'}}),'Waiting for text budget');
  assert.equal(taskStatus({kind:'catalogue',status:'running',state:{blockedReason:'ai_budget'}}),'Working');
});

const reportId='8d43b148-e8f3-4c05-861e-952c53095ab8';
const headTask=(headWorkflow,status='queued')=>({kind:'head_task',status,state:{headWorkflow}});

test('head assignment starts with the conversation lead or its department and never a disabled worker',()=>{
  const agents=[
    {id:'disabled',department_id:'creative',is_lead:true,enabled:false},
    {id:'strategyHead',department_id:'strategy',is_lead:true},
    {id:'designer',department_id:'creative',is_lead:false},
    {id:'creativeHead',department_id:'creative',is_lead:true},
  ];
  assert.equal(headOwnerFor(agents,'designer')?.id,'creativeHead');
  assert.equal(headOwnerFor(agents,'creativeHead')?.id,'creativeHead');
  assert.equal(headOwnerFor(agents,'disabled')?.id,'creativeHead');
  assert.equal(headOwnerFor(agents,'unknown')?.id,'strategyHead');
  assert.equal(headOwnerFor(agents.filter(agent=>!agent.is_lead||agent.enabled===false),'designer'),null);
});

test('human review links use the saved report UUID and cannot be replaced by model links',()=>{
  assert.equal(headReportHref(headTask({reportId})),`/approvals?report=${reportId}#report-${reportId}`);
  for(const value of ['',undefined,'/approvals','https://evil.example','javascript:alert(1)',`${reportId}?evil=1`])assert.equal(headReportHref(headTask({reportId:value})),null);
});

test('head task status requires saved AI approval and handoff before claiming readiness for a human',()=>{
  assert.equal(taskStatus(headTask({phase:'review'},'review')),'AI review pending');
  assert.equal(taskStatus(headTask({phase:'handoff',review:{decision:'approve'}},'review')),'AI review pending');
  assert.equal(taskStatus(headTask({phase:'human_review',review:{decision:'approve'},reportId},'review')),'Ready for human review');
  assert.equal(taskStatus(headTask({phase:'work',revisionRound:1},'running')),'Specialists revising');
  assert.equal(taskStatus(headTask({phase:'review'},'queued')),'AI head reviewing · queued');
  assert.equal(taskStatus({...headTask({phase:'work'}),state:{headWorkflow:{phase:'work'},blockedReason:'ai_budget'}}),'Waiting for text budget');
  assert.equal(taskStatus(headTask({phase:'rejected'},'cancelled')),'Rejected by human');
});

test('head workflow progress follows saved assignments and outputs without inventing an early handoff',()=>{
  const plan={understanding:'Prepare a launch plan',assignments:[{agentId:'designer'},{agentId:'writer'}]};
  const queued=headTaskProgress(headTask({phase:'plan'}));
  assert.deepEqual(queued.map(step=>step.done),[true,false,false,false,false,false]);
  assert.equal(queued[1].state,'current');
  const partial=headTaskProgress(headTask({phase:'work',plan,outputs:{designer:{body:'Draft',revision:0}}},'running'));
  assert.equal(partial[2].detail,'1 of 2 returned.');
  assert.equal(partial[2].state,'current');
  assert.equal(partial[4].done,false);
  const approved=headTaskProgress(headTask({phase:'handoff',plan,outputs:{designer:{body:'Draft'},writer:{body:'Copy'}},review:{decision:'approve'}},'queued'));
  assert.deepEqual(approved.map(step=>step.done),[true,true,true,true,false,false]);
  assert.equal(approved[5].detail,'Sent after AI head approval and independent QC.');
  const delivered=headTaskProgress(headTask({phase:'human_review',plan,review:{decision:'approve'},reportId},'review'));
  assert.equal(delivered[5].detail,'Delivered to Approvals.');
  assert.equal(delivered[5].state,'current');
});

test('a correction does not count the earlier draft as the revised deliverable',()=>{
  const flow={phase:'work',revisionRound:1,plan:{assignments:[{agentId:'designer'},{agentId:'writer'}]},outputs:{designer:{body:'Original draft',revision:0},writer:{body:'Approved copy',revision:0}},review:{decision:'revise',revisionRequests:[{agentId:'designer',instruction:'Use verified dimensions'}]}};
  assert.equal(headAssignmentProgress(flow,'designer').label,'Correction requested');
  assert.equal(headAssignmentProgress(flow,'writer').label,'Returned to head');
  assert.equal(headTaskProgress(headTask(flow,'running'))[2].detail,'1 of 2 returned · revision round.');
  flow.outputs.designer={body:'Corrected draft',revision:1};
  assert.equal(headAssignmentProgress(flow,'designer').returned,true);
  assert.equal(headTaskProgress(headTask({...flow,phase:'review'}))[2].done,true);
});

test('blocked work remains waiting at its saved stage and human decisions stay distinct',()=>{
  const blocked=headTaskProgress(headTask({phase:'blocked',resumePhase:'work',plan:{assignments:[{agentId:'analyst'}]},outputs:{analyst:{blocked:true,missing:['Product quantities']}}},'blocked'));
  assert.equal(blocked[2].state,'waiting');
  assert.equal(blocked[4].done,false);
  assert.equal(headAssignmentProgress({outputs:{analyst:{blocked:true}}},'analyst').label,'Needs input');
  assert.equal(headTaskProgress(headTask({phase:'completed',reportId},'completed'))[5].detail,'Accepted by the human reviewer.');
  assert.equal(headTaskProgress(headTask({phase:'rejected',reportId},'cancelled'))[5].detail,'Rejected by the human reviewer.');
});

test('cancelling a head task does not invent a human rejection or completed review',()=>{
  const task=headTask({phase:'rejected',humanDecision:'cancelled'},'cancelled');
  assert.equal(taskStatus(task),'Cancelled');
  const stages=headTaskProgress(task);
  assert.deepEqual(stages.map(stage=>stage.done),[true,false,false,false,false,false]);
  assert.equal(stages[1].state,'waiting');
  assert.equal(stages[5].detail,'Task cancelled before human review.');
  assert.equal(stages[5].state,'pending');
  const delivered=headTaskProgress(headTask({phase:'rejected',humanDecision:'cancelled',reportId,review:{decision:'approve'}},'cancelled'));
  assert.equal(delivered[5].detail,'Review closed when the task was cancelled.');
  assert.equal(delivered[5].done,false);
  assert.equal(taskStatus(headTask({phase:'rejected',humanDecision:'rejected',reportId},'cancelled')),'Rejected by human');
});


test('independent QC is a separate stage and only a current passing verdict completes it',()=>{
  const flow={phase:'quality',headAgentId:'creativeDirector',plan:{successCriteria:['Verified claims'],assignments:[{agentId:'writer'}]},outputs:{writer:{body:'Supported copy'}},review:{decision:'approve',finalMarkdown:'Supported final'},humanRevision:0,revisionRound:0};
  assert.equal(taskStatus(headTask(flow,'running')),'Independent QC reviewing');
  assert.equal(headTaskProgress(headTask(flow,'running'))[4].state,'current');
  const checked={...flow,quality:{reviewerId:'outputQc',decision:'pass',artifact:headQualityArtifact(flow)}};
  assert.equal(headTaskProgress(headTask(checked))[4].done,true);
  assert.equal(headTaskProgress(headTask({...checked,quality:{...checked.quality,decision:'blocked'}}))[4].done,false);
  const changed={...checked,review:{...checked.review,finalMarkdown:'Changed final'},reportId};
  assert.equal(headTaskProgress(headTask(changed))[4].done,false);
  assert.match(headTaskProgress(headTask(changed))[4].detail,/invalid/);
  assert.equal(taskStatus(headTask(changed,'review')),'AI review pending');
  const changedEvidence={...checked,evidence:[{source:'sales',detail:'New figures'}]};
  assert.equal(headTaskProgress(headTask(changedEvidence))[4].done,false);
  assert.equal(headTaskProgress(headTask({phase:'blocked',resumePhase:'quality'},'blocked'))[4].state,'waiting');
});


test('QC-originated correction instructions are attributed to QC until the next head verdict',()=>{
  const flow={phase:'work',review:{decision:'revise',note:'Missing source'},quality:{decision:'revise',note:'Missing source'}};
  assert.equal(headReviewAttribution(flow),'Independent QC');
  assert.equal(headTaskProgress(headTask(flow))[3].detail,'Independent QC requested corrections.');
  assert.equal(headReviewAttribution({...flow,review:{decision:'approve'}}),'AI head');
  assert.equal(headReviewAttribution({...flow,quality:{decision:'pass'}}),'AI head');
});
