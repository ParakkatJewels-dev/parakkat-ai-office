'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import styles from './VideoDesk.module.css';

type Job = { id:string; brief:string; source_folder:string; output_name:string; status:string; progress:string|null; worker_id:string|null; project_path:string|null; export_path:string|null; worker_report:string|null; error:string|null; created_at:string; updated_at:string; finished_at:string|null };
const statusName:Record<string,string>={queued:'Waiting for editing computer',running:'Editing on editing computer',review:'Export ready for review',failed:'Needs attention',cancelled:'Cancelled'};

export default function VideoDesk() {
  const [jobs,setJobs]=useState<Job[]>([]),[folder,setFolder]=useState(''),[name,setName]=useState(''),[brief,setBrief]=useState(''),[mediaRootHint,setMediaRootHint]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[loaded,setLoaded]=useState(false);
  const requestId=useRef<string|null>(null);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch('/api/video-jobs',{cache:'no-store',signal});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(data?.error||'Could not load edits.');
    setJobs(data.jobs||[]);setMediaRootHint(data.mediaRootHint||null);setLoaded(true);
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
  return <div className={`page ${styles.page}`}>
    <header><Link className="back" href="/agents/videoEditor">← Video Editor</Link><h1>Video editing</h1><p>Assign an edit to the computer running DaVinci Resolve Studio. Source files, Resolve projects and exports stay there. The editor supports cuts, basic colour grading, music and timed sound effects. Titles and advanced transitions need more editing tools.</p><a className="btn ghost sm-btn" href="/api/video-worker/download">Download Windows worker update</a><p>Install this update once on the editing PC, keeping its private <code>subscription.env</code> file. The running worker then checks for future code and guide updates automatically between jobs.</p></header>
    <section className={`card ${styles.card}`}><h2>New edit</h2><form onSubmit={create} className={styles.form}>
      <label>Source folder on editing computer<input required maxLength={240} value={folder} onChange={e=>{setFolder(e.target.value);setError('');requestId.current=null;}} placeholder={mediaRootHint?`${mediaRootHint}\\Test`:'Test'}/><small>{mediaRootHint?<>Enter <code>Test</code> or paste the full path <code>{mediaRootHint}\Test</code>.</>:<>Enter a folder name under the editing computer media root.</>}</small></label>
      <label>Export name<input required maxLength={120} value={name} onChange={e=>{setName(e.target.value);setError('');requestId.current=null;}} placeholder="resort-highlight"/><small>Choose a filename such as <code>resort-highlight</code>. Spaces become dashes; the worker adds the file extension.</small></label>
      <label>Edit brief<textarea required maxLength={6000} rows={5} value={brief} onChange={e=>{setBrief(e.target.value);setError('');requestId.current=null;}} placeholder="Make a 30-second vertical reel. Start with the close-up, remove pauses, keep natural colour and end on the logo shot."/></label>
      <button className="btn" type="submit" disabled={busy||!folder.trim()||!name.trim()||!brief.trim()}>{busy?'Saving…':'Send to editing computer'}</button>
    </form></section>
    {(error||loadError)&&<p className={styles.error} role="alert">{error||loadError}</p>}
    <section className={`card ${styles.card}`}><h2>Editing jobs</h2>{!loaded?<p>Loading…</p>:jobs.length===0?<p>No edits assigned yet.</p>:<ol className={styles.jobs}>{jobs.map(job=><li key={job.id} className={styles.job}>
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
  </div>;
}
