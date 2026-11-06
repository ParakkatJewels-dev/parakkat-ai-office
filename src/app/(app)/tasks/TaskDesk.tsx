'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AgentConversation from '@/components/AgentConversation';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { NewTaskButton } from '@/components/NewTaskPanel';
import styles from './TaskDesk.module.css';

type Head={id:string;name:string;department_id:string;role_desc?:string};
type Thread={id:string;agent_id:string;title:string;status:string;error?:string|null;created_at:string;updated_at:string};
type Work={id:string;kind:string;title:string;brief?:string;status:string;owner_agent:string;department_id:string;result?:{summary?:string;markdown?:string;warnings?:string[]}|null;state?:{headWorkflow?:{phase?:string;plan?:{understanding?:string;assignments?:Array<{agentId:string;task:string;deliverable?:string}>};review?:{decision?:string;note?:string};blockReason?:string}};error?:string|null;created_at:string;updated_at:string};
type Snapshot={heads:Head[];threads:Thread[];tasks:Work[];taskDetail?:Work|null;canSend:boolean};
type Kind='conversation'|'task';
type Item={id:string;kind:Kind;title:string;status:string;agentId:string;updatedAt:string;thread?:Thread;task?:Work};
const empty:Snapshot={heads:[],threads:[],tasks:[],canSend:false};
// The same status words as the rest of the workspace.
const WORD:Record<string,[string,string]>={queued:['Working','acc'],running:['Working','acc'],review:['Needs you','needs'],blocked:['Needs you','needs'],completed:['Done','good'],failed:['Stopped','bad'],cancelled:['Cancelled',''],idle:['Answered','good']};
const word=(status:string)=>WORD[status]||[status,''];
const ago=(at:string)=>{const m=Math.round((Date.now()-Date.parse(at))/6e4);return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`;};

/** Where a task is on the path: you → AI head → specialist → AI review → you. */
function progress(task:Work):{label:string;state:'done'|'now'|'todo'|'bad'}[] {
  const phase=task.state?.headWorkflow?.phase||'',status=task.status;
  const at=status==='completed'?5:status==='review'?4:phase==='review'?3:['specialist','work','contribution','assignment','generation'].includes(phase)?2:task.state?.headWorkflow?.plan?2:1;
  const bad=status==='failed'||status==='blocked';
  return ['You asked','AI head plans','Specialist works','AI head checks','Your review'].map((label,i)=>({label,state:i<at?'done':i===at?(bad?'bad':'now'):'todo'}));
}

export default function TaskDesk() {
  const params=useSearchParams(),opened=params.get('open')||'';
  const [snapshot,setSnapshot]=useState<Snapshot>(empty),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [selected,setSelected]=useState<{kind:Kind;id:string}|null>(()=>{const [kind,id]=opened.split(':');return (kind==='task'||kind==='conversation')&&id?{kind,id}:null;});
  const load=useCallback(async(signal?:AbortSignal,detailId?:string)=>{
    const taskId=detailId||(selected?.kind==='task'?selected.id:'');
    const response=await fetch(`/api/tasks${taskId?`?task=${encodeURIComponent(taskId)}`:''}`,{cache:'no-store',signal});
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data)throw new Error(data?.error||'Your tasks couldn’t load. This page retries on its own.');
    setSnapshot(data);setError('');setLoading(false);
  },[selected?.kind,selected?.id]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{await load(controller.signal);}catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Your tasks couldn’t load. This page retries on its own.');setLoading(false);}}finally{if(!controller.signal.aborted)timer=setTimeout(poll,6000);}};
    void poll();return()=>{controller.abort();clearTimeout(timer);};
  },[load]);
  // A task sent from the New task panel opens here straight away.
  useEffect(()=>{
    const created=(event:Event)=>{const d=(event as CustomEvent<{kind:Kind;id:string}>).detail;if(d?.id)setSelected({kind:d.kind==='task'?'task':'conversation',id:d.id});};
    window.addEventListener('workspace:task-created',created);return()=>window.removeEventListener('workspace:task-created',created);
  },[]);
  useEffect(()=>{const [kind,id]=opened.split(':');if((kind==='task'||kind==='conversation')&&id)setSelected({kind,id});},[opened]);
  const items:Item[]=[...snapshot.threads.map(thread=>({id:thread.id,kind:'conversation' as const,title:thread.title,status:thread.status,agentId:thread.agent_id,updatedAt:thread.updated_at,thread})),
    ...snapshot.tasks.map(task=>{const full=snapshot.taskDetail?.id===task.id?{...task,...snapshot.taskDetail}:task;return {id:task.id,kind:'task' as const,title:task.title,status:task.status,agentId:task.owner_agent,updatedAt:task.updated_at,task:full};})]
    .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  const active=selected?items.find(item=>item.id===selected.id&&item.kind===selected.kind):items[0];
  const names=Object.fromEntries(snapshot.heads.map(head=>[head.id,head.name]));
  const waitingOnYou=items.filter(item=>['review','blocked'].includes(item.status)).length;
  return <div className={`page ${styles.page}`}>
    <header className={styles.header}>
      <div><h1>Tasks</h1><p>Everything you’ve asked the team for. A team head plans each one, a specialist does it, the head checks it, then it comes back to you.</p></div>
      <div className="page-actions">{snapshot.heads.some(head=>head.department_id==='reels')&&<Link className="btn ghost" href="/video"><Icon name="film" size={16}/>Edit a video</Link>}<NewTaskButton><Icon name="plus" size={16}/>New task</NewTaskButton></div>
    </header>
    {error&&<p className="flash" role="alert">{error}</p>}
    {!loading&&!snapshot.canSend&&!error&&<p className="banner" role="status">No AI team head is set up for your account yet, so you can read tasks but not send new ones.</p>}
    <div className={styles.layout}>
      <aside className={`card ${styles.inbox}`} aria-label="Your tasks">
        <div className={styles.sectionHead}><h2>Your tasks</h2><span>{waitingOnYou?`${waitingOnYou} need${waitingOnYou===1?'s':''} you`:`${items.length} recent`}</span></div>
        {loading?<ul className={styles.skeleton} aria-label="Loading your tasks">{[0,1,2,3].map(i=><li key={i}/>)}</ul>
          :items.length?<ol>{items.map(item=>{const [text,tone]=word(item.status);return <li key={`${item.kind}:${item.id}`}><button type="button" className={active?.id===item.id&&active.kind===item.kind?styles.active:''} aria-current={active?.id===item.id&&active.kind===item.kind?'true':undefined} onClick={()=>setSelected({kind:item.kind,id:item.id})}>
            <span className={styles.itemTop}><b>{item.title}</b></span>
            <span className={styles.itemMeta}><span>{names[item.agentId]||'AI team'} · {ago(item.updatedAt)}</span><span className={`pill ${tone}`}>{text}</span></span></button></li>;})}</ol>
          :<div className="empty"><Icon name="tasks" size={24}/><p>Nothing yet. Ask the team for anything: a report, a post, a campaign plan.</p><NewTaskButton className="btn ghost sm-btn"><Icon name="plus" size={14}/>New task</NewTaskButton></div>}
      </aside>
      <section className={`card ${styles.detail}`} aria-label="The selected task">
        {active?<>
          <div className={styles.sectionHead}><div><small className={styles.kind}>{active.kind==='conversation'?'Question':'Task'} · led by {names[active.agentId]||'the AI team'}</small><h2>{active.title}</h2></div><span className={`pill ${word(active.status)[1]}`}>{word(active.status)[0]}</span></div>
          {active.kind==='conversation'&&<AgentConversation key={`${active.agentId}:${active.id}`} agentId={active.agentId} agentName={names[active.agentId]||active.agentId} initialThreadId={active.id}/>}
          {active.kind==='task'&&active.task&&<TaskReport task={active.task} names={names}/>}
        </>:!loading&&<div className="empty"><Icon name="send" size={24}/><p>Pick a task from the list, or start a new one.</p></div>}
      </section>
    </div>
  </div>;
}

function TaskReport({task,names}:{task:Work;names:Record<string,string>}) {
  if(!task.brief)return <p className={styles.muted} role="status">Loading this task…</p>;
  const flow=task.state?.headWorkflow,assignments=flow?.plan?.assignments||[];
  return <div className={styles.report}>
    <ol className={styles.path} aria-label="Progress">{progress(task).map(step=><li key={step.label} data-state={step.state}><i aria-hidden="true">{step.state==='done'?<Icon name="check" size={12}/>:null}</i><span>{step.label}</span></li>)}</ol>
    <section><h3>What you asked</h3><p className={styles.brief}>{task.brief}</p></section>
    {task.result?.summary&&<section className={styles.answer}><h3>The answer</h3><p>{task.result.summary}</p></section>}
    {task.result?.markdown&&<section><h3>The full result</h3><Markdown text={task.result.markdown} className={`md ${styles.output}`}/></section>}
    {flow?.review?.note&&<section><h3>The AI head’s check</h3><p>{flow.review.note}</p></section>}
    {(flow?.blockReason||task.error)&&<p className="flash" role="alert">{flow?.blockReason||task.error}</p>}
    {(flow?.plan?.understanding||assignments.length>0)&&<details className={styles.more}><summary>How the team worked on it</summary>
      {flow?.plan?.understanding&&<p>{flow.plan.understanding}</p>}
      {assignments.length>0&&<ol>{assignments.map((assignment,index)=><li key={`${assignment.agentId}:${index}`}><b>{names[assignment.agentId]||assignment.agentId}</b><p>{assignment.task}</p>{assignment.deliverable&&<small>Hands over: {assignment.deliverable}</small>}</li>)}</ol>}
    </details>}
    <div className={styles.actions}>{task.status==='review'&&<Link className="btn" href={`/automations?task=${encodeURIComponent(task.id)}`}>Review and decide<Icon name="arrow" size={15}/></Link>}<Link className="btn ghost" href={`/automations?task=${encodeURIComponent(task.id)}`}>Open the full task<Icon name="arrow" size={15}/></Link></div>
  </div>;
}
