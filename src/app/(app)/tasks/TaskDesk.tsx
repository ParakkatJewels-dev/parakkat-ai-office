'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import AgentConversation from '@/components/AgentConversation';
import { Icon } from '@/components/Icon';
import styles from './TaskDesk.module.css';

type Head={id:string;name:string;department_id:string;role_desc?:string};
type Thread={id:string;agent_id:string;title:string;status:string;error?:string|null;created_at:string;updated_at:string};
type Work={id:string;kind:string;title:string;brief?:string;status:string;owner_agent:string;department_id:string;result?:{summary?:string;markdown?:string;warnings?:string[]}|null;state?:{headWorkflow?:{phase?:string;plan?:{understanding?:string;assignments?:Array<{agentId:string;task:string;deliverable?:string}>};review?:{decision?:string;note?:string};blockReason?:string}};error?:string|null;created_at:string;updated_at:string};
type Snapshot={heads:Head[];threads:Thread[];tasks:Work[];taskDetail?:Work|null;canSend:boolean};
type Item={id:string;kind:'conversation'|'task';title:string;status:string;agentId:string;updatedAt:string;thread?:Thread;task?:Work};
const empty:Snapshot={heads:[],threads:[],tasks:[],canSend:false};
const label=(status:string)=>({queued:'Queued',running:'Working',review:'Ready for review',completed:'Completed',blocked:'Needs input',failed:'Needs attention',cancelled:'Cancelled',idle:'Ready'} as Record<string,string>)[status]||status;

export default function TaskDesk() {
  const [snapshot,setSnapshot]=useState<Snapshot>(empty),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [draft,setDraft]=useState(''),[mode,setMode]=useState<'auto'|'chat'|'work'>('auto'),[target,setTarget]=useState('');
  const [selected,setSelected]=useState<{kind:'conversation'|'task';id:string;agentId:string}|null>(null),[sending,setSending]=useState(false);
  const pending=useRef<{clientId:string;message:string;mode:string;agentId:string}|null>(null);
  const load=useCallback(async(signal?:AbortSignal,detailId?:string)=>{
    const taskId=detailId||(selected?.kind==='task'?selected.id:'');
    const response=await fetch(`/api/tasks${taskId?`?task=${encodeURIComponent(taskId)}`:''}`,{cache:'no-store',signal});
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data)throw new Error(data?.error||'The task inbox could not be loaded.');
    setSnapshot(data);setError('');setLoading(false);
  },[selected?.kind,selected?.id]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{await load(controller.signal);}catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:'The task inbox could not be loaded.');setLoading(false);}}finally{if(!controller.signal.aborted)timer=setTimeout(poll,6000);}};
    void poll();return()=>{controller.abort();clearTimeout(timer);};
  },[load]);
  const items:Item[]=[...snapshot.threads.map(thread=>({id:thread.id,kind:'conversation' as const,title:thread.title,status:thread.status,agentId:thread.agent_id,updatedAt:thread.updated_at,thread})),
    ...snapshot.tasks.map(task=>{const full=snapshot.taskDetail?.id===task.id?{...task,...snapshot.taskDetail}:task;return {id:task.id,kind:'task' as const,title:task.title,status:task.status,agentId:task.owner_agent,updatedAt:task.updated_at,task:full};})]
    .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  const active=selected?items.find(item=>item.id===selected.id&&item.kind===selected.kind):items[0];
  const names=Object.fromEntries(snapshot.heads.map(head=>[head.id,head.name]));
  async function submit(event:FormEvent) {
    event.preventDefault();const message=draft.trim();if(!message||sending||!snapshot.canSend)return;
    const same=pending.current?.message===message&&pending.current.mode===mode&&pending.current.agentId===target;
    const request=same?pending.current!:{clientId:crypto.randomUUID(),message,mode,agentId:target};
    pending.current=request;setSending(true);setError('');
    try {
      const response=await fetch('/api/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data?.id)throw new Error(data?.error||'The task could not be assigned. Retry to check the same request.');
      setSelected({kind:data.kind,id:data.id,agentId:data.agentId});setDraft('');pending.current=null;
      await load(undefined,data.kind==='task'?data.id:undefined);
    }catch(e){setError(e instanceof Error?e.message:'The task could not be assigned. Retry to check the same request.');}
    finally{setSending(false);}
  }
  const changeDraft=(value:string)=>{setDraft(value);pending.current=null;};
  return <div className={`page ${styles.page}`}>
    <header className={styles.header}><div><span className={styles.eyebrow}>AI OFFICE</span><h1>Tasks & chat</h1><p>Ask a question or give the office a job. An AI team head assigns the right specialist, reviews the result and reports back here.</p></div><Link className="btn ghost" href="/office"><Icon name="map" size={16}/>Office map</Link></header>
    <section className={`card ${styles.composer}`} aria-label="Give the AI office a request">
      <form onSubmit={submit}><label htmlFor="office-request">What should the team do?</label><textarea id="office-request" rows={4} maxLength={6000} value={draft} onChange={event=>changeDraft(event.target.value)} placeholder="For example: Find the three best-selling chains and create a matching carousel for review." disabled={!snapshot.canSend||sending}/>
      <div className={styles.options}><label>Request type<select value={mode} onChange={event=>{setMode(event.target.value as typeof mode);pending.current=null;}} disabled={sending}><option value="auto">Let the office decide</option><option value="chat">Ask a question</option><option value="work">Assign work</option></select></label><label>AI team head<select value={target} onChange={event=>{setTarget(event.target.value);pending.current=null;}} disabled={sending}><option value="">Assign automatically</option>{snapshot.heads.map(head=><option key={head.id} value={head.id}>{head.name}</option>)}</select></label><button className="btn" type="submit" disabled={!draft.trim()||!snapshot.canSend||sending}>{sending?'Assigning…':'Send to office'}<Icon name="arrow" size={16}/></button></div></form>
      <p className={styles.path}>Work path: You → AI team head → specialist → quality review → AI head → human review. Supported image requests enter Design Studio; the team reports any missing product or reference.</p>
      {error&&<p className={styles.error} role="alert">{error}</p>}{!loading&&!snapshot.canSend&&<p className={styles.error}>No enabled AI team head is available for your account.</p>}
    </section>
    <div className={styles.layout}><aside className={`card ${styles.inbox}`} aria-label="Your tasks and conversations"><div className={styles.sectionHead}><h2>Inbox</h2><span>{items.length} recent</span></div>{loading?<p className={styles.muted}>Loading your work…</p>:items.length?<ol>{items.map(item=><li key={`${item.kind}:${item.id}`}><button type="button" className={active?.id===item.id&&active.kind===item.kind?styles.active:''} onClick={()=>setSelected({kind:item.kind,id:item.id,agentId:item.agentId})}><span className={styles.itemTop}><b>{item.title}</b><small>{item.kind==='conversation'?'Chat':'Task'}</small></span><span className={styles.itemMeta}>{names[item.agentId]||item.agentId}<span className={styles.status} data-status={item.status}>{label(item.status)}</span></span></button></li>)}</ol>:<p className={styles.muted}>Your requests and reports will appear here.</p>}</aside>
    <section className={`card ${styles.detail}`} aria-label="Selected work"><div className={styles.sectionHead}><h2>{active?.title||'No task selected'}</h2>{active&&<span className={styles.status} data-status={active.status}>{label(active.status)}</span>}</div>
      {active?.kind==='conversation'&&<><p className={styles.muted}>Assigned to {names[active.agentId]||active.agentId}. Follow the handoffs and final reply below.</p><AgentConversation key={`${active.agentId}:${active.id}`} agentId={active.agentId} agentName={names[active.agentId]||active.agentId} initialThreadId={active.id}/></>}
      {active?.kind==='task'&&active.task&&<TaskReport task={active.task} names={names}/>}
      {!active&&<p className={styles.muted}>Send a request above. The team’s work and report will appear here.</p>}
    </section></div>
  </div>;
}

function TaskReport({task,names}:{task:Work;names:Record<string,string>}) {
  if(!task.brief)return <p className={styles.muted}>Loading this task’s report…</p>;
  const flow=task.state?.headWorkflow,assignments=flow?.plan?.assignments||[];
  return <div className={styles.report}><p className={styles.owner}><b>Responsible AI head</b><span>{names[task.owner_agent]||task.owner_agent}</span></p><p className={styles.brief}>{task.brief}</p>
    {flow?.plan?.understanding&&<section><h3>Head’s understanding</h3><p>{flow.plan.understanding}</p></section>}
    {assignments.length>0&&<section><h3>Assigned to specialists</h3><ol>{assignments.map((assignment,index)=><li key={`${assignment.agentId}:${index}`}><b>{names[assignment.agentId]||assignment.agentId}</b><p>{assignment.task}</p>{assignment.deliverable&&<small>Deliverable: {assignment.deliverable}</small>}</li>)}</ol></section>}
    {task.result?.summary&&<section><h3>Report</h3><p>{task.result.summary}</p>{task.result.markdown&&<div className={styles.output}>{task.result.markdown}</div>}</section>}
    {flow?.review?.note&&<section><h3>AI head review</h3><p>{flow.review.note}</p></section>}
    {(flow?.blockReason||task.error)&&<p className={styles.error}>{flow?.blockReason||task.error}</p>}
    {task.status==='review'&&<p className={styles.muted}>The AI head’s output is ready for your review.</p>}
    <div className={styles.actions}><Link className="btn" href={`/automations?task=${encodeURIComponent(task.id)}`}>Open full task and review<Icon name="arrow" size={15}/></Link>{task.status==='review'&&<Link className="btn ghost" href="/approvals">Approvals</Link>}</div>
  </div>;
}
