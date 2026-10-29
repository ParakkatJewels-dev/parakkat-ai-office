'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';
import { Avatar, PageHead, when } from '@/components/ui';
import { Pagination } from '@/components/Pagination';
import { Icon, type IconName } from '@/components/Icon';
import TextUsageLimits, { type AiBudgetSnapshot } from '@/components/TextUsageLimits';
import type { AutomationAction, AutomationKind, AutomationTask } from '@/lib/automation/types';
import { headQualityCurrent } from '@/lib/automation/head-task-core.mjs';
import { actionLabel, dueInIST, instagramReplyAvailability, isOverdue, productIds, safeHref, submissionKey, suggestedWorkflow, taskStatus, headOwnerFor, headReportHref, headTaskProgress, headAssignmentProgress, headReviewAttribution } from './automation-ui.mjs';
import styles from './Automations.module.css';

type Template = {kind:AutomationKind;label:string;description:string;departmentId:string;ownerAgent:string;ownerName?:string;canRun:boolean;scheduled:boolean};
type Agent = {id:string;name:string;department_id:string;is_lead?:boolean;enabled?:boolean;human_head_role?:string};
type TaskEvent = {id:number|string;task_id:string;kind:string;agent_id:string|null;text:string;created_at:string};
type Schedule = {kind:string;enabled:boolean;cadence_hours:number;local_hour:number;last_queued_at:string|null};
type LocationRule = {branch:string;warehouse:string;leadDays:number;minStock:number};
type Settings = {inventory_rules:{locations?:LocationRule[];reviewDays?:number};customer_channel:string};
type Inquiry = {id:string;channel:string;contact_name:string;contact_ref:string;body:string;consent:boolean;status:string;task_id:string|null;created_at:string;reply_text?:string|null;replied_at?:string|null;provider_deleted_at?:string|null;provider_received_at?:string|null;provider_account_id?:string|null};
type Instagram = {connected:boolean;accountId?:string;canRead:boolean;canSend:boolean;reason?:string;webhookConfigured?:boolean};
type ActionAttempt = {task_id:string;action_index:number;status:string;kind:string;result?:Record<string,unknown>;error?:string};
type Snapshot = {departments?:Array<{id:string;name:string;human_head_role:string}>;templates:Template[];tasks:AutomationTask[];events:TaskEvent[];schedules:Schedule[];settings:Settings|null;inquiries:Inquiry[];agents:Agent[];paused:boolean;isAdmin?:boolean;instagram?:Instagram;actionAttempts?:ActionAttempt[];aiBudget?:AiBudgetSnapshot|null};
type Send = (body:Record<string,unknown>,message?:string)=>Promise<{ok:boolean;id?:string}>;
type View = 'work'|'recurring'|'customers';
type Dialog = {kind:'create';template:Template;initialBrief?:string;initialOwner?:string}|{kind:'choose'}|{kind:'follow_up';task:AutomationTask}|{kind:'complete';task:AutomationTask}|{kind:'execute';task:AutomationTask;index:number}|{kind:'inquiry';initialBody?:string}|{kind:'send_reply'|'inquiry_done';inquiry:Inquiry}|null;
const EMPTY:Snapshot={templates:[],tasks:[],events:[],schedules:[],settings:null,inquiries:[],agents:[],paused:false};
const ICONS:Record<AutomationKind,IconName>={head_task:'users',briefing:'doc',campaign:'spark',inventory:'bag',customer:'users',catalogue:'edit',advertising:'megaphone',data_quality:'check',follow_up:'clock'};
const BRIEFS:Partial<Record<AutomationKind,string>>={briefing:'Prepare a management briefing from the latest completed sales period. Show the most important decisions, source dates and any missing data.',inventory:'Review repeat sellers, available stock and branch replenishment needs. Prepare supported recommendations using the saved inventory rules.',advertising:'Review advertising results, identify supported improvement opportunities and prepare replacement creative briefs.',catalogue:'Check catalogue quality and prepare product copy improvements using only verified product details.',data_quality:'Check connected data sources, incomplete imports, unread design files and product matching. List what needs attention.'};
const STATUS_TONE:Record<string,string>={queued:'',running:'acc',blocked:'warn',review:'warn',completed:'good',cancelled:'',failed:'bad'};
const textError=(error:unknown)=>error instanceof Error?error.message:'The request could not be completed. Try again.';

export default function Automations({isAdmin,initialTask,initialAgent='',initialBrief='',initialKind=''}:{isAdmin:boolean;initialTask?:string;initialAgent?:string;initialBrief?:string;initialKind?:string}) {
  const [snapshot,setSnapshot]=useState<Snapshot>(EMPTY),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[message,setMessage]=useState('');
  const [view,setView]=useState<View>('work'),[filter,setFilter]=useState('active'),[search,setSearch]=useState(''),[selectedId,setSelectedId]=useState<string|null>(initialTask||null);
  const [dialog,setDialog]=useState<Dialog>(null),[sending,setSending]=useState(false),[lastLoaded,setLastLoaded]=useState<string|null>(null);
  const alive=useRef(true),inflight=useRef<Promise<void>|null>(null),posting=useRef(false),readController=useRef<AbortController|null>(null);
  const [page,setPage]=useState(1);
  const bridgeOpened=useRef(false);
  const load=useCallback(async()=>{
    if(inflight.current)return inflight.current;
    const controller=new AbortController();readController.current=controller;
    const request=(async()=>{
      try {
        const response=await fetch('/api/automations',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12_000)])});
        const data=await response.json().catch(()=>null);
        if(!response.ok||!data) {
          if((response.status===401||response.status===403)&&alive.current){setSnapshot(EMPTY);setSelectedId(null);setDialog(null);}
          throw new Error(data?.error||'Tasks could not be loaded. Refresh to try again.');
        }
        if(!alive.current||controller.signal.aborted)return;
        setSnapshot({...EMPTY,...data,tasks:data.tasks||[],events:data.events||[],templates:data.templates||[],agents:data.agents||[],schedules:data.schedules||[],inquiries:data.inquiries||[]});
        setLoadError('');setLastLoaded(new Date().toISOString());
      } catch(error) {if(alive.current&&!controller.signal.aborted)setLoadError(textError(error));}
      finally {if(alive.current&&!controller.signal.aborted)setLoading(false);}
    })();
    inflight.current=request;
    try {await request;}finally{if(inflight.current===request)inflight.current=null;}
  },[]);
  useEffect(()=>{
    alive.current=true;let timer:ReturnType<typeof setTimeout>;let stopped=false;
    const poll=async()=>{if(document.visibilityState==='visible'&&!posting.current)await load();if(!stopped)timer=setTimeout(poll,5000);};
    const visibility=()=>{if(document.visibilityState==='visible'&&!posting.current)void load();};
    void poll();document.addEventListener('visibilitychange',visibility);
    return()=>{stopped=true;alive.current=false;clearTimeout(timer);readController.current?.abort();document.removeEventListener('visibilitychange',visibility);};
  },[load]);
  useEffect(()=>{
    if((!initialAgent&&!initialKind)||loading||bridgeOpened.current||!snapshot.templates.length)return;
    bridgeOpened.current=true;
    const headTemplate=snapshot.templates.find(template=>template.kind==='head_task'&&template.canRun);
    if(initialKind==='head_task'&&headTemplate){setDialog({kind:'create',template:headTemplate,initialBrief,initialOwner:headOwnerFor(snapshot.agents,initialAgent)?.id});return;}
    if(snapshot.agents.some(agent=>agent.id===initialAgent)&&snapshot.templates.some(template=>template.canRun&&template.kind!=='follow_up'))setDialog({kind:'choose'});
  },[initialAgent,initialBrief,initialKind,loading,snapshot.agents,snapshot.templates]);
  const send:Send=async(body,successMessage)=>{
    if(posting.current)throw new Error('Wait for the current change to finish.');
    posting.current=true;setSending(true);setMessage('');
    try {
      const response=await fetch('/api/automations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30_000)});
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data?.ok)throw new Error(data?.error||'The change could not be confirmed. Refresh before trying again.');
      if(!alive.current)return {ok:true,id:data.id};
      if(inflight.current)await inflight.current;
      await load();
      if(successMessage)setMessage(successMessage);
      return data;
    } catch(error) {throw error instanceof DOMException&&error.name==='TimeoutError'?new Error('The response timed out. Refresh to check whether the change was saved. Your draft is kept.'):error;}
    finally{posting.current=false;if(alive.current)setSending(false);}
  };
  function choose(id:string){setSelectedId(id);setView('work');const url=new URL(window.location.href);url.searchParams.set('task',id);window.history.replaceState(null,'',url);}
  const selected=snapshot.tasks.find(task=>task.id===selectedId)||null;
  const names=Object.fromEntries(snapshot.agents.map(agent=>[agent.id,agent.name]));
  const templates=snapshot.templates.filter(template=>template.kind!=='follow_up').sort((a,b)=>Number(b.kind==='head_task')-Number(a.kind==='head_task'));
  const visible=snapshot.tasks.filter(task=>(filter==='all'||filter==='active'&&!['completed','cancelled'].includes(task.status)||filter===task.status)&&(!search.trim()||`${task.title} ${task.brief} ${names[task.owner_agent]||task.owner_agent}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const currentPage=Math.min(page,Math.max(1,Math.ceil(visible.length/10))),pageTasks=visible.slice((currentPage-1)*10,currentPage*10);
  useEffect(()=>{if(selectedId&&window.innerWidth<1100)document.getElementById?.('selected-task')?.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},[selectedId]);
  useEffect(()=>{if(!loading&&window.location.hash==='#new-task')document.getElementById?.('new-task')?.scrollIntoView({block:'start'});},[loading]);
  const needsYou=snapshot.tasks.filter(task=>['review','blocked','failed'].includes(task.status)).length;
  const working=snapshot.tasks.filter(task=>task.status==='running').length;
  const complete=snapshot.tasks.filter(task=>task.status==='completed').length;
  const admin=snapshot.isAdmin??isAdmin;
  const canFollow=snapshot.templates.some(template=>template.canRun);
  return <div className={`page ${styles.page}`}>
    <PageHead title="Automations" sub="Give the team a goal. Follow the work, review the result and track what happens next.">
      <button className="btn ghost" type="button" onClick={()=>void load()} disabled={sending||loading}><Icon name="sync" size={16}/>Refresh</button>
      {templates.some(template=>template.canRun)&&<button type="button" className="btn" disabled={sending||loading} onClick={()=>setDialog({kind:'choose'})}><Icon name="plus" size={17}/>New workflow</button>}
    </PageHead>
    <div className={styles.overview}><div><span className={styles.liveDot}/><strong>{lastLoaded?working:'—'}</strong><span>working</span></div><div><Icon name="bell" size={17}/><strong>{lastLoaded?needsYou:'—'}</strong><span>need attention</span></div><div><Icon name="check" size={17}/><strong>{lastLoaded?complete:'—'}</strong><span>completed</span></div><small>{lastLoaded?`Recent tasks · updated ${when(lastLoaded)} IST`:'Loading current work…'}</small></div>
    {snapshot.paused&&<div className={styles.notice} role="status"><Icon name="pause" size={18}/><div><b>Agent work is paused.</b><p>You can review saved work. Queued tasks will wait until agents resume.</p></div></div>}
    {loadError&&<div className={styles.error} role="alert">{loadError}{lastLoaded&&' The last successfully loaded snapshot is shown.'}</div>}
    {message&&<div className={`flash ok ${styles.message}`} role="status">{message}<button type="button" aria-label="Dismiss message" onClick={()=>setMessage('')}><Icon name="x" size={15}/></button></div>}
    <div className={styles.tabs} role="group" aria-label="Automation views"><button type="button" aria-pressed={view==='work'} onClick={()=>setView('work')}><Icon name="panel" size={17}/>Work</button><button type="button" aria-pressed={view==='recurring'} onClick={()=>setView('recurring')}><Icon name="clock" size={17}/>Recurring & rules</button><button type="button" aria-pressed={view==='customers'} onClick={()=>setView('customers')}><Icon name="users" size={17}/>Customer inbox</button></div>
    {loading?<div className={styles.empty} role="status"><span className="spin"><Icon name="sync" size={24}/></span><p>Loading your team’s workflows…</p></div>:view==='work'?<>
      <section className={styles.assignHero} id="new-task"><div className={styles.heroIcon}><Icon name="users" size={26}/></div><div><span className={styles.heroEyebrow}>YOUR AI TEAM</span><h2>One brief. The right people on it.</h2><p>Assign a goal to a department head. Follow every handoff, then review the finished result.</p></div>{templates.find(template=>template.kind==='head_task'&&template.canRun)&&<button type="button" className="btn" disabled={sending} onClick={()=>setDialog({kind:'create',template:templates.find(template=>template.kind==='head_task'&&template.canRun)!})}>Assign to a head<Icon name="arrow" size={16}/></button>}</section>
      <details className={styles.templateLibrary}><summary><Icon name="spark" size={17}/>Explore workflow templates <span>{templates.length} workflows</span></summary><section aria-label="Start a workflow" className={styles.templates}>{templates.map(template=><button key={template.kind} type="button" className={`${styles.template} ${template.kind==='head_task'?styles.headTemplate:''}`} disabled={!template.canRun||sending} onClick={()=>template.kind==='customer'?setDialog({kind:'inquiry'}):setDialog({kind:'create',template})}>
        <span className={styles.templateIcon}><Icon name={ICONS[template.kind]||'doc'} size={19}/></span><span className={styles.templateText}><b>{template.label}</b><span>{template.description}</span><small>{template.kind==='head_task'?'AI head → specialists → AI review → human':template.ownerName||names[template.ownerAgent]||template.ownerAgent}{!template.canRun?(template.kind==='head_task'?' · No available department head':' · Outside your access'):''}</small></span><Icon name="plus" size={16}/>
      </button>)}</section></details>
      <div className={styles.workLayout}>
        <section className={`card ${styles.board}`} aria-label="Task board"><div className={styles.sectionHead}><div><h2>Recent tasks</h2><p>{visible.length} matching tasks in this snapshot</p></div>{canFollow&&<button type="button" className="btn ghost sm-btn" onClick={()=>{const template=snapshot.templates.find(row=>row.kind==='follow_up'&&row.canRun);if(template)setDialog({kind:'create',template});}} disabled={sending||!snapshot.templates.some(row=>row.kind==='follow_up'&&row.canRun)}><Icon name="plus" size={14}/>Task</button>}</div>
          <label className={styles.search}><Icon name="search" size={16}/><input aria-label="Search tasks" type="search" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} placeholder="Find a task or agent…"/></label>
          <label className={styles.filter}><span>Status</span><select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="active">Active work</option><option value="all">All recent tasks</option><option value="review">Ready for review</option><option value="blocked">Needs input</option><option value="running">Working</option><option value="queued">Queued</option><option value="completed">Completed</option><option value="failed">Needs attention</option><option value="cancelled">Cancelled</option></select></label>
          {visible.length?<ul className={styles.taskList}>{pageTasks.map(task=><li key={task.id}><button type="button" className={`${styles.taskButton} ${selectedId===task.id?styles.selected:''}`} aria-pressed={selectedId===task.id} onClick={()=>choose(task.id)}><span className={styles.taskTop}><span className={`pill ${STATUS_TONE[task.status]}`}>{taskStatus(task)}</span>{isOverdue(task)&&<small className={styles.overdue}>Overdue</small>}{task.priority===1&&<small>High priority</small>}</span><b>{task.title}</b><span className={styles.taskBottom}><Avatar name={names[task.owner_agent]||task.owner_agent} dept={task.department_id} size={23}/><span>{names[task.owner_agent]||task.owner_agent}</span><time dateTime={task.updated_at}>{when(task.updated_at)}</time></span></button></li>)}</ul>:<div className={styles.empty}><Icon name="check" size={25}/><h3>{search?'No matching tasks':'No tasks in this view'}</h3><p>{search?'Try another name or change the status filter.':'Start a workflow above. Its progress and saved result will appear here.'}</p></div>}
          <Pagination label="Recent tasks" page={currentPage} total={visible.length} pageSize={10} onPageChange={setPage}/>
          <p className={styles.snapshotHint}>Recent saved work. Older tasks may be outside this snapshot.</p>
        </section>
        {selected?<TaskDetail key={selected.id} task={selected} tasks={snapshot.tasks} events={snapshot.events.filter(event=>event.task_id===selected.id)} names={names} send={send} busy={sending} onDialog={setDialog} onSelect={choose} canFollow={canFollow} actionAttempts={snapshot.actionAttempts||[]} humanHeadRole={snapshot.departments?.find(dept=>dept.id===selected.department_id)?.human_head_role||snapshot.agents.find(agent=>agent.id===selected.owner_agent)?.human_head_role}/>:<section className={`card ${styles.detailEmpty}`}><Icon name="doc" size={32}/><h2>{selectedId?'This task is not in the current list':'The work, in one place'}</h2><p>{selectedId?'Refresh or choose a recent task you have access to.':'Choose a task to see its brief, agent updates, evidence and finished work.'}</p><div className={styles.emptySteps}><span>Assigned</span><Icon name="arrow" size={15}/><span>Prepared</span><Icon name="arrow" size={15}/><span>Reviewed</span></div></section>}
      </div>
    </>:view==='recurring'?<Recurring snapshot={snapshot} isAdmin={admin} send={send} busy={sending}/>:<CustomerInbox snapshot={snapshot} canCreate={snapshot.templates.some(row=>row.kind==='customer'&&row.canRun)} onCreate={()=>setDialog({kind:'inquiry'})} onTask={choose} send={send} busy={sending} onDialog={setDialog}/>}
    {dialog?.kind==='choose'&&<WorkflowChoice templates={snapshot.templates} agent={snapshot.agents.find(agent=>agent.id===initialAgent)} brief={initialBrief} onClose={()=>setDialog(null)} onChoose={template=>setDialog(template.kind==='customer'?{kind:'inquiry',initialBody:initialBrief}:{kind:'create',template,initialBrief,initialOwner:template.kind==='head_task'?headOwnerFor(snapshot.agents,initialAgent)?.id:undefined})}/>}
    {dialog?.kind==='create'&&<CreateTask template={dialog.template} initialBrief={dialog.initialBrief} initialOwner={dialog.initialOwner} agents={snapshot.agents} tasks={snapshot.tasks} send={send} onClose={()=>setDialog(null)} onCreated={id=>{setDialog(null);setFilter('active');choose(id);}}/>}
    {dialog?.kind==='follow_up'&&<FollowUp task={dialog.task} agents={snapshot.agents} send={send} onClose={()=>setDialog(null)} onCreated={id=>{setDialog(null);choose(id);}}/>}
    {dialog?.kind==='complete'&&<CompleteTask task={dialog.task} send={send} onClose={()=>setDialog(null)}/>}
    {dialog?.kind==='execute'&&<ActionReview task={dialog.task} index={dialog.index} send={send} onClose={()=>setDialog(null)} onCreated={id=>{setDialog(null);if(id)choose(id);}}/>}
    {dialog?.kind==='inquiry'&&<InquiryForm initialBody={dialog.initialBody} send={send} onClose={()=>setDialog(null)} onCreated={id=>{setDialog(null);if(id)choose(id);else setView('customers');}}/>}
    {(dialog?.kind==='send_reply'||dialog?.kind==='inquiry_done')&&<ReplyAction kind={dialog.kind} inquiry={dialog.inquiry} send={send} onClose={()=>setDialog(null)}/>}
  </div>;
}

function TaskDetail({task,tasks,events,names,send,busy,onDialog,onSelect,canFollow,actionAttempts,humanHeadRole}:{task:AutomationTask;tasks:AutomationTask[];events:TaskEvent[];names:Record<string,string>;send:Send;busy:boolean;onDialog:(dialog:Dialog)=>void;onSelect:(id:string)=>void;canFollow:boolean;actionAttempts:ActionAttempt[];humanHeadRole?:string}) {
  const [error,setError]=useState(''),[cancelOpen,setCancelOpen]=useState(false);
  async function decide(action:string){setError('');try{await send({action,id:task.id,revision:task.revision},action==='accept'?'Deliverable accepted.':action==='cancel'?'Task cancelled.':'Task queued for another attempt.');setCancelOpen(false);}catch(e){setError(textError(e));}}
  const result=task.kind==='follow_up'&&task.status==='completed'&&task.state.completionNote?{...task.result,summary:'Follow-up completed. The owner’s completion evidence is recorded below.',markdown:String(task.state.completionNote),warnings:[],evidence:task.result?.evidence||[],actions:[],metrics:undefined}:task.result,children=tasks.filter(row=>row.parent_id===task.id);
  const campaignId=task.state?.campaignId||task.result?.state?.campaignId||task.state?.campaign_id||task.result?.state?.campaign_id;
  const headReport=task.kind==='head_task'?headReportHref(task):null;
  const budgetDeferred=task.status==='queued'&&task.state?.blockedReason==='ai_budget';
  return <section className={`card ${styles.detail}`} id="selected-task" aria-label="Selected task">
    <div className={styles.detailTop}><span className={`pill ${STATUS_TONE[task.status]}`}>{taskStatus(task)}</span><span className={styles.kind}>{task.kind.replaceAll('_',' ')}</span>{isOverdue(task)&&<span className="pill warn">Past due</span>}</div>
    <h2>{task.title}</h2>
    <div className={styles.owner}><Avatar name={names[task.owner_agent]||task.owner_agent} dept={task.department_id} size={34}/><div><b>{names[task.owner_agent]||task.owner_agent}</b><span>{task.kind==='head_task'?'AI head responsible for delivery':'Task owner'}</span></div><Link href={`/office?focus=${encodeURIComponent(task.owner_agent)}`} className={styles.officeLink}><Icon name="map" size={14}/>Find in office</Link></div>
    <dl className={styles.metadata}><div><dt>Assigned</dt><dd>{when(task.created_at)} IST</dd></div><div><dt>Due</dt><dd>{task.due_at?`${when(task.due_at)} IST`:'No deadline set'}</dd></div><div><dt>Last update</dt><dd>{when(task.updated_at)} IST</dd></div><div><dt>Priority</dt><dd>{task.priority===1?'High':task.priority===3?'Low':'Normal'}</dd></div></dl>
    <details className={styles.brief}><summary>Original brief</summary><p>{task.brief||'No additional brief.'}</p></details>
    {task.kind==='head_task'&&<HeadTaskFlow task={task} names={names} humanHeadRole={humanHeadRole}/>}
    {task.kind==='follow_up'&&task.status==='blocked'&&<div className={styles.notice}><Icon name="clock" size={18}/><div><b>This follow-up needs input</b><p>Resolve the missing inputs and retry. If the work was completed outside AI Office, record its completion evidence below.</p></div></div>}
    {budgetDeferred?<div className={styles.notice} role="status"><Icon name="clock" size={18}/><div><b>Waiting for the AI Office text budget</b><p>This task stays queued and becomes eligible again {task.state.retryAt?`around ${when(String(task.state.retryAt))} IST`:'when enough app budget is available'}. You do not need to submit it again. ChatGPT’s own availability and any office pause still apply.</p></div></div>:task.status==='queued'&&<p className={styles.statusNote}><Icon name="clock" size={16}/>{task.depends_on?.length?'Waiting for its dependencies and an available worker.':'Saved in the queue. An available agent will pick this up.'}</p>}
    {task.status==='running'&&<p className={styles.statusNote}><span className="spin"><Icon name="sync" size={16}/></span>The agent is working. Saved updates appear below.</p>}
    {task.error&&<div className={styles.error} role="alert">{task.error}</div>}
    {task.depends_on?.length>0&&<div className={styles.dependencies}><b>Depends on</b>{task.depends_on.map(id=>{const dependency=tasks.find(row=>row.id===id);return dependency?<button key={id} type="button" onClick={()=>onSelect(id)}>{dependency.title}<span className="pill">{taskStatus(dependency)}</span></button>:<span key={id}>A prerequisite task outside this view</span>;})}</div>}
    {result&&<div className={styles.result}>
      <div className={styles.sectionHead}><h3>{task.status==='blocked'?'What needs attention':task.kind==='head_task'&&!headReport?'Saved workflow progress':'Saved deliverable'}</h3><a href={`/api/automations/${encodeURIComponent(task.id)}/export`} className="btn ghost sm-btn" download><Icon name="doc" size={14}/>Download</a></div>
      <p className={styles.summary}>{result.summary}</p>
      {Object.entries(result.metrics||{}).length>0&&<dl className={styles.metrics}>{Object.entries(result.metrics||{}).filter(([,value])=>Number.isFinite(value)).map(([key,value])=><div key={key}><dt>{key.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ')}</dt><dd>{value.toLocaleString('en-IN')}</dd></div>)}</dl>}
      {result.warnings?.length>0&&<div className={styles.warnings}><b>Coverage and considerations</b><ul>{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
      {result.markdown&&<Markdown text={result.markdown}/>}
      {!!campaignId&&typeof campaignId==='string'&&<Link className="btn ghost" href={`/approvals?campaign=${encodeURIComponent(campaignId)}#campaign-${encodeURIComponent(campaignId)}`}><Icon name="check" size={16}/>Open campaign approvals</Link>}
      {result.evidence?.length>0&&<details className={styles.evidence}><summary>Evidence used · {result.evidence.length} sources</summary><ul>{result.evidence.map((entry,index)=><li key={index}><b>{entry.source}</b><p>{entry.detail}</p>{entry.at&&<time dateTime={entry.at}>{when(entry.at)} IST</time>}</li>)}</ul></details>}
      {!!result.actions?.length&&<div className={styles.proposals}><h3>Proposed next steps</h3>{result.actions.map((action,index)=>{const attempt=actionAttempts.find(row=>row.task_id===task.id&&row.action_index===index);const done=attempt&&['completed','succeeded'].includes(attempt.status),uncertain=attempt&&['running','executing','review','uncertain'].includes(attempt.status);return <div key={`${action.kind}-${index}`} className={styles.proposal}><div><b>{action.label}</b><span>{done?'This action has been completed.':uncertain?'This action needs its recorded outcome checked before another attempt.':action.kind==='create_campaign'?'Prepare a campaign for the existing approval process.':action.kind==='inquiry_reply'?'Approve and save this reply draft.':action.kind.includes('copy')?'Review the exact product copy before changing Shopify.':'Review the proposed work before assigning it.'}</span>{attempt?.error&&<span className={styles.actionError}>{attempt.error}</span>}</div><button className="btn ghost sm-btn" type="button" disabled={busy||!!done||!!uncertain||task.status!=='review'} onClick={()=>onDialog({kind:'execute',task,index})}>{done?'Completed':uncertain?'Check outcome':'Review'}{!done&&!uncertain&&<Icon name="arrow" size={14}/>}</button></div>;})}</div>}
    </div>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
    <div className={styles.taskActions}>
      {task.kind==='head_task'&&headReport&&<Link className="btn" href={headReport}><Icon name="check" size={16}/>{task.status==='review'?'Review approved output':'View human review'}</Link>}
      {task.status==='review'&&task.kind!=='head_task'&&<button type="button" className="btn" disabled={busy} onClick={()=>void decide('accept')}><Icon name="check" size={16}/>Accept and close</button>}
      {task.kind==='follow_up'&&task.status==='blocked'&&<button type="button" className="btn" disabled={busy} onClick={()=>onDialog({kind:'complete',task})}><Icon name="check" size={16}/>Record completion</button>}
      {['blocked','failed'].includes(task.status)&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void decide('retry')}><Icon name="sync" size={16}/>Retry after fixing inputs</button>}
      {canFollow&&task.kind!=='follow_up'&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>onDialog({kind:'follow_up',task})}><Icon name="plus" size={16}/>Assign follow-up</button>}
      {!['completed','cancelled'].includes(task.status)&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>setCancelOpen(value=>!value)}>Cancel task</button>}
    </div>
    {task.kind==='head_task'&&task.status==='review'&&headReport&&task.state.headWorkflow?.review?.decision==='approve'&&<p className={styles.note}>The AI head has approved the output. The human reviewer can accept it, send it back with instructions or reject it in Approvals. Acceptance does not publish or send anything outside AI Office.</p>}
    {task.status==='review'&&task.kind!=='head_task'&&<p className={styles.note}>Choose any proposed next steps above before accepting and closing this deliverable. Accepting records your review; it does not execute those actions.</p>}
    {cancelOpen&&<div className={styles.cancel}><p>Cancel this task? Saved work remains available.</p><button type="button" className="btn ghost sm-btn" disabled={busy} onClick={()=>setCancelOpen(false)}>Keep task</button><button type="button" className="btn ghost sm-btn" disabled={busy} onClick={()=>void decide('cancel')}>Confirm cancellation</button></div>}
    {children.length>0&&<div className={styles.dependencies}><h3>Follow-up work</h3>{children.map(child=><button key={child.id} type="button" onClick={()=>onSelect(child.id)}>{child.title}<span className="pill">{taskStatus(child)}</span></button>)}</div>}
    <details className={styles.activity}><summary>Activity · {events.length} updates</summary>{events.length?<ol>{events.map(event=><li key={event.id}><span className={styles.activityDot}/><div><b>{event.agent_id?names[event.agent_id]||event.agent_id:'Task update'}</b><p>{event.text}</p><time dateTime={event.created_at}>{when(event.created_at)} IST</time></div></li>)}</ol>:<p className={styles.note}>No saved activity yet.</p>}</details>
  </section>;
}


function HeadTaskFlow({task,names,humanHeadRole}:{task:AutomationTask;names:Record<string,string>;humanHeadRole?:string}) {
  const flow=task.state?.headWorkflow||{},plan=flow.plan,assignments=Array.isArray(plan?.assignments)?plan.assignments.filter((row:any)=>typeof row?.agentId==='string'):[],steps=headTaskProgress(task);
  const quality=flow.quality,qcPassed=quality?.decision==='pass'&&headQualityCurrent(flow);
  const recipient=humanHeadRole?ROLE_LABEL[humanHeadRole as AppRole]||'Department human head':'Department human head';
  return <div className={styles.headFlow} aria-label="Head delegation workflow">
    <div className={styles.sectionHead}><div><h3>From your brief to human review</h3><p>Human recipient: <b>{recipient}</b></p></div>{Number(flow.humanRevision)>0&&<span className="pill">Human revision {flow.humanRevision}</span>}</div>
    <ol className={styles.headSteps}>{steps.map((step,index)=><li key={step.label} data-state={step.state} aria-current={step.state==='current'?'step':undefined}><span className={styles.headStepNumber}>{step.done?<Icon name="check" size={13}/>:index+1}</span><div><b>{step.label}</b><small>{step.detail}</small></div></li>)}</ol>
    {flow.humanFeedback&&<blockquote className={styles.headFeedback}><b>Human revision instructions</b><p>{String(flow.humanFeedback)}</p></blockquote>}
    {flow.blockReason&&task.status==='blocked'&&<p className={styles.noticeText}><b>Input needed: </b>{String(flow.blockReason)}</p>}
    {plan?.understanding&&<div className={styles.headUnderstanding}><b>The head’s understanding</b><p>{String(plan.understanding)}</p>{Array.isArray(plan.successCriteria)&&plan.successCriteria.length>0&&<><small>Success checks</small><ul>{plan.successCriteria.map((criterion:string,index:number)=><li key={index}>{criterion}</li>)}</ul></>}</div>}
    {assignments.length>0&&<div className={styles.assignments}><h4>Delegated work</h4>{assignments.map((assignment:any,index:number)=>{
      const output=flow.outputs?.[assignment.agentId],progress=headAssignmentProgress(flow,assignment.agentId);
      return <article key={`${assignment.agentId}-${index}`}>
        <header><b>{names[assignment.agentId]||assignment.agentId}</b><span className={`pill ${progress.blocked||progress.revising?'warn':progress.returned?'good':''}`}>{progress.label}</span></header>
        <p>{assignment.task}</p>{assignment.deliverable&&<small>Expected output: {assignment.deliverable}</small>}
        {Array.isArray(output?.missing)&&output.missing.length>0&&<ul className={styles.assignmentWarnings}>{output.missing.map((missing:string,i:number)=><li key={i}>{missing}</li>)}</ul>}
        {output?.body&&<details>
          <summary>{progress.revising?'Earlier draft · correction requested':'Returned work'}{output.revision>0?` · revision ${output.revision}`:''}</summary>
          {output.summary&&<p><b>{output.summary}</b></p>}<Markdown text={String(output.body)}/>
          {Array.isArray(output.warnings)&&output.warnings.length>0&&<ul className={styles.assignmentWarnings}>{output.warnings.map((warning:string,i:number)=><li key={i}>{warning}</li>)}</ul>}
          {Array.isArray(output.evidence)&&output.evidence.length>0&&<p className={styles.note}>{output.evidence.length} evidence reference{output.evidence.length===1?'':'s'} recorded with this draft.</p>}
        </details>}
      </article>;
    })}</div>}
    {flow.review?.note&&<blockquote className={styles.headReview}><b>{headReviewAttribution(flow)}: {flow.review.decision==='approve'?'approved':flow.review.decision==='revise'?'requested changes':'needs input'}</b><p>{String(flow.review.note)}</p>{Array.isArray(flow.review.revisionRequests)&&flow.review.revisionRequests.length>0&&<ul>{flow.review.revisionRequests.map((request:any,index:number)=><li key={index}><b>{names[request.agentId]||request.agentId}:</b> {request.instruction}</li>)}</ul>}</blockquote>}
    {quality&&<blockquote className={styles.headReview}><b>Independent QC · {names[quality.reviewerId]||quality.reviewerId}: {qcPassed?'passed the current version':quality.decision==='pass'?'earlier pass invalidated':quality.decision==='revise'?'requested a correction':'needs input'}</b><p>{String(quality.note)}</p>{!qcPassed&&quality.decision==='pass'&&<p className={styles.noticeText}>The deliverable, plan or source evidence changed after this check. A new QC pass is required before handoff.</p>}{Array.isArray(quality.findings)&&quality.findings.length>0&&<ul>{quality.findings.map((finding:string,index:number)=><li key={index}>{finding}</li>)}</ul>}<small>Checked {when(quality.checkedAt)} IST · human round {quality.artifact?.humanRevision??0} · correction round {quality.artifact?.revisionRound??0}</small></blockquote>}

  </div>;
}

function Modal({title,onClose,busy,children}:{title:string;onClose:()=>void;busy:boolean;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),titleId=useId();
  useEffect(()=>{const element=ref.current,previous=document.activeElement as HTMLElement|null;element?.showModal();return()=>{element?.close();previous?.focus();};},[]);
  const [dirty,setDirty]=useState(false),[confirmClose,setConfirmClose]=useState(false);
  const requestClose=()=>{if(busy)return;if(dirty)setConfirmClose(true);else onClose();};
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  return <dialog ref={ref} className={styles.modal} aria-labelledby={titleId} onChangeCapture={()=>setDirty(true)} onClickCapture={event=>{const button=(event.target as HTMLElement).closest?.('[data-close-dialog]');if(button&&dirty){event.preventDefault();event.stopPropagation();requestClose();}}} onCancel={event=>{event.preventDefault();requestClose();}}><header><h2 id={titleId}>{title}</h2><button type="button" aria-label="Close" disabled={busy} onClick={requestClose}><Icon name="x" size={20}/></button></header>{confirmClose&&<section className={styles.discardNotice} role="alert"><div><b>Keep your changes?</b><p>Your unsaved draft will be lost if you close this window.</p></div><div><button className="btn ghost sm-btn" type="button" disabled={busy} onClick={()=>setConfirmClose(false)}>Keep editing</button><button className="btn sm-btn" type="button" disabled={busy} onClick={onClose}>Discard draft</button></div></section>}{children}</dialog>;
}

function WorkflowChoice({templates,agent,brief,onClose,onChoose}:{templates:Template[];agent:Agent|undefined;brief:string;onClose:()=>void;onChoose:(template:Template)=>void}) {
  const available=templates.filter(template=>template.canRun&&template.kind!=='follow_up');
  const [kind,setKind]=useState(()=>suggestedWorkflow(agent,templates)||''),id=useId();
  function next(event:FormEvent){event.preventDefault();const template=available.find(row=>row.kind===kind);if(template)onChoose(template);}
  return <Modal title="Choose a workflow" busy={false} onClose={onClose}><form className={styles.form} onSubmit={next}><p className={styles.note}>{agent?`Continue from your conversation with ${agent.name}. `:''}{brief?'Your latest saved request will be copied into the brief for review.':'Choose the work you want the team to prepare.'} Work starts after you review and submit the next form.</p><div className={styles.workflowChoices} role="radiogroup" aria-label="Available workflows">{available.map(template=><label key={template.kind} className={kind===template.kind?styles.chosenWorkflow:''}><input type="radio" name={`${id}-workflow`} value={template.kind} checked={kind===template.kind} onChange={()=>setKind(template.kind)}/><Icon name={ICONS[template.kind]||'doc'} size={18}/><span><b>{template.label}</b><small>{template.description}</small></span></label>)}</div>{brief&&<details className={styles.brief}><summary>Latest saved request</summary><p>{brief}</p></details>}<div className={styles.formActions}><button type="button" className="btn ghost" data-close-dialog onClick={onClose}>Close</button><button type="submit" className="btn" disabled={!kind}>Review brief<Icon name="arrow" size={16}/></button></div></form></Modal>;
}

function useSubmission(send:Send) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef<{signature:string;id:string}|null>(null),lock=useRef(false);
  async function submit(body:Record<string,unknown>,message?:string) {
    if(lock.current)return null;
    lock.current=true;setBusy(true);setError('');
    pending.current=submissionKey(pending.current,body,()=>crypto.randomUUID());
    try {const result=await send({...body,requestId:pending.current.id},message);pending.current=null;return result;}
    catch(e){setError(textError(e));return null;}finally{lock.current=false;setBusy(false);}
  }
  return {busy,error,setError,submit};
}

function CreateTask({template,initialBrief,initialOwner,agents,tasks,send,onClose,onCreated}:{template:Template;initialBrief?:string;initialOwner?:string;agents:Agent[];tasks:AutomationTask[];send:Send;onClose:()=>void;onCreated:(id:string)=>void}) {
  const {busy,error,setError,submit}=useSubmission(send),[brief,setBrief]=useState(initialBrief||BRIEFS[template.kind]||''),id=useId();
  async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);try{const dueAt=dueInIST(String(form.get('due')||'')),ids=productIds(String(form.get('products')||'')),dependsOn=form.getAll('depends');if(dependsOn.length>12)throw new Error('Choose up to 12 prerequisite tasks.');const result=await submit({action:'create',kind:template.kind,title:String(form.get('title')||''),brief:brief.trim(),ownerAgent:String(form.get('owner')||template.ownerAgent),priority:Number(form.get('priority')||2),...(dueAt?{dueAt}:{}),dependsOn,input:ids.length?{productIds:ids}:{}},'Task saved.');if(result?.id)onCreated(result.id);else if(result)setError('Task saved, but its detail could not be opened. Close this form and refresh the task list.');}catch(e){setError(textError(e));}}
  const owners=template.kind==='head_task'?agents.filter(agent=>agent.is_lead&&agent.enabled!==false):template.kind==='follow_up'?agents:agents.filter(agent=>agent.id===template.ownerAgent);
  const defaultOwner=template.kind==='head_task'?headOwnerFor(owners,initialOwner)?.id||'':template.ownerAgent;
  return <Modal title={template.label} onClose={onClose} busy={busy}><form onSubmit={create} className={styles.form}><p className={styles.note}>{template.description}</p><label className="field" htmlFor={`${id}-title`}>Task name<input id={`${id}-title`} name="title" maxLength={180} defaultValue={template.label} required disabled={busy}/></label><label className="field" htmlFor={`${id}-brief`}>What should the team deliver?<textarea id={`${id}-brief`} rows={5} maxLength={6000} value={brief} onChange={event=>setBrief(event.target.value)} required disabled={busy} placeholder={template.kind==='campaign'?'Describe the occasion, audience, products and desired campaign.':'Describe the result and how you will check it.'}/></label><div className={styles.formGrid}><label className="field" htmlFor={`${id}-owner`}>{template.kind==='head_task'?'AI head':'Owner'}<select id={`${id}-owner`} name="owner" defaultValue={defaultOwner} disabled={busy} required>{owners.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label className="field" htmlFor={`${id}-priority`}>Priority<select id={`${id}-priority`} name="priority" defaultValue="2" disabled={busy}><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></select></label></div><label className="field" htmlFor={`${id}-due`}>Due date and time · IST<input id={`${id}-due`} name="due" type="datetime-local" disabled={busy} required={template.kind==='follow_up'}/></label>{template.kind==='catalogue'&&<label className="field" htmlFor={`${id}-products`}>Product IDs · optional<input id={`${id}-products`} name="products" placeholder="Leave empty to review the catalogue" disabled={busy}/><small>Enter up to 3 Shopify numeric product IDs, separated by commas.</small></label>}{tasks.some(task=>!['cancelled','failed'].includes(task.status))&&<details className={styles.formDetails}><summary>Wait for another task</summary><p className={styles.note}>This task starts only after every selected prerequisite is completed.</p><div className={styles.checkList}>{tasks.filter(task=>!['cancelled','failed'].includes(task.status)).slice(0,30).map(task=><label key={task.id}><input type="checkbox" name="depends" value={task.id} disabled={busy}/><span>{task.title}<small>{taskStatus(task)}</small></span></label>)}</div></details>}{template.kind==='head_task'&&<p className={styles.noticeText}>The AI head chooses the right specialists, reviews their completed work and requests a correction if needed. Only the output the AI head approves is handed to the human reviewer. Your saved usage limits still apply.</p>}{template.kind==='campaign'&&<p className={styles.noticeText}>This starts campaign planning and artwork production. Publishing keeps the existing department and final approval steps.</p>}{error&&<p className={styles.error} role="alert">{error}</p>}<div className={styles.formActions}><button type="button" className="btn ghost" disabled={busy} data-close-dialog onClick={onClose}>Close</button><button type="submit" className="btn" disabled={busy||!brief.trim()||!owners.length}>{busy?'Saving…':template.kind==='head_task'?'Assign to AI head':template.kind==='follow_up'?'Assign task':'Start workflow'}<Icon name="arrow" size={16}/></button></div></form></Modal>;
}

function FollowUp({task,agents,send,onClose,onCreated}:{task:AutomationTask;agents:Agent[];send:Send;onClose:()=>void;onCreated:(id:string)=>void}) {
  const {busy,error,setError,submit}=useSubmission(send),id=useId();
  async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);try{const dueAt=dueInIST(String(form.get('due')||''));if(!dueAt)throw new Error('Choose a due date for this follow-up.');const result=await submit({action:'follow_up',id:task.id,revision:task.revision,title:String(form.get('title')||''),brief:String(form.get('brief')||''),ownerAgent:String(form.get('owner')||''),dueAt},'Follow-up assigned.');if(result?.id)onCreated(result.id);else if(result)onClose();}catch(e){setError(textError(e));}}
  return <Modal title="Assign follow-up" onClose={onClose} busy={busy}><form className={styles.form} onSubmit={create}><p className={styles.note}>Follow-up to “{task.title}”. The assigned agent will prepare the analysis or draft and bring it back for review.</p><label className="field" htmlFor={`${id}-title`}>Task name<input id={`${id}-title`} name="title" required maxLength={180} disabled={busy}/></label><label className="field" htmlFor={`${id}-brief`}>Deliverable and success check<textarea id={`${id}-brief`} name="brief" rows={5} maxLength={6000} required disabled={busy} placeholder="What needs to be done, and what evidence should the owner provide?"/></label><div className={styles.formGrid}><label className="field" htmlFor={`${id}-owner`}>Owner<select id={`${id}-owner`} name="owner" defaultValue={task.owner_agent} disabled={busy}>{agents.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label className="field" htmlFor={`${id}-due`}>Due date and time · IST<input id={`${id}-due`} name="due" type="datetime-local" required disabled={busy}/></label></div>{error&&<p className={styles.error} role="alert">{error}</p>}<div className={styles.formActions}><button className="btn ghost" type="button" disabled={busy} data-close-dialog onClick={onClose}>Close</button><button className="btn" type="submit" disabled={busy}>{busy?'Assigning…':'Assign follow-up'}</button></div></form></Modal>;
}

function CompleteTask({task,send,onClose}:{task:AutomationTask;send:Send;onClose:()=>void}) {
  const {busy,error,submit}=useSubmission(send),[note,setNote]=useState(''),id=useId();
  async function complete(event:FormEvent){event.preventDefault();if(await submit({action:'complete',id:task.id,revision:task.revision,note},'Completion recorded.'))onClose();}
  return <Modal title="Record completion" busy={busy} onClose={onClose}><form className={styles.form} onSubmit={complete}><p className={styles.note}>{task.title}</p><label className="field" htmlFor={id}>What was completed? Include evidence or a result link.<textarea id={id} rows={6} required maxLength={3000} value={note} onChange={event=>setNote(event.target.value)} disabled={busy}/></label>{error&&<p className={styles.error} role="alert">{error}</p>}<div className={styles.formActions}><button type="button" className="btn ghost" disabled={busy} data-close-dialog onClick={onClose}>Close</button><button className="btn" type="submit" disabled={busy||!note.trim()}>{busy?'Saving…':'Mark completed'}</button></div></form></Modal>;
}

function ActionReview({task,index,send,onClose,onCreated}:{task:AutomationTask;index:number;send:Send;onClose:()=>void;onCreated:(id?:string)=>void}) {
  const action=task.result?.actions?.[index],{busy,error,submit}=useSubmission(send);
  async function execute(){if(!action)return;const result=await submit({action:'execute',id:task.id,revision:task.revision,actionIndex:index},action.kind==='inquiry_reply'?'Approved reply saved.':action.kind.includes('copy')?'Product copy update recorded.':'Next step recorded.');if(result)onCreated(result.id);}
  return <Modal title={action?actionLabel(action.kind,action.label):'Review action'} busy={busy} onClose={onClose}><div className={styles.form}>{action?<><p className={styles.summary}>{action.label}</p><ActionPreview action={action}/>{action.kind==='inquiry_reply'&&<p className={styles.noticeText}>This saves an approved reply draft. It does not send a message to the customer.</p>}{action.kind==='create_campaign'&&<p className={styles.noticeText}>Starts the team’s campaign workflow, including artwork where available. The campaign still goes through the existing approval process.</p>}{error&&<p className={styles.error} role="alert">{error}</p>}<div className={styles.formActions}><button className="btn ghost" type="button" disabled={busy} data-close-dialog onClick={onClose}>Close</button><button className="btn" type="button" disabled={busy} onClick={()=>void execute()}>{busy?'Saving…':actionLabel(action.kind,action.label)}</button></div></>:<p>The proposal is no longer available. Close this window and refresh the task.</p>}</div></Modal>;
}

function ActionPreview({action}:{action:AutomationAction}) {
  const p=action.payload,copy=action.kind==='catalogue_copy'||action.kind==='shopify_copy';
  if(copy)return <div className={styles.actionPreview}><div className={styles.productRef}>Shopify product <b>{String(p.productId||'')}</b>{typeof p.sourceUpdatedAt==='string'&&<span>Source checked {when(p.sourceUpdatedAt)} IST</span>}</div><div className={styles.compare}><div><span className="eyebrow">Current title</span><p>{String(p.originalTitle||'Not recorded')}</p></div><div><span className="eyebrow">Proposed title</span><p>{String(p.title||'Keep current title')}</p></div></div>{(['description','seoTitle','seoDescription'] as const).map(field=>p[field]?<div key={field}><b>{field==='description'?'Description':field==='seoTitle'?'SEO title':'SEO description'}</b><p className={styles.pre}>{String(p[field])}</p></div>:null)}<p className={styles.note}>Review product identity and wording before applying this copy to the live store.</p></div>;
  return <div className={styles.actionPreview}>{Object.entries(p).filter(([key])=>!['sourceTaskId','inquiryId'].includes(key)).map(([key,value])=><div key={key}><b>{({brief:'Brief',title:'Task',reply:'Reply draft',ownerAgent:'Owner',dueInHours:'Due in hours'} as Record<string,string>)[key]||key.replaceAll('_',' ')}</b><p className={styles.pre}>{typeof value==='string'||typeof value==='number'?String(value):JSON.stringify(value,null,2)}</p></div>)}</div>;
}

function Recurring({snapshot,isAdmin,send,busy}:{snapshot:Snapshot;isAdmin:boolean;send:Send;busy:boolean}) {
  if(!isAdmin)return <section className={`card ${styles.empty}`}><Icon name="clock" size={28}/><h2>Recurring work is managed by the Super Admin</h2><p>Your department’s saved tasks and deliverables appear in Work.</p></section>;
  return <div className={styles.recurring}><TextUsageLimits managed budget={snapshot.aiBudget} disabled={busy} onSave={settings=>send({action:'ai_budget',settings})}/><section className="card"><div className={styles.sectionHead}><div><h2>Recurring workflows</h2><p>Times use IST. New work starts when a worker is available.</p></div><Icon name="clock" size={22}/></div><div className={styles.schedules}>{snapshot.schedules.map(schedule=><ScheduleRow key={`${schedule.kind}-${schedule.enabled}-${schedule.cadence_hours}-${schedule.local_hour}`} schedule={schedule} template={snapshot.templates.find(row=>row.kind===schedule.kind)} send={send} busy={busy}/>)}</div>{!snapshot.schedules.length&&<p className={styles.note}>No recurring workflows are available yet.</p>}</section><InventoryRules settings={snapshot.settings} send={send} disabled={busy}/></div>;
}

function ScheduleRow({schedule,template,send,busy:parentBusy}:{schedule:Schedule;template?:Template;send:Send;busy:boolean}) {
  const {busy,error,submit}=useSubmission(send),[enabled,setEnabled]=useState(schedule.enabled),[cadence,setCadence]=useState(schedule.cadence_hours),[hour,setHour]=useState(schedule.local_hour),id=useId();
  const dirty=enabled!==schedule.enabled||cadence!==schedule.cadence_hours||hour!==schedule.local_hour;
  async function save(event:FormEvent){event.preventDefault();await submit({action:'schedule',kind:schedule.kind,enabled,cadenceHours:cadence,localHour:hour},'Recurring workflow updated.');}
  return <form className={styles.schedule} onSubmit={save}><div className={styles.scheduleTitle}><b>{template?.label||schedule.kind.replaceAll('_',' ')}</b><small>{schedule.last_queued_at?`Last queued ${when(schedule.last_queued_at)} IST`:'No scheduled run queued yet'}</small></div><label className={styles.toggle}><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)} disabled={busy||parentBusy}/><span>{enabled?'Enabled':'Off'}</span></label><div className={styles.scheduleFields}><label className="field" htmlFor={`${id}-cadence`}>Repeat every<select id={`${id}-cadence`} value={cadence} onChange={event=>setCadence(Number(event.target.value))} disabled={busy||parentBusy}>{[6,12,24,48,72,168].map(hours=><option key={hours} value={hours}>{hours<24?`${hours} hours`:hours===24?'Day':hours===168?'Week':`${hours/24} days`}</option>)}</select></label><label className="field" htmlFor={`${id}-hour`}>Start hour · IST<select id={`${id}-hour`} value={hour} onChange={event=>setHour(Number(event.target.value))} disabled={busy||parentBusy}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>)}</select></label><button className="btn ghost sm-btn" disabled={!dirty||busy||parentBusy} type="submit">{busy?'Saving…':'Save'}</button></div>{error&&<p className={styles.error} role="alert">{error}</p>}</form>;
}

function InventoryRules({settings,send,disabled}:{settings:Settings|null;send:Send;disabled:boolean}) {
  const [locations,setLocations]=useState<LocationRule[]>(settings?.inventory_rules?.locations||[]),[reviewDays,setReviewDays]=useState(settings?.inventory_rules?.reviewDays||7),{busy,error,setError,submit}=useSubmission(send);
  const [saved,setSaved]=useState(false);
  const change=(index:number,key:keyof LocationRule,value:string|number)=>{setSaved(false);setLocations(rows=>rows.map((row,i)=>i===index?{...row,[key]:value}:row));};
  async function save(event:FormEvent){event.preventDefault();if(locations.some(row=>!row.branch.trim()||!row.warehouse.trim())){setError('Enter both the sales branch and warehouse for each location.');return;}if(new Set(locations.map(row=>row.branch.trim())).size!==locations.length||new Set(locations.map(row=>row.warehouse.trim())).size!==locations.length){setError('Use each sales branch and warehouse only once.');return;}const result=await submit({action:'settings',inventoryRules:{locations:locations.map(row=>({...row,branch:row.branch.trim(),warehouse:row.warehouse.trim()})),reviewDays}},'Inventory planning rules saved.');if(result)setSaved(true);}
  return <section className="card"><div className={styles.sectionHead}><div><h2>Inventory planning rules</h2><p>Match Odoo sales branches to stock warehouses so agents can calculate supported quantities.</p></div><Icon name="building" size={22}/></div><form className={styles.form} onSubmit={save}>{locations.length?<div className={styles.locationRules}>{locations.map((row,index)=><fieldset key={index} disabled={busy||disabled}><legend>Location {index+1}</legend><div className={styles.formGrid}><label className="field">Sales branch<input required maxLength={200} value={row.branch} onChange={event=>change(index,'branch',event.target.value)} placeholder="Exact Odoo branch name"/></label><label className="field">Stock warehouse<input required maxLength={200} value={row.warehouse} onChange={event=>change(index,'warehouse',event.target.value)} placeholder="Exact Odoo warehouse name"/></label><label className="field">Replenishment lead time · days<input type="number" min={0} max={180} value={row.leadDays} onChange={event=>change(index,'leadDays',Number(event.target.value))} required/></label><label className="field">Minimum stock · pieces<input type="number" min={0} max={100000} value={row.minStock} onChange={event=>change(index,'minStock',Number(event.target.value))} required/></label></div><button type="button" className={styles.remove} onClick={()=>{setSaved(false);setLocations(rows=>rows.filter((_,i)=>i!==index));}}>Remove location</button></fieldset>)}</div>:<p className={styles.noticeText}>No branch-to-warehouse mapping is saved. Agents can report stock risks, but precise location replenishment needs these rules.</p>}<div className={styles.rulesBottom}><button type="button" className="btn ghost sm-btn" disabled={busy||disabled||locations.length>=50} onClick={()=>{setSaved(false);setLocations(rows=>[...rows,{branch:'',warehouse:'',leadDays:7,minStock:0}]);}}><Icon name="plus" size={15}/>Add location</button><label className="field">Review interval · days<input type="number" min={1} max={90} value={reviewDays} onChange={event=>{setSaved(false);setReviewDays(Number(event.target.value));}} required disabled={busy||disabled}/></label><button className="btn" type="submit" disabled={busy||disabled}>{busy?'Saving…':'Save rules'}</button></div>{saved&&<p className="flash ok" role="status">Rules saved for the next inventory task.</p>}{error&&<p className={styles.error} role="alert">{error}</p>}</form></section>;
}

function CustomerInbox({snapshot,canCreate,onCreate,onTask,send,busy,onDialog}:{snapshot:Snapshot;canCreate:boolean;onCreate:()=>void;onTask:(id:string)=>void;send:Send;busy:boolean;onDialog:(dialog:Dialog)=>void}) {
  const instagram=snapshot.instagram,{busy:syncing,error,submit}=useSubmission(send);
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(1);
  const inquiries=snapshot.inquiries.filter(row=>(filter==='all'||filter==='open'&&!row.replied_at&&row.status!=='closed'||filter==='replied'&&(!!row.replied_at||row.status==='closed'))&&(!search.trim()||`${row.contact_name} ${row.body} ${row.contact_ref}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const currentPage=Math.min(page,Math.max(1,Math.ceil(inquiries.length/10))),pageInquiries=inquiries.slice((currentPage-1)*10,currentPage*10);
  async function sync(){await submit({action:'instagram_sync'},'Instagram inbox checked. Imported enquiries appear below.');}
  return <section className={`card ${styles.inbox}`}>
    <div className={styles.sectionHead}><div><h2>Customer enquiries</h2><p>Capture a question, prepare a grounded reply and track its follow-up.</p></div>{canCreate&&<button type="button" className="btn" disabled={busy} onClick={onCreate}><Icon name="plus" size={16}/>Add enquiry</button>}</div>
    <div className={styles.inboxConnection}><Icon name="plug" size={22}/><div><b>Instagram inbox</b><span className={`pill ${instagram?.canRead?'good':'warn'}`}>{instagram?.canRead?'Inbox connected':instagram?.connected?'Access needed':'Connection needed'}</span><p>{instagram?.reason||(instagram?.canRead?'Import recent customer messages and prepare replies for review.':'Inbox access has not been confirmed. Manual enquiry capture is available below.')}</p>{instagram?.accountId&&<small>Account {instagram.accountId}</small>}{instagram?.canRead&&<small>{instagram.webhookConfigured?'Incoming-message updates are configured.':'Use Sync messages to check for new enquiries.'}</small>}{(!instagram?.canRead||!instagram?.canSend)&&<div className={styles.connectionAction}>{snapshot.isAdmin?<a className="btn ghost sm-btn" href="/api/connect/meta?capability=instagram"><Icon name="plug" size={14}/>Connect messaging access</a>:<small>The Super Admin can connect Instagram messaging access in Admin.</small>}</div>}</div>{canCreate&&instagram?.canRead&&<button className="btn ghost sm-btn" type="button" disabled={busy||syncing} onClick={()=>void sync()}><Icon name="sync" size={15}/>{syncing?'Checking…':'Sync messages'}</button>}</div>
    <p className={styles.note}>Replies are saved as drafts first. An approved Instagram reply is sent only when you choose Send Instagram reply.</p>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    <div className={styles.inboxFilters}><label className={styles.search}><Icon name="search" size={16}/><input type="search" aria-label="Search enquiries" placeholder="Find a customer or message…" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label><label className={styles.filter}>Status<select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All enquiries</option><option value="open">Needs a reply</option><option value="replied">Replied or closed</option></select></label></div>
    {inquiries.length?<ul className={styles.inquiryList}>{pageInquiries.map(inquiry=>{const replyAvailability=instagramReplyAvailability(inquiry);return <li key={inquiry.id}>
      <div className={styles.inquiryTop}><Avatar name={inquiry.contact_name||'Customer'} size={34}/><div><b>{inquiry.contact_name||'Customer enquiry'}</b><small>{inquiry.channel} · {when(inquiry.created_at)} IST</small></div><span className="pill">{inquiry.status.replaceAll('_',' ')}</span></div><p>{inquiry.body}</p>{inquiry.contact_ref&&<span className={styles.note}>{inquiry.contact_ref}</span>}
      {inquiry.reply_text&&<div className={styles.approvedReply}><b>{inquiry.replied_at?'Recorded reply':'Approved reply draft'}</b><p>{inquiry.reply_text}</p>{inquiry.replied_at&&<small>Replied {when(inquiry.replied_at)} IST</small>}{inquiry.channel==='instagram'&&!inquiry.replied_at&&!replyAvailability.allowed&&<small>{replyAvailability.reason}</small>}</div>}
      <div className={styles.inquiryBottom}><small>{inquiry.consent?'Follow-up permission recorded':'No follow-up permission recorded'}</small><div className={styles.inquiryActions}>{inquiry.task_id&&<button type="button" className="btn ghost sm-btn" onClick={()=>onTask(inquiry.task_id!)}>Open reply task<Icon name="arrow" size={14}/></button>}{canCreate&&!inquiry.replied_at&&!inquiry.provider_deleted_at&&inquiry.status!=='closed'&&<>{replyAvailability.allowed&&instagram?.canSend&&<button type="button" className="btn sm-btn" disabled={busy} onClick={()=>onDialog({kind:'send_reply',inquiry})}>Send Instagram reply</button>}<button type="button" className="btn ghost sm-btn" disabled={busy} onClick={()=>onDialog({kind:'inquiry_done',inquiry})}>Mark replied manually</button></>}</div></div>
    </li>;})}</ul>:<div className={styles.empty}><Icon name="users" size={28}/><h3>No enquiries in this view</h3><p>{canCreate?'Add a customer’s question or sync the connected inbox. The team will prepare a reply for review.':'Customer enquiries are visible to the CRM head and Super Admin.'}</p></div>}
    <Pagination label="Customer enquiries" page={currentPage} total={inquiries.length} pageSize={10} onPageChange={setPage}/>
    <p className={styles.note}>Recent saved enquiries. Older messages may be outside this snapshot.</p>
  </section>;
}

function ReplyAction({kind,inquiry,send,onClose}:{kind:'send_reply'|'inquiry_done';inquiry:Inquiry;send:Send;onClose:()=>void}) {
  const {busy,error,submit}=useSubmission(send),[note,setNote]=useState(''),id=useId(),sending=kind==='send_reply';
  async function save(event:FormEvent){event.preventDefault();const result=await submit({action:kind,inquiryId:inquiry.id,...(!sending?{note}:{})},sending?'Instagram reply sent.':'Manual reply recorded.');if(result)onClose();}
  return <Modal title={sending?'Send Instagram reply':'Record a manual reply'} busy={busy} onClose={onClose}><form className={styles.form} onSubmit={save}><p className={styles.note}>{sending?'This sends the saved approved reply to':'Record the reply already given to'} <b>{inquiry.contact_name||'this customer'}</b>{inquiry.contact_ref?` · ${inquiry.contact_ref}`:''}.</p>{sending?<><div className={styles.actionPreview}><b>Approved reply</b><p>{inquiry.reply_text}</p></div><p className={styles.noticeText}>The server checks the Instagram reply window and saved recipient before sending.</p></>:<label className="field" htmlFor={id}>Reply or completion evidence<textarea id={id} rows={5} value={note} onChange={event=>setNote(event.target.value)} required maxLength={2000} disabled={busy} placeholder="What did you send, and where?"/></label>}{error&&<p className={styles.error} role="alert">{error}</p>}<div className={styles.formActions}><button type="button" className="btn ghost" disabled={busy} data-close-dialog onClick={onClose}>Close</button><button type="submit" className="btn" disabled={busy||(!sending&&!note.trim())}>{busy?(sending?'Sending…':'Saving…'):(sending?'Send Instagram reply':'Record reply')}</button></div></form></Modal>;
}

function InquiryForm({send,onClose,onCreated,initialBody=''}:{send:Send;onClose:()=>void;onCreated:(id?:string)=>void;initialBody?:string}) {
  const {busy,error,submit}=useSubmission(send),id=useId();
  async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);const result=await submit({action:'inquiry',channel:String(form.get('channel')||'manual'),contactName:String(form.get('name')||''),contactRef:String(form.get('reference')||''),body:String(form.get('body')||''),consent:form.get('consent')==='on'},'Enquiry saved and a reply task queued.');if(result)onCreated(result.id);}
  return <Modal title="Add customer enquiry" busy={busy} onClose={onClose}><form className={styles.form} onSubmit={create}><p className={styles.note}>Record a real enquiry. The CRM agent will prepare a reply for your review.</p><div className={styles.formGrid}><label className="field" htmlFor={`${id}-name`}>Customer name<input id={`${id}-name`} name="name" maxLength={200} required disabled={busy}/></label><label className="field" htmlFor={`${id}-channel`}>Where did it arrive?<select id={`${id}-channel`} name="channel" defaultValue="manual" disabled={busy}><option value="manual">Showroom / manual</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="email">Email</option></select></label></div><label className="field" htmlFor={`${id}-reference`}>Contact or conversation reference · optional<input id={`${id}-reference`} name="reference" maxLength={300} disabled={busy} placeholder="Email, phone number or conversation reference"/></label><label className="field" htmlFor={`${id}-body`}>Customer’s question<textarea id={`${id}-body`} name="body" rows={6} defaultValue={initialBody} required maxLength={6000} disabled={busy} placeholder="Include the product and details they asked about."/></label><label className={styles.consent}><input type="checkbox" name="consent" disabled={busy}/><span>The customer has agreed to receive follow-up messages.</span></label><p className={styles.note}>This creates a reply draft. No message is sent from this form.</p>{error&&<p className={styles.error} role="alert">{error}</p>}<div className={styles.formActions}><button className="btn ghost" type="button" disabled={busy} data-close-dialog onClick={onClose}>Close</button><button className="btn" type="submit" disabled={busy}>{busy?'Saving…':'Save and prepare reply'}</button></div></form></Modal>;
}

/** Safe, small Markdown renderer: no raw HTML or executable links. */
function inline(text:string):ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`)/g).map((part,index)=>{
    if(part.startsWith('**')&&part.endsWith('**'))return <strong key={index}>{part.slice(2,-2)}</strong>;
    if(part.startsWith('`')&&part.endsWith('`'))return <code key={index}>{part.slice(1,-1)}</code>;
    const link=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(part),href=link&&safeHref(link[2]);
    if(link&&href)return <a key={index} href={href} target={href.startsWith('/')?undefined:'_blank'} rel="noopener noreferrer">{link[1]}</a>;
    return part;
  });
}
function Markdown({text}:{text:string}) {
  const lines=text.replace(/\r\n/g,'\n').split('\n'),blocks:ReactNode[]=[];
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];if(!line.trim())continue;
    if(line.startsWith('```')) {const code:string[]=[];while(++i<lines.length&&!lines[i].startsWith('```'))code.push(lines[i]);blocks.push(<pre key={`c${i}`}>{code.join('\n')}</pre>);continue;}
    if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])) {
      const cells=(row:string)=>row.trim().replace(/^\||\|$/g,'').split('|').map(value=>value.trim()),head=cells(line),rows:string[][]=[];i++;
      while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim())rows.push(cells(lines[++i]));
      blocks.push(<div key={`t${i}`} className={styles.tableWrap}><table><thead><tr>{head.map((cell,j)=><th key={j}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row,r)=><tr key={r}>{row.map((cell,c)=><td key={c}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);continue;
    }
    const heading=/^(#{1,6})\s+(.+)$/.exec(line);if(heading){blocks.push(<h4 key={`h${i}`}>{inline(heading[2])}</h4>);continue;}
    if(/^\s*([-*]|\d+\.)\s+/.test(line)) {const items=[line.replace(/^\s*([-*]|\d+\.)\s+/,'')];while(i+1<lines.length&&/^\s*([-*]|\d+\.)\s+/.test(lines[i+1]))items.push(lines[++i].replace(/^\s*([-*]|\d+\.)\s+/,''));blocks.push(<ul key={`l${i}`}>{items.map((item,j)=><li key={j}>{inline(item)}</li>)}</ul>);continue;}
    const paragraph=[line];while(i+1<lines.length&&lines[i+1].trim()&&!/^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i+1])&&!(lines[i+1].includes('|')&&i+2<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+2])))paragraph.push(lines[++i]);
    blocks.push(<p key={`p${i}`}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className={styles.markdown}>{blocks}</div>;
}
