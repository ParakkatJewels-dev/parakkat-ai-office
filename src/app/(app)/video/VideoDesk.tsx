'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { PageHead } from '@/components/PageHead';
import { Icon } from '@/components/Icon';
import styles from './VideoDesk.module.css';

type Job = { id:string; brief:string; source_folder:string; output_name:string; status:string; progress:string|null; worker_id:string|null; project_path:string|null; export_path:string|null; worker_report:string|null; error:string|null; created_at:string; updated_at:string; finished_at:string|null };
type Worker = { connected:boolean; lastSeenAt:string|null };
const statusName:Record<string,string>={queued:'Queued',running:'Editing',review:'Ready for review',failed:'Needs attention',cancelled:'Cancelled'};

export default function VideoDesk() {
  const [jobs,setJobs]=useState<Job[]>([]),[worker,setWorker]=useState<Worker>({connected:false,lastSeenAt:null}),[paused,setPaused]=useState(false),[folder,setFolder]=useState(''),[name,setName]=useState(''),[brief,setBrief]=useState(''),[mediaRootHint,setMediaRootHint]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[loaded,setLoaded]=useState(false);
  const [showAll,setShowAll]=useState(false),[openId,setOpenId]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch('/api/video-jobs',{cache:'no-store',signal});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(data?.error||'Could not load edits.');
    setJobs(data.jobs||[]);setWorker(data.worker||{connected:false,lastSeenAt:null});setPaused(!!data.paused);setMediaRootHint(data.mediaRootHint||null);setLoaded(true);
  },[]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{await load(controller.signal);setLoadError('');}catch(e){if(!controller.signal.aborted)setLoadError(e instanceof Error?e.message:'Could not load edits.');}finally{if(!controller.signal.aborted)timer=setTimeout(poll,6000);}};
    void poll();return()=>{controller.abort();clearTimeout(timer);};
  },[load]);
  async function post(body:Record<string,unknown>) {
    const response=await fetch('/api/video-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(data?.error||'Could not save the edit.');
    await load();
  }
  async function create(e:FormEvent) {
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    requestId.current ||= crypto.randomUUID();
    try{await post({action:'create',clientId:requestId.current,sourceFolder:folder,outputName:name,brief});setBrief('');setName('');requestId.current=null;}
    catch(e){setError(e instanceof Error?e.message:'Could not queue the edit.');}
    finally{setBusy(false);}
  }
  async function change(action:'cancel'|'retry',id:string) {
    if(busy)return;setBusy(true);setError('');
    try{await post({action,id});}catch(e){setError(e instanceof Error?e.message:'Could not change this edit.');}finally{setBusy(false);}
  }
  const active=jobs.find(job=>job.status==='running');
  const queued=jobs.filter(job=>job.status==='queued').length;
  // the edit in progress first, then the rest newest first
  const all=active?[active,...jobs.filter(job=>job.id!==active.id)]:jobs;
  const visibleJobs=showAll?all:all.slice(0,8);
  const state=!loaded?'loading':paused?'paused':active?'editing':worker.connected?'ready':'offline';
  const stateTitle={loading:'Checking editing computer',paused:'Office paused',editing:'Editing in progress',ready:'Ready for a job',offline:'Editing computer offline'}[state];
  const stateDetail={loading:'Looking for the editor…',paused:'Jobs resume when the office is unpaused.',editing:worker.connected?'The editor is working on a video.':'This edit is still marked active, but the computer has stopped reporting.',ready:'Claude is connected and can receive the next edit.',offline:'Start the AI Office subscription launcher on Windows. Opening Claude alone does not connect the editor.'}[state];
  const day=(at:string)=>new Date(at).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  return <div className={`page ${styles.page}`}>
    <PageHead title="Video" sub="Send footage to the computer running DaVinci Resolve Studio. Footage and exports stay on that computer."><details className={styles.setup}><summary>Set up the editing computer</summary><div><p>On the editing PC, open Command Prompt in the worker folder and run <code>py -3 update_worker.py</code>, then <code>install-ai-office-autostart.cmd</code> once. A private token file on that PC keeps it updated; it doesn’t need an AI Office login.</p><a className="btn ghost sm-btn" href="/api/video-worker/download">Download ZIP for a new PC</a></div></details></PageHead>
    <section className={styles.strip} data-state={state} aria-live="polite">
      <span className={styles.stateDot} aria-hidden="true"/>
      <b>{stateTitle}</b>
      <span className={styles.stripDetail}>{stateDetail}</span>
      <span className={styles.stripMeta}>{queued} waiting · {worker.lastSeenAt?`last connected ${new Date(worker.lastSeenAt).toLocaleString()}`:'no connection recorded yet'}</span>
    </section>
    {(error||loadError)&&<p className={styles.error} role="alert">{error||loadError}</p>}
    <div className={styles.layout}>
      <section className={`card ${styles.list}`} aria-labelledby="edits-title">
        <div className={styles.listHead}><h2 id="edits-title">Edits</h2><span>{all.length}</span></div>
        {!loaded?<p className={styles.empty}>Loading…</p>:all.length===0?<p className={styles.empty}>No edits yet. Send the first one with the form.</p>:<>
          <ol className={styles.jobs}>{visibleJobs.map(job=>{
            const open=openId===job.id;
            return <li key={job.id} className={open?styles.jobOpen:undefined} data-status={job.status}>
              <button type="button" className={styles.row} aria-expanded={open} onClick={()=>setOpenId(open?null:job.id)}>
                <span className={styles.dot} aria-hidden="true"/>
                <span className={styles.rowMain}><b>{job.output_name}.mp4</b><small title={job.source_folder}>{job.status==='running'?job.progress||'Preparing the edit…':job.source_folder}</small></span>
                <span className={styles.rowWhen}>{day(job.created_at)}</span>
                <span className={styles.jobStatus}>{statusName[job.status]||job.status}</span>
                <Icon name={open?'up':'down'} size={16}/>
              </button>
              {job.status==='running'&&<div className={styles.activityTrack} aria-hidden="true"><span/></div>}
              {open&&<div className={styles.body}>
                <p className={styles.brief}>{job.brief}</p>
                {job.progress&&job.status!=='running'&&<p>{job.progress}</p>}
                <dl className={styles.facts}>
                  <div><dt>Footage folder</dt><dd>{job.source_folder}</dd></div>
                  {job.project_path&&<div><dt>Resolve project</dt><dd>{job.project_path}</dd></div>}
                  {job.export_path&&<div><dt>Export</dt><dd>{job.export_path}</dd></div>}
                  <div><dt>Updated</dt><dd>{new Date(job.updated_at).toLocaleString()}</dd></div>
                </dl>
                {job.worker_report&&<details className={styles.more}><summary>Editor report</summary><pre className={styles.report}>{job.worker_report}</pre></details>}
                {job.error&&<p className={styles.error}>{job.error}</p>}
                {job.status==='queued'&&<button type="button" className="btn ghost sm-btn" disabled={busy} onClick={()=>void change('cancel',job.id)}>Cancel edit</button>}
                {job.status==='failed'&&<button type="button" className="btn ghost sm-btn" disabled={busy} onClick={()=>void change('retry',job.id)}>Retry after checking output</button>}
              </div>}
            </li>;
          })}</ol>
          {all.length>8&&<button type="button" className={styles.showMore} onClick={()=>setShowAll(value=>!value)}>{showAll?'Show fewer':`Show all ${all.length} edits`}</button>}
        </>}
      </section>
      <section className={`card ${styles.compose}`} aria-labelledby="new-edit-title"><h2 id="new-edit-title">New edit</h2><form onSubmit={create} className={styles.form}>
        <label>Footage folder<input required maxLength={240} value={folder} onChange={e=>{setFolder(e.target.value);setError('');requestId.current=null;}} placeholder={mediaRootHint?`${mediaRootHint}\\Test`:'Test'}/></label>
        <label>File name<input required maxLength={120} value={name} onChange={e=>{setName(e.target.value);setError('');requestId.current=null;}} placeholder="resort-highlight"/></label>
        <label>What to make<textarea required maxLength={6000} rows={5} value={brief} onChange={e=>{setBrief(e.target.value);setError('');requestId.current=null;}} placeholder="Make a 30-second vertical reel. Start with the close-up, remove pauses, keep natural colour and end on the logo shot."/></label>
        <button className="btn" type="submit" disabled={busy||!folder.trim()||!name.trim()||!brief.trim()}>{busy?'Saving…':'Send to editing computer'}</button>
      </form></section>
    </div>
  </div>;
}
