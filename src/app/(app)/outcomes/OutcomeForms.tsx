'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import type { MetricConfig, OutcomeExperiment, OutcomeInitiative, OutcomesSnapshot } from '@/lib/outcomes/types';
import { dueInIST, submissionKey } from '../automations/automation-ui.mjs';
import { METRICS, dateTimeIST, optionalNumber, type BenchmarkSuggestion } from './outcomes-ui.mjs';
import styles from './Outcomes.module.css';

export type OutcomeSend=(body:Record<string,unknown>)=>Promise<{ok:boolean;id?:string}>;
export type OutcomeDialog={kind:'manual'}|{kind:'configure';initiative:OutcomeInitiative;benchmark?:BenchmarkSuggestion}|{kind:'experiment'|'note';initiative:OutcomeInitiative}|{kind:'evaluate';experiment:OutcomeExperiment;initiative:OutcomeInitiative};
function requiredNumber(value:FormDataEntryValue|null,options:{integer?:boolean;min?:number;max?:number;label:string}){const number=optionalNumber(value,options);if(number===null)throw new Error(`${options.label} is required.`);return number;}
const messageOf=(error:unknown)=>error instanceof Error?error.message:'This change could not be confirmed. Your draft is kept.';

function useSave(send:OutcomeSend,onSaved:()=>void) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false),request=useRef<{signature:string;id:string}|null>(null);
  async function save(body:Record<string,unknown>) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    request.current=submissionKey(request.current,body,()=>crypto.randomUUID());
    try {await send({...body,requestId:request.current.id});request.current=null;onSaved();}
    catch(e){setError(messageOf(e));}
    finally{lock.current=false;setBusy(false);}
  }
  return {busy,error,setError,save};
}

export default function OutcomeForm({dialog,snapshot,send,onClose,onSaved}:{dialog:OutcomeDialog;snapshot:OutcomesSnapshot;send:OutcomeSend;onClose:()=>void;onSaved:()=>void}) {
  if(dialog.kind==='manual')return <ManualForm snapshot={snapshot} send={send} onClose={onClose} onSaved={onSaved}/>;
  if(dialog.kind==='configure')return <ConfigureForm row={dialog.initiative} benchmark={dialog.benchmark} snapshot={snapshot} send={send} onClose={onClose} onSaved={onSaved}/>;
  if(dialog.kind==='experiment')return <ExperimentForm row={dialog.initiative} send={send} onClose={onClose} onSaved={onSaved}/>;
  if(dialog.kind==='evaluate')return <EvaluationForm experiment={dialog.experiment} row={dialog.initiative} send={send} onClose={onClose} onSaved={onSaved}/>;
  return <NoteForm row={dialog.initiative} send={send} onClose={onClose} onSaved={onSaved}/>;
}

function Modal({title,busy,onClose,children}:{title:string;busy:boolean;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),id=useId();
  useEffect(()=>{const element=ref.current,previous=document.activeElement as HTMLElement|null;element?.showModal();return()=>{element?.close();previous?.focus();};},[]);
  const [dirty,setDirty]=useState(false),[confirmClose,setConfirmClose]=useState(false);
  const requestClose=()=>{if(busy)return;if(dirty)setConfirmClose(true);else onClose();};
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  return <dialog ref={ref} className={styles.modal} aria-labelledby={id} onChangeCapture={()=>setDirty(true)} onClickCapture={event=>{const button=(event.target as HTMLElement).closest?.('[data-close-dialog]');if(button&&dirty){event.preventDefault();event.stopPropagation();requestClose();}}} onCancel={event=>{event.preventDefault();requestClose();}}><header><h2 id={id}>{title}</h2><button type="button" aria-label="Close" disabled={busy} onClick={requestClose}><Icon name="x" size={20}/></button></header>{confirmClose&&<section className={styles.discardNotice} role="alert"><div><b>Keep your changes?</b><p>Your unsaved draft will be lost if you close this window.</p></div><div><button className="btn ghost sm-btn" type="button" disabled={busy} onClick={()=>setConfirmClose(false)}>Keep editing</button><button className="btn sm-btn" type="button" disabled={busy} onClick={onClose}>Discard draft</button></div></section>}{children}</dialog>;
}

function FormEnd({busy,disabled=false,error,onClose,label}:{busy:boolean;disabled?:boolean;error:string;onClose:()=>void;label:string}) {
  return <>{error&&<p className={styles.error} role="alert">{error}</p>}<div className={styles.formActions}><button className="btn ghost" type="button" disabled={busy} data-close-dialog onClick={onClose}>Cancel</button><button className="btn" type="submit" disabled={busy||disabled}>{busy?'Saving…':label}</button></div></>;
}

function ManualForm({snapshot,send,onClose,onSaved}:{snapshot:OutcomesSnapshot;send:OutcomeSend;onClose:()=>void;onSaved:()=>void}) {
  const {busy,error,setError,save}=useSave(send,onSaved),id=useId();
  const [department,setDepartment]=useState(snapshot.departments[0]?.id||'');
  const owners=snapshot.agents.filter(agent=>agent.enabled&&agent.department_id===department);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);try{await save({action:'create_manual',departmentId:department,ownerAgent:String(f.get('owner')||''),title:String(f.get('title')||'').trim(),summary:String(f.get('summary')||'').trim(),dueAt:dueInIST(String(f.get('due')||''))||null,nextReviewAt:dueInIST(String(f.get('review')||''))||null});}catch(e){setError(messageOf(e));}}
  return <Modal title="Track work and its result" busy={busy} onClose={onClose}><form className={styles.form} onSubmit={submit}>
    <p className={styles.note}>Add a name, an owner and a date to check the result. This saves a record; it does not start an agent task.</p>
    <label className="field" htmlFor={`${id}-title`}>Name of the work<input id={`${id}-title`} name="title" required maxLength={180} disabled={busy}/></label>
    <label className="field" htmlFor={`${id}-summary`}>What should happen?<textarea id={`${id}-summary`} name="summary" rows={4} maxLength={2000} disabled={busy} placeholder="For example: more ring purchases this month, measured in Shopify."/></label>
    <div className={styles.formGrid}><label className="field" htmlFor={`${id}-department`}>Department<select id={`${id}-department`} value={department} required disabled={busy} onChange={event=>setDepartment(event.target.value)}>{snapshot.departments.map(dept=><option key={dept.id} value={dept.id}>{dept.name}</option>)}</select></label><label className="field" htmlFor={`${id}-owner`}>Agent responsible<select key={department} id={`${id}-owner`} name="owner" required disabled={busy} defaultValue={owners[0]?.id||''}><option value="" disabled>Choose an owner</option>{owners.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label></div>
    {!owners.length&&<p className={styles.warning}>No enabled agent is available in this department. Enable or assign an owner before saving.</p>}
    <div className={styles.formGrid}><label className="field" htmlFor={`${id}-due`}>When should this go live? · IST<input id={`${id}-due`} name="due" type="datetime-local" disabled={busy}/></label><label className="field" htmlFor={`${id}-review`}>When should we check the result? · IST<input id={`${id}-review`} name="review" type="datetime-local" disabled={busy}/></label></div>
    <FormEnd busy={busy} disabled={!owners.length} error={error} onClose={onClose} label="Save work to track"/>
  </form></Modal>;
}

function ConfigureForm({row,benchmark,snapshot,send,onClose,onSaved}:{row:OutcomeInitiative;benchmark?:BenchmarkSuggestion;snapshot:OutcomesSnapshot;send:OutcomeSend;onClose:()=>void;onSaved:()=>void}) {
  const {busy,error,setError,save}=useSave(send,onSaved),id=useId();
  const config=benchmark?.available?benchmark.settings:row.metric_config,baseline=benchmark?.available?benchmark.baseline:row.baseline;
  const [metric,setMetric]=useState(config?.metric||'');
  const owners=snapshot.agents.filter(agent=>agent.enabled&&agent.department_id===row.department_id);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);try{
    let metricConfig:MetricConfig|null=null;
    if(metric)metricConfig={metric:metric as MetricConfig['metric'],direction:String(f.get('direction')) as MetricConfig['direction'],target:optionalNumber(f.get('target'),{min:0,label:'Target'}),minSample:optionalNumber(f.get('minSample'),{integer:true,min:1,label:'Minimum sample'}),sampleMetric:String(f.get('sampleMetric')) as MetricConfig['sampleMetric'],windowDays:requiredNumber(f.get('windowDays'),{integer:true,min:1,max:90,label:'Observation window'}),maturityHours:requiredNumber(f.get('maturityHours'),{integer:true,min:0,max:720,label:'Conversion maturity'}),maxDataAgeHours:requiredNumber(f.get('maxDataAgeHours'),{integer:true,min:1,max:720,label:'Maximum data age'})};
    await save({action:'configure',id:row.id,revision:row.revision,ownerAgent:String(f.get('owner')||''),dueAt:dueInIST(String(f.get('due')||''))||null,nextReviewAt:dueInIST(String(f.get('review')||''))||null,metricConfig,baseline:{value:optionalNumber(f.get('baselineValue'),{min:0,label:'Baseline'}),at:dueInIST(String(f.get('baselineAt')||''))||null,source:String(f.get('baselineSource')||'').trim()}});
  }catch(e){setError(messageOf(e));}}
  return <Modal title="Set goal and review date" busy={busy} onClose={onClose}><form className={styles.form} onSubmit={submit}>
    <p className={styles.note}>{row.title}. This records who will check the result and how. It does not change your ads.</p>
    {benchmark&&<div className={styles.warning}><b>Review the suggested goal before saving.</b><p>The suggested return on ad spend comes from recent ad data. It does not prove profit or promise the same result next time. Check it before using it as your goal.</p>{row.metric_config&&<p>Saving these prefilled values replaces the current measurement plan. Review each field before adopting them.</p>}</div>}
    <label className="field" htmlFor={`${id}-owner`}>Agent responsible<select id={`${id}-owner`} name="owner" defaultValue={row.owner_agent||''} disabled={busy} required><option value="" disabled>Choose an owner</option>{row.owner_agent&&!owners.some(agent=>agent.id===row.owner_agent)&&<option value={row.owner_agent} disabled>Current owner is unavailable</option>}{owners.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
    <div className={styles.formGrid}><label className="field" htmlFor={`${id}-due`}>When should this go live? · IST<input id={`${id}-due`} name="due" type="datetime-local" defaultValue={dateTimeIST(row.due_at)} disabled={busy}/></label><label className="field" htmlFor={`${id}-review`}>When should we check the result? · IST<input id={`${id}-review`} name="review" type="datetime-local" defaultValue={dateTimeIST(row.next_review_at)} disabled={busy}/></label></div>
    <fieldset className={styles.fieldset}><legend>How will we know it worked?</legend>
      <label className="field" htmlFor={`${id}-metric`}>What to measure<select id={`${id}-metric`} value={metric} onChange={event=>setMetric(event.target.value as typeof metric)} disabled={busy}><option value="">Not configured</option>{METRICS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      {metric&&<><div className={styles.formGrid}><label className="field" htmlFor={`${id}-direction`}>Which result is better?<select id={`${id}-direction`} name="direction" defaultValue={config?.direction||'higher'} disabled={busy}><option value="higher">At least the target</option><option value="lower">At most the target</option></select></label><label className="field" htmlFor={`${id}-target`}>Goal · leave blank if unknown<input id={`${id}-target`} name="target" type="number" min={0} step="any" defaultValue={config?.target??''} disabled={busy}/></label></div>
      <div className={styles.formGrid}><label className="field" htmlFor={`${id}-sampleMetric`}>Count enough<select id={`${id}-sampleMetric`} name="sampleMetric" defaultValue={config?.sampleMetric||'clicks'} disabled={busy}><option value="impressions">Impressions</option><option value="clicks">Clicks</option><option value="purchases">Purchases</option></select></label><label className="field" htmlFor={`${id}-minSample`}>How many before judging? · optional<input id={`${id}-minSample`} name="minSample" type="number" min={1} step={1} defaultValue={config?.minSample??''} disabled={busy}/></label></div>
      <div className={styles.formGrid}><label className="field" htmlFor={`${id}-window`}>Days to include<input id={`${id}-window`} name="windowDays" type="number" min={1} max={90} step={1} required defaultValue={config?.windowDays??7} disabled={busy}/></label><label className="field" htmlFor={`${id}-maturity`}>Wait for late purchases · hours<input id={`${id}-maturity`} name="maturityHours" type="number" min={0} max={720} step={1} required defaultValue={config?.maturityHours??72} disabled={busy}/></label><label className="field" htmlFor={`${id}-age`}>Oldest data to accept · hours<input id={`${id}-age`} name="maxDataAgeHours" type="number" min={1} max={720} step={1} required defaultValue={config?.maxDataAgeHours??48} disabled={busy}/></label></div></>}
      <p className={styles.note}>Leave a number blank if you do not know it. The team will wait for a clear goal and enough data before recommending changes. Ad platform revenue does not prove profit.</p>
    </fieldset>
    <BaselineFields id={id} baseline={baseline} disabled={busy}/>
    <FormEnd busy={busy} error={error} onClose={onClose} label="Save measurement plan"/>
  </form></Modal>;
}

function BaselineFields({id,baseline,disabled}:{id:string;baseline:OutcomeInitiative['baseline'];disabled:boolean}) {
  return <fieldset className={styles.fieldset}><legend>Starting result for comparison</legend><div className={styles.formGrid}><label className="field" htmlFor={`${id}-baselineValue`}>Starting value · optional<input id={`${id}-baselineValue`} name="baselineValue" type="number" min={0} step="any" defaultValue={baseline?.value??''} disabled={disabled}/></label><label className="field" htmlFor={`${id}-baselineAt`}>Date of starting value · IST<input id={`${id}-baselineAt`} name="baselineAt" type="datetime-local" defaultValue={dateTimeIST(baseline?.at)} disabled={disabled}/></label></div><label className="field" htmlFor={`${id}-baselineSource`}>Where did this starting value come from?<input id={`${id}-baselineSource`} name="baselineSource" maxLength={500} defaultValue={baseline?.source||''} placeholder="Source, date range and metric definition" disabled={disabled}/></label></fieldset>;
}

function ExperimentForm({row,send,onClose,onSaved}:{row:OutcomeInitiative;send:OutcomeSend;onClose:()=>void;onSaved:()=>void}) {
  const {busy,error,setError,save}=useSave(send,onSaved),id=useId();
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);try{await save({action:'experiment_create',id:row.id,revision:row.revision,hypothesis:String(f.get('hypothesis')||'').trim(),primaryMetric:String(f.get('metric')),guardrails:String(f.get('guardrails')||'').split('\n').map(line=>line.trim()).filter(Boolean),baseline:{value:optionalNumber(f.get('baselineValue'),{min:0,label:'Baseline'}),at:dueInIST(String(f.get('baselineAt')||''))||null,source:String(f.get('baselineSource')||'').trim()},plannedChange:String(f.get('change')||'').trim(),evaluationAt:dueInIST(String(f.get('evaluation')||''))});}catch(e){setError(messageOf(e));}}
  return <Modal title="Plan a test" busy={busy} onClose={onClose}><form className={styles.form} onSubmit={submit}>
    <p className={styles.note}>{row.title}. Describe the change you want to test and when to check it. Saving the plan does not make the change live.</p>
    <label className="field" htmlFor={`${id}-hypothesis`}>What do you expect to happen?<textarea id={`${id}-hypothesis`} name="hypothesis" rows={3} maxLength={1500} required disabled={busy} placeholder="If we change X for this audience, we expect Y because…"/></label>
    <label className="field" htmlFor={`${id}-change`}>What will change?<textarea id={`${id}-change`} name="change" rows={3} maxLength={2000} required disabled={busy}/></label>
    <div className={styles.formGrid}><label className="field" htmlFor={`${id}-metric`}>Primary metric<select id={`${id}-metric`} name="metric" defaultValue={row.metric_config?.metric||'purchases'} disabled={busy}>{METRICS.map(metric=><option key={metric.id} value={metric.id}>{metric.label}</option>)}</select></label><label className="field" htmlFor={`${id}-evaluation`}>When should we check the result? · IST<input id={`${id}-evaluation`} name="evaluation" type="datetime-local" required disabled={busy}/></label></div>
    <label className="field" htmlFor={`${id}-guardrails`}>Spending or stock limits · optional<textarea id={`${id}-guardrails`} name="guardrails" rows={3} maxLength={1500} disabled={busy} placeholder="Maximum test spend; stock limits; stop conditions; measurement gaps"/></label>
    <BaselineFields id={id} baseline={row.baseline} disabled={busy}/>
    <FormEnd busy={busy} error={error} onClose={onClose} label="Save test plan"/>
  </form></Modal>;
}

function EvaluationForm({experiment,row,send,onClose,onSaved}:{experiment:OutcomeExperiment;row:OutcomeInitiative;send:OutcomeSend;onClose:()=>void;onSaved:()=>void}) {
  const {busy,error,setError,save}=useSave(send,onSaved),id=useId();
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);try{await save({action:'experiment_evaluate',experimentId:experiment.id,revision:experiment.revision,verdict:String(f.get('verdict')),summary:String(f.get('summary')||'').trim(),evidence:[{source:String(f.get('source')||'').trim(),detail:String(f.get('evidence')||'').trim(),...(f.get('observedAt')?{at:dueInIST(String(f.get('observedAt')))}:{})}]});}catch(e){setError(messageOf(e));}}
  return <Modal title="Record the evaluation" busy={busy} onClose={onClose}><form className={styles.form} onSubmit={submit}>
    <p className={styles.note}>{row.title}</p><blockquote className={styles.quote}>{experiment.hypothesis}</blockquote>
    <p className={styles.warning}>A before-and-after comparison is observational. Record conversion delays, missing coverage and other simultaneous changes. A positive result does not approve a budget increase.</p>
    <label className="field" htmlFor={`${id}-verdict`}>Observed result<select id={`${id}-verdict`} name="verdict" defaultValue="inconclusive" disabled={busy}><option value="inconclusive">Inconclusive</option><option value="improved">Improved</option><option value="no_improvement">No improvement</option><option value="harmful">Harmful</option></select></label>
    <label className="field" htmlFor={`${id}-summary`}>Conclusion, limitations and next action<textarea id={`${id}-summary`} name="summary" rows={4} required maxLength={3000} disabled={busy}/></label>
    <label className="field" htmlFor={`${id}-source`}>Evidence source<input id={`${id}-source`} name="source" required maxLength={200} disabled={busy}/></label>
    <label className="field" htmlFor={`${id}-evidence`}>Measured values, comparison window and coverage<textarea id={`${id}-evidence`} name="evidence" rows={4} required maxLength={1500} disabled={busy} placeholder="Include the denominator, baseline/control, current result and material gaps."/></label>
    <label className="field" htmlFor={`${id}-observed`}>Date of starting value · IST<input id={`${id}-observed`} name="observedAt" type="datetime-local" disabled={busy}/></label>
    <FormEnd busy={busy} error={error} onClose={onClose} label="Save evaluation"/>
  </form></Modal>;
}

function NoteForm({row,send,onClose,onSaved}:{row:OutcomeInitiative;send:OutcomeSend;onClose:()=>void;onSaved:()=>void}) {
  const {busy,error,save}=useSave(send,onSaved),id=useId();
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);await save({action:'note',id:row.id,revision:row.revision,note:String(f.get('note')||'').trim()});}
  return <Modal title="Add a follow-through note" busy={busy} onClose={onClose}><form className={styles.form} onSubmit={submit}><p className={styles.note}>{row.title}. Notes do not change approval, execution or measured outcome.</p><label className="field" htmlFor={id}>Update, blocker or next action<textarea id={id} name="note" rows={5} required maxLength={2000} disabled={busy}/></label><FormEnd busy={busy} error={error} onClose={onClose} label="Save note"/></form></Modal>;
}
