'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AgentConversation from '@/components/AgentConversation';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { NewTaskButton } from '@/components/NewTaskPanel';
import { PageHead } from '@/components/PageHead';
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
// The board's four columns, by where each request stands.
const COLUMNS:{id:string;label:string;statuses:string[];dot:string}[]=[
  {id:'needs',label:'Needs you',statuses:['review','blocked'],dot:'var(--needs)'},
  {id:'working',label:'Working',statuses:['queued','running'],dot:'#9d85ff'},
  {id:'done',label:'Done',statuses:['completed','idle'],dot:'#22d3a6'},
  {id:'stopped',label:'Stopped',statuses:['failed','cancelled'],dot:'#ff6b6b'},
];
const ago=(at:string)=>{const m=Math.round((Date.now()-Date.parse(at))/6e4);return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`;};

/** Where a task is on the path: you → AI head → specialist → AI review → you. */
function progress(task:Work):{label:string;state:'done'|'now'|'todo'|'bad'}[] {
  const phase=task.state?.headWorkflow?.phase||'',status=task.status;
  const at=status==='completed'?5:status==='review'?4:phase==='review'?3:['specialist','work','contribution','assignment','generation'].includes(phase)?2:task.state?.headWorkflow?.plan?2:1;
  const bad=status==='failed'||status==='blocked',stopped=status==='cancelled';
  return ['You asked','AI head plans','Specialist works','AI head checks','Your review'].map((label,i)=>({label,state:i<at?'done':i===at?(bad?'bad':stopped?'todo':'now'):'todo'}));
}

export default function TaskDesk() {
  const params=useSearchParams(),opened=params.get('open')||'';
  const [snapshot,setSnapshot]=useState<Snapshot>(empty),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [selected,setSelected]=useState<{kind:Kind;id:string}|null>(()=>{const [kind,id]=opened.split(':');return (kind==='task'||kind==='conversation')&&id?{kind,id}:null;});
  // The drawer starts open on wide screens; on a phone it opens when you pick a task.
  const [drawer,setDrawer]=useState(()=>!!opened||typeof window==='undefined'||window.innerWidth>900),[more,setMore]=useState<Record<string,boolean>>({});
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
    const created=(event:Event)=>{const d=(event as CustomEvent<{kind:Kind;id:string}>).detail;if(d?.id){setSelected({kind:d.kind==='task'?'task':'conversation',id:d.id});setDrawer(true);}};
    window.addEventListener('workspace:task-created',created);return()=>window.removeEventListener('workspace:task-created',created);
  },[]);
  useEffect(()=>{const [kind,id]=opened.split(':');if((kind==='task'||kind==='conversation')&&id){setSelected({kind,id});setDrawer(true);}},[opened]);
  const items:Item[]=[...snapshot.threads.map(thread=>({id:thread.id,kind:'conversation' as const,title:thread.title,status:thread.status,agentId:thread.agent_id,updatedAt:thread.updated_at,thread})),
    ...snapshot.tasks.map(task=>{const full=snapshot.taskDetail?.id===task.id?{...task,...snapshot.taskDetail}:task;return {id:task.id,kind:'task' as const,title:task.title,status:task.status,agentId:task.owner_agent,updatedAt:task.updated_at,task:full};})]
    .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  const names=Object.fromEntries(snapshot.heads.map(head=>[head.id,head.name]));
  const column=(status:string)=>COLUMNS.find(c=>c.statuses.includes(status))?.id||'working';
  const fallback=items.find(item=>column(item.status)==='needs')||items[0];
  const active=selected?items.find(item=>item.id===selected.id&&item.kind===selected.kind):fallback;
  const open=(item:Item)=>{setSelected({kind:item.kind,id:item.id});setDrawer(true);};
  return <div className={`page ${styles.page}`}>
    <PageHead title="Tasks" sub="Everything you’ve asked the team for, by where it stands. A team head plans each one, a specialist does it, the head checks it, then it comes back to you.">
      {snapshot.heads.some(head=>head.department_id==='reels')&&<Link className="btn ghost" href="/video"><Icon name="film" size={16}/>Edit a video</Link>}<NewTaskButton><Icon name="plus" size={16}/>New task</NewTaskButton>
    </PageHead>
    {error&&<p className="flash" role="alert">{error}</p>}
    {!loading&&!snapshot.canSend&&!error&&<p className="banner" role="status">You can read tasks, but no team head is set up for you to send new ones.</p>}
    <div className={styles.layout}>
      <div className={styles.board} aria-busy={loading}>
        {COLUMNS.map(col=>{const list=items.filter(item=>column(item.status)===col.id),shown=more[col.id]?list:list.slice(0,8);return <section key={col.id} className={styles.col} aria-labelledby={`col-${col.id}`}>
          <div className={styles.colHead}><i style={{background:col.dot}} aria-hidden="true"/><h2 id={`col-${col.id}`}>{col.label}</h2><span>{loading?'…':list.length}</span></div>
          {loading?<span className={styles.skeleton} aria-hidden="true"/>
            :shown.length?shown.map(item=>{const isOpen=drawer&&active?.id===item.id&&active.kind===item.kind;return <button key={`${item.kind}:${item.id}`} type="button" className={`${styles.card} ${isOpen?styles.on:''}`} aria-pressed={isOpen} onClick={()=>open(item)}>
              <b>{item.title}</b>
              {item.kind==='task'&&item.task?<span className={styles.bar} aria-hidden="true">{progress(item.task).map(step=><i key={step.label} data-state={step.state}/>)}</span>:<span className={styles.tag}>Question</span>}
              <small>{names[item.agentId]||'AI team'} · {ago(item.updatedAt)}{col.id==='stopped'?` · ${word(item.status)[0].toLowerCase()}`:''}</small>
            </button>;})
            :<p className={styles.none}>{col.id==='needs'?'Nothing waits on you.':col.id==='working'?'Nothing in progress.':'None yet.'}</p>}
          {list.length>8&&<button type="button" className={styles.moreBtn} onClick={()=>setMore(m=>({...m,[col.id]:!m[col.id]}))}>{more[col.id]?'Show fewer':`Show ${list.length-8} more`}</button>}
        </section>;})}
        {!loading&&!items.length&&<div className={`empty ${styles.wide}`}><Icon name="tasks" size={20}/><p>No tasks yet.</p><NewTaskButton className="btn ghost sm-btn"><Icon name="plus" size={14}/>New task</NewTaskButton></div>}
      </div>
      {drawer&&active&&<aside className={styles.drawer} aria-label="The open task">
        <div className={styles.drawerHead}><div><small className={styles.kind}>{names[active.agentId]||'AI team'} · {ago(active.updatedAt)}</small><h2>{active.title}</h2></div><button type="button" className="btn ghost sm-btn" aria-label="Close" onClick={()=>setDrawer(false)}><Icon name="x" size={15}/></button></div>
        <span className={`pill ${word(active.status)[1]}`} style={{alignSelf:'flex-start'}}>{word(active.status)[0]}</span>
        {active.kind==='conversation'&&<AgentConversation key={`${active.agentId}:${active.id}`} agentId={active.agentId} agentName={names[active.agentId]||active.agentId} initialThreadId={active.id}/>}
        {active.kind==='task'&&active.task&&<TaskReport task={active.task} names={names}/>}
      </aside>}
    </div>
  </div>;
}

function TaskReport({task,names}:{task:Work;names:Record<string,string>}) {
  if(!task.brief)return <p className={styles.muted} role="status">Loading this task…</p>;
  const flow=task.state?.headWorkflow,assignments=flow?.plan?.assignments||[];
  return <div className={styles.report}>
    <ol className={styles.path} aria-label="Progress">{progress(task).map(step=><li key={step.label} data-state={step.state}><i aria-hidden="true">{step.state==='done'?<Icon name="check" size={12}/>:null}</i><span>{step.label}</span></li>)}</ol>
    <p className={styles.brief}>{task.brief}</p>
    {task.result?.summary&&<p className={styles.answer}>{task.result.summary}</p>}
    {task.result?.markdown&&<Markdown text={task.result.markdown} className={`md ${styles.output}`}/>}
    {flow?.review?.note&&<p className={styles.check}><b>AI head:</b> {flow.review.note}</p>}
    {(flow?.blockReason||task.error)&&<p className="flash" role="alert">{flow?.blockReason||task.error}</p>}
    {(flow?.plan?.understanding||assignments.length>0)&&<details className={styles.more}><summary>Who worked on it</summary>
      {flow?.plan?.understanding&&<p>{flow.plan.understanding}</p>}
      {assignments.length>0&&<ol>{assignments.map((assignment,index)=><li key={`${assignment.agentId}:${index}`}><b>{names[assignment.agentId]||assignment.agentId}</b><p>{assignment.task}</p>{assignment.deliverable&&<small>Hands over: {assignment.deliverable}</small>}</li>)}</ol>}
    </details>}
    <div className={styles.actions}>{task.status==='review'&&<Link className="btn" href={`/automations?task=${encodeURIComponent(task.id)}`}>Review and decide<Icon name="arrow" size={15}/></Link>}<Link className="btn ghost" href={`/automations?task=${encodeURIComponent(task.id)}`}>Full task<Icon name="arrow" size={15}/></Link></div>
  </div>;
}
