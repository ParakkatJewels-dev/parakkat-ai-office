'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import styles from './VideoDesk.module.css';

type Job = { id:string; brief:string; source_folder:string; output_name:string; status:string; progress:string|null; worker_id:string|null; project_path:string|null; export_path:string|null; worker_report:string|null; error:string|null; created_at:string; updated_at:string; finished_at:string|null };
type Worker = { connected:boolean; lastSeenAt:string|null };
const statusName:Record<string,string>={queued:'Waiting for editing computer',running:'Editing on editing computer',review:'Export ready for review',failed:'Needs attention',cancelled:'Cancelled'};

export default function VideoDesk() {
  const [jobs,setJobs]=useState<Job[]>([]),[worker,setWorker]=useState<Worker>({connected:false,lastSeenAt:null}),[paused,setPaused]=useState(false),[folder,setFolder]=useState(''),[name,setName]=useState(''),[brief,setBrief]=useState(''),[mediaRootHint,setMediaRootHint]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[loaded,setLoaded]=useState(false);
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
  const state=!loaded?'loading':paused?'paused':active?'editing':worker.connected?'ready':'offline';
  const stateTitle={loading:'Checking editing computer',paused:'Office paused',editing:'Editing in progress',ready:'Ready for a job',offline:'Editing computer offline'}[state];
  const stateDetail={loading:'Looking for the editor…',paused:'Jobs resume when the office is unpaused.',editing:worker.connected?'The editor is working on a video.':'This edit is still marked active, but the computer has stopped reporting.',ready:'Claude is connected and can receive the next edit.',offline:'Open the AI Office worker on the editing computer to receive jobs.'}[state];
  return <div className={`page ${styles.page}`}>
    <header className={styles.header}><div><Link className="back" href="/agents/videoEditor">← Video Editor</Link><h1>Video editing</h1><p>Assign work to the computer running DaVinci Resolve Studio. Footage and exports stay there.</p></div><details className={styles.setup}><summary>Worker setup</summary><div><a className="btn ghost sm-btn" href="/api/video-worker/download">Download Windows worker</a><p>Install once on the editing PC. Keep its private <code>subscription.env</code>; future updates sync between jobs.</p></div></details></header>
    <section className={`${styles.status} ${styles[state]}`} aria-live="polite"><span className={styles.stateDot} aria-hidden="true"/><div className={styles.stateText}><small>EDITING COMPUTER</small><h2>{stateTitle}</h2><p>{stateDetail}</p></div><div className={styles.statusMeta}><span>{queued} waiting</span><small>{worker.lastSeenAt?`Last connected ${new Date(worker.lastSeenAt).toLocaleString()}`:'No connection recorded yet'}</small></div></section>
    {active&&<section className={styles.active} aria-live="polite"><div className={styles.activeHead}><div><small>NOW EDITING</small><h2>{active.output_name}.mp4</h2></div><span className="pill">In progress</span></div><p>{active.brief}</p><div className={styles.activityTrack}><span/></div><strong>{active.progress||'Preparing the edit…'}</strong><small>Updated {new Date(active.updated_at).toLocaleString()} · Source: {active.source_folder}</small></section>}
    <div className={styles.columns}>
    <section className={`card ${styles.card}`}><h2>New edit</h2><form onSubmit={create} className={styles.form}>
      <label>Source folder on editing computer<input required maxLength={240} value={folder} onChange={e=>{setFolder(e.target.value);setError('');requestId.current=null;}} placeholder={mediaRootHint?`${mediaRootHint}\\Test`:'Test'}/><small>{mediaRootHint?<>Enter <code>Test</code> or paste the full path <code>{mediaRootHint}\Test</code>.</>:<>Enter a folder name under the editing computer media root.</>}</small></label>
      <label>Export name<input required maxLength={120} value={name} onChange={e=>{setName(e.target.value);setError('');requestId.current=null;}} placeholder="resort-highlight"/><small>Choose a filename such as <code>resort-highlight</code>. Spaces become dashes; the worker adds the file extension.</small></label>
      <label>Edit brief<textarea required maxLength={6000} rows={5} value={brief} onChange={e=>{setBrief(e.target.value);setError('');requestId.current=null;}} placeholder="Make a 30-second vertical reel. Start with the close-up, remove pauses, keep natural colour and end on the logo shot."/></label>
      <button className="btn" type="submit" disabled={busy||!folder.trim()||!name.trim()||!brief.trim()}>{busy?'Saving…':'Send to editing computer'}</button>
    </form></section>
    {(error||loadError)&&<p className={styles.error} role="alert">{error||loadError}</p>}
    <section className={`card ${styles.card}`}><h2>Queue & recent</h2>{!loaded?<p>Loading…</p>:jobs.length===0?<p>No edits assigned yet.</p>:<ol className={styles.jobs}>{jobs.map(job=><li key={job.id} className={styles.job}>
      <div className={styles.jobHead}><b>{job.output_name}.mp4</b><span className="pill">{statusName[job.status]||job.status}</span></div>
      <p>{job.brief}</p><small>Source: {job.source_folder} · Assigned {new Date(job.created_at).toLocaleString()}</small>
      {job.progress&&<p className={styles.progress}>{job.progress}</p>}
      {job.project_path&&<p><b>Resolve project:</b> {job.project_path}</p>}
      {job.export_path&&<p><b>Export on editing computer:</b> {job.export_path}</p>}
      {job.worker_report&&<details><summary>Editor report</summary><pre className={styles.report}>{job.worker_report}</pre></details>}
      {job.error&&<p className={styles.error}>{job.error}</p>}
      {job.status==='queued'&&<button type="button" className="btn ghost sm-btn" disabled={busy} onClick={()=>void change('cancel',job.id)}>Cancel</button>}
      {job.status==='failed'&&<button type="button" className="btn ghost sm-btn" disabled={busy} onClick={()=>void change('retry',job.id)}>Retry after checking output</button>}
    </li>)}</ol>}</section>
    </div>
  </div>;
}
