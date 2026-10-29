'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, when } from '@/components/ui';
import { Pagination } from '@/components/Pagination';
import { Icon } from '@/components/Icon';
import { ROLE_LABEL } from '@/lib/roles';
import { saveAgentInstructions } from './actions';
import { INSTRUCTION_LIMIT, instructionLength, type InstructionFormState, type InstructionSnapshot } from './instruction-form.mjs';
import styles from './AgentManager.module.css';

type Agent = {id:string;name:string;role_desc:string;department_id:string;is_lead:boolean;enabled:boolean;canEdit:boolean};
type History = {revision:number;instructions:string;updated_at:string};
type EditorStatus = {dirty:boolean;pending:boolean};
type Props = {
  agents:Agent[];departments:{id:string;name:string}[];
  selected:Agent & {departmentName:string;headRole:string;leadName:string | null};
  baseGuidance:string;current:InstructionSnapshot | null;loadError:boolean;
  history:History[];historyError:boolean;
  brand:{voice:string;always:string;never:string;notes:string} | null;brandError:boolean;
  lessons:{id:string;lesson:string;department_id:string;created_at:string}[];lessonsError:boolean;
};

export default function AgentManager(props:Props) {
  const {agents,departments,selected}=props, router=useRouter();
  const [search,setSearch]=useState(''),[department,setDepartment]=useState(''),[page,setPage]=useState(()=>Math.floor(Math.max(0,agents.findIndex(agent=>agent.id===selected.id))/8)+1);
  const pageSize=8;
  const [editorStatus,setEditorStatus]=useState<EditorStatus>({dirty:false,pending:false});
  const [leaveFor,setLeaveFor]=useState<string | null>(null);
  const leaveDialog=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement | null>(null);
  const leaveTitle=useId(),leaveDescription=useId();
  useEffect(()=>{
    if(leaveFor){if(!leaveDialog.current?.open)leaveDialog.current?.showModal();}
    else if(leaveDialog.current?.open)leaveDialog.current.close();
  },[leaveFor]);
  useEffect(()=>{
    if(!editorStatus.dirty&&!editorStatus.pending){setLeaveFor(null);return;}
    const destination=(href:string)=>{
      let url:URL;try{url=new URL(href,window.location.href);}catch{return null;}
      if(url.origin!==window.location.origin || !['http:','https:'].includes(url.protocol))return null;
      if(url.pathname===window.location.pathname&&url.search===window.location.search)return null;
      // Selecting the already-open agent is handled without a navigation by choose().
      if(url.pathname==='/agents/manage'&&url.searchParams.get('agent')===selected.id)return null;
      return `${url.pathname}${url.search}${url.hash}`;
    };
    const request=(href:string)=>{returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setLeaveFor(href);};
    const capture=(event:globalThis.MouseEvent)=>{
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const anchor=event.target instanceof Element?event.target.closest('a[href]'):null;
      if(!(anchor instanceof HTMLAnchorElement)||anchor.hasAttribute('download')||(anchor.target&&anchor.target!=='_self'))return;
      const href=destination(anchor.href);if(!href)return;
      event.preventDefault();event.stopPropagation();request(href);
    };
    const navigation=(event:Event)=>{
      if(!event.cancelable)return;
      const detail=(event as CustomEvent<{href?:unknown}>).detail;
      if(typeof detail?.href!=='string')return;
      const href=destination(detail.href);if(!href)return;
      event.preventDefault();request(href);
    };
    document.addEventListener('click',capture,true);
    window.addEventListener('workspace:navigate',navigation);
    return()=>{document.removeEventListener('click',capture,true);window.removeEventListener('workspace:navigate',navigation);};
  },[editorStatus.dirty,editorStatus.pending,selected.id]);
  const query=search.toLocaleLowerCase().trim();
  const names=Object.fromEntries(departments.map(row=>[row.id,row.name]));
  const visible=agents.filter(agent=>(!department || agent.department_id===department)
    && (!query || [agent.name,agent.role_desc,names[agent.department_id],agent.id].join(' ').toLocaleLowerCase().includes(query)));
  const directoryPage=Math.min(page,Math.max(1,Math.ceil(visible.length/pageSize)));
  const pageAgents=visible.slice((directoryPage-1)*pageSize,directoryPage*pageSize);
  const choose=(event:MouseEvent<HTMLAnchorElement>,id:string)=>{
    if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    if(editorStatus.pending){event.preventDefault();return;}
    if(id===selected.id){event.preventDefault();return;}
    if(editorStatus.dirty){event.preventDefault();returnFocus.current=event.currentTarget;setLeaveFor(`/agents/manage?agent=${encodeURIComponent(id)}#agent-detail`);}
  };
  return <>
    <dialog ref={leaveDialog} className={`confirm-dialog ${styles.leaveDialog}`} aria-labelledby={leaveTitle} aria-describedby={leaveDescription} onCancel={event=>{event.preventDefault();setLeaveFor(null);}} onClose={()=>{setLeaveFor(null);returnFocus.current?.focus();}}>
      <h2 id={leaveTitle}>{editorStatus.pending?'Instructions are saving':'Keep your instructions?'}</h2>
      <p id={leaveDescription}>{editorStatus.pending?'Wait for the save to finish before leaving. Your instructions are still being saved.':'You have an unsaved instruction draft. Keep editing to save it, or discard this draft and leave.'}</p>
      <div className="confirm-actions"><button type="button" autoFocus className="btn ghost" onClick={()=>setLeaveFor(null)}>{editorStatus.pending?'Stay on this page':'Keep editing'}</button>{!editorStatus.pending&&<button type="button" className="btn danger" disabled={!leaveFor} onClick={()=>{if(!leaveFor||editorStatus.pending)return;const href=leaveFor;setLeaveFor(null);router.push(href);}}>Discard and continue</button>}</div>
    </dialog>
    <div className={styles.overview} role="group" aria-label="Agent directory summary"><span><b>{agents.length}</b> AI agents</span><span><b>{agents.filter(agent=>agent.enabled).length}</b> enabled</span><span><b>{agents.filter(agent=>agent.canEdit).length}</b> you can manage</span></div>
    <div className={styles.layout}>
      <section className={`card ${styles.directory}`} aria-label="agents">
        <h2>Find an agent</h2>
        <label className="field" htmlFor="agent-search">Search name or role<input id="agent-search" type="search" className="in" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} placeholder="Search all agents…"/></label>
        <label className="field" htmlFor="agent-department">Department<select id="agent-department" className="in" value={department} onChange={event=>{setDepartment(event.target.value);setPage(1);}}><option value="">All departments</option>{departments.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <p className={styles.count} role="status">{visible.length} agent{visible.length===1?'':'s'} found</p>

        <ul className={styles.agentList}>{pageAgents.map(agent=><li key={agent.id}><Link href={`/agents/manage?agent=${encodeURIComponent(agent.id)}#agent-detail`} scroll={false} onClick={event=>choose(event,agent.id)} aria-current={agent.id===selected.id?'true':undefined} aria-disabled={editorStatus.pending} className={styles.agentLink}>
          <Avatar name={agent.name} dept={agent.department_id} size={32}/><div className={styles.agentText}><b>{agent.name}</b><span>{names[agent.department_id] || agent.department_id}</span><small>{agent.is_lead?'Team lead · ':''}{agent.enabled?'Enabled':'Disabled'}{!agent.canEdit?' · View only':''}</small></div>
        </Link></li>)}</ul>
        <Pagination page={directoryPage} total={visible.length} pageSize={pageSize} onPageChange={setPage} label="agents"/>
        {!visible.length && <p className="sub">No agents match this search.</p>}
      </section>
      <div className={styles.detail} id="agent-detail">
        <section className={`card ${styles.identity}`}>
          <Avatar name={selected.name} dept={selected.department_id} size={40}/>
          <div className="grow"><h2>{selected.name}</h2><p>{selected.role_desc}</p><div className={styles.badges}><span className="pill">{selected.departmentName}</span><span className={`pill ${selected.enabled?'good':''}`}>{selected.enabled?'Enabled':'Disabled'}</span>{selected.is_lead && <span className="pill acc">AI team lead</span>}</div></div>
          <dl className={styles.metadata}><div><dt>Team lead</dt><dd>{selected.is_lead?'Leads this team':selected.leadName || 'Not assigned'}</dd></div><div><dt>Human head</dt><dd>{(ROLE_LABEL as Record<string,string>)[selected.headRole] || selected.headRole}</dd></div></dl>
          <div className={styles.profileLinks}><Link href={`/office?focus=${selected.id}`}><Icon name="map" size={15}/>Find in the office</Link>{selected.canEdit && <Link href={`/agents/${selected.id}`}><Icon name="doc" size={15}/>Agent reports</Link>}</div>
        </section>
        <InstructionEditor key={selected.id} agent={selected} current={props.current} loadError={props.loadError} history={props.history} historyError={props.historyError} onStatus={setEditorStatus}/>
        <section className={`card ${styles.context}`}>
          <h2>Base guidance and context</h2><p className="sub">These rules stay in place. Each workflow also supplies instructions for its current task.</p>
          <details><summary>Role and base rules</summary><p className={styles.pre}>{props.baseGuidance}</p></details>
          <details><summary>Current brand guidance</summary>{props.brandError?<p className="sm">Brand guidance could not be loaded.</p>:props.brand && Object.values(props.brand).some(Boolean)?<dl className={styles.brand}>{([['voice','Voice'],['always','Always'],['never','Never'],['notes','Context']] as const).filter(([field])=>props.brand?.[field]).map(([field,label])=><div key={field}><dt>{label}</dt><dd>{props.brand![field]}</dd></div>)}</dl>:<p className="sm">No brand guidance has been saved yet.</p>}</details>
          <details><summary>Recent department context</summary>{!selected.canEdit?<p className="sm">Department context is visible to its head and the Super Admin.</p>:props.lessonsError?<p className="sm">Department context could not be loaded.</p>:props.lessons.length?<><p className="sm">Recent active lessons visible to you. The agent uses the applicable department and company guidance when it works.</p><ul className={styles.lessons}>{props.lessons.map(lesson=><li key={lesson.id}><p>{lesson.lesson}</p><span className="sm">{names[lesson.department_id] || lesson.department_id} · {when(lesson.created_at)}</span></li>)}</ul></>:<p className="sm">No active lessons are visible for this department yet.</p>}</details>
        </section>
      </div>
    </div>
  </>;
}

function InstructionEditor({agent,current,loadError,history,historyError,onStatus}:{agent:Agent;current:InstructionSnapshot | null;loadError:boolean;history:History[];historyError:boolean;onStatus:(status:EditorStatus)=>void}) {
  const [draft,setDraft]=useState(current?.instructions || ''),[saved,setSaved]=useState(current);
  const [revision,setRevision]=useState(current?.revision || 0),[resolvedConflict,setResolvedConflict]=useState<number | null>(null);
  const [state,formAction,pending]=useActionState(async(previous:InstructionFormState,form:FormData)=>{
    let result:InstructionFormState;
    try { result=await saveAgentInstructions(previous,form); }
    catch { result={status:'error',message:'The save could not be confirmed. Your draft has been kept. Try again.',draft,agentId:agent.id}; }
    setResolvedConflict(null);
    if(result.status==='saved' && result.current){setSaved(result.current);setRevision(result.current.revision);setDraft(result.current.instructions);}
    return result;
  },{status:'idle',message:'',draft:current?.instructions || '',agentId:agent.id} as InstructionFormState);
  const dirty=draft!==(saved?.instructions || ''),length=instructionLength(draft);
  const conflict=state.status==='conflict' && (!state.current || resolvedConflict!==state.current.revision);
  useEffect(()=>{onStatus({dirty,pending});},[dirty,pending,onStatus]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  return <section className={`card ${styles.editor}`}>
    <div className={styles.editorHeading}><div><h2>Additional instructions</h2><p className="sub">Set priorities, preferred formats, or working guidance for this agent.</p></div>{dirty && <span className="pill warn">Unsaved draft</span>}</div>
    {!agent.canEdit?<p className={styles.notice}><Icon name="lock" size={16}/> Additional instructions and their history are visible only to this department’s head and the Super Admin.</p>:loadError?<p className={styles.notice} role="alert">Saved instructions could not be loaded. Refresh this page before editing.</p>:<>
      <form action={formAction}>
        <input type="hidden" name="agent_id" value={agent.id}/><input type="hidden" name="revision" value={revision}/>
        <label className="field" htmlFor="additional-instructions">Instructions for {agent.name}<textarea id="additional-instructions" name="instructions" className={`in ${styles.textarea}`} rows={8} value={draft} onChange={event=>setDraft(event.target.value)} readOnly={pending} aria-describedby="instruction-help instruction-count" placeholder="For example: Prioritize Kerala showroom opportunities. Include source dates, a clear next step, and the decision needed from the head."/></label>
        <div className={styles.editorMeta}><p id="instruction-help">Applies at the next agent step. A step already in progress keeps its current instructions.</p><span id="instruction-count" className={length>INSTRUCTION_LIMIT?styles.overLimit:''}>{length.toLocaleString('en-IN')} / 6,000</span></div>
        <p className="sm">These additions supplement the role, brand guidance, and approval rules. Leave the field empty and save to clear them.</p>
        {state.message && state.status!=='conflict' && (state.status!=='saved' || !dirty) && <p className={`flash ${state.status==='saved'?'ok':''}`} role={state.status==='error'?'alert':'status'}>{state.message}</p>}
        {conflict && <div className={styles.notice} role="alert"><b>Newer instructions were saved.</b><p>{state.message}</p>{state.current && <><details open><summary>Latest saved text · revision {state.current.revision}</summary><p className={styles.pre}>{state.current.instructions || 'No additional instructions.'}</p></details><div className={styles.buttons}><button type="button" className="btn ghost sm-btn" disabled={pending} onClick={()=>{setDraft(state.current!.instructions);setSaved(state.current!);setRevision(state.current!.revision);setResolvedConflict(state.current!.revision);}}>Use latest saved text</button><button type="button" className="btn ghost sm-btn" disabled={pending} onClick={()=>{setSaved(state.current!);setRevision(state.current!.revision);setResolvedConflict(state.current!.revision);}}>Keep my draft for retry</button></div></>}</div>}
        {state.status==='conflict' && !conflict && dirty && <p className="sm">Your draft is ready to save against revision {revision}. Press Save instructions to apply it.</p>}
        <div className={styles.saveRow}><button type="submit" className="btn" disabled={pending || length>INSTRUCTION_LIMIT || (!!conflict && !!state.current) || (!dirty && state.status!=='error' && state.status!=='conflict')} aria-busy={pending}>{pending?<span className="spin" aria-hidden="true"/>:<Icon name="check" size={17}/>}<span>{pending?'Saving…':'Save instructions'}</span></button><button type="button" className="btn ghost" disabled={pending || !draft} onClick={()=>setDraft('')}>Clear text</button><span className="sm">{saved?`Revision ${saved.revision} · ${when(saved.updated_at)}`:'No additional instructions saved'}</span></div>
      </form>
      <details className={styles.history}><summary>Revision history{history.length?` · latest ${history.length}`:''}</summary>{historyError?<p className="sm">Revision history could not be loaded.</p>:history.length?<ol>{history.map(row=><li key={row.revision}><div className={styles.historyHead}><b>Revision {row.revision}</b><time dateTime={row.updated_at}>{when(row.updated_at)}</time><button type="button" className="btn ghost sm-btn" disabled={pending} onClick={()=>setDraft(row.instructions)}>Use as draft</button></div><p className={styles.pre}>{row.instructions || 'Additional instructions cleared.'}</p></li>)}</ol>:<p className="sm">Saved changes will appear here.</p>}</details>
    </>}
  </section>;
}
