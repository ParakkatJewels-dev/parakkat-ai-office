'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { when } from './ui';
import { mergeTextUsageDraft, sameTextUsageSettings as settingsEqual } from './text-usage-form.mjs';
import styles from './TextUsageLimits.module.css';

export type AiBudgetSettings = {
  enabled:boolean;daily_call_limit:number;weekly_call_limit:number;daily_token_limit:number;weekly_token_limit:number;
  max_input_chars:number;max_output_tokens:number;
};
export type AiBudgetSnapshot = {
  settings:AiBudgetSettings;daily:{calls:number;tokens:number};weekly:{calls:number;tokens:number};
  blocked?:boolean;blockedReason?:string|null;nextAvailableAt:string|null;
};
type Props = {budget?:AiBudgetSnapshot|null;managed?:boolean;onSave?:(settings:AiBudgetSettings)=>Promise<unknown>;disabled?:boolean};
const FIELDS=[
  ['daily_call_limit','Calls per day',1,10000,'Maximum text requests in a rolling 24 hours.'],
  ['weekly_call_limit','Calls per week',1,50000,'Maximum text requests in a rolling 7 days.'],
  ['daily_token_limit','Token budget per day',1000,10000000,'Estimated text tokens in a rolling 24 hours.'],
  ['weekly_token_limit','Token budget per week',1000,50000000,'Estimated text tokens in a rolling 7 days.'],
  ['max_output_tokens','Maximum reply tokens',256,8000,'Per-request output ceiling. Allow enough room for a complete answer; this remains active when rolling caps are off.'],
  ['max_input_chars','Maximum prompt characters',1000,100000,'Per-request input ceiling. Oversized requests stop before inference; supplied evidence is never silently cut to fit.'],
] as const;
const format=(n:number)=>Number(n||0).toLocaleString('en-IN');
const messageOf=(error:unknown)=>error instanceof Error?error.message:'The limits could not be saved. Your edits are kept.';

export default function TextUsageLimits({budget,managed=false,onSave,disabled=false}:Props) {
  const [fetched,setFetched]=useState<AiBudgetSnapshot|null>(null),[draft,setDraft]=useState<AiBudgetSettings|null>(null),[baseline,setBaseline]=useState<AiBudgetSettings|null>(null);
  const [loading,setLoading]=useState(!managed),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(''),[changedElsewhere,setChangedElsewhere]=useState(false);
  const id=useId(),alive=useRef(true),inflight=useRef(false),readController=useRef<AbortController|null>(null),prior=useRef<AiBudgetSettings|null>(null),saveLock=useRef(false);
  const current=managed?budget:fetched,settingsKey=JSON.stringify(current?.settings||null);
  const load=useCallback(async()=>{
    if(inflight.current&&!readController.current?.signal.aborted)return;
    inflight.current=true;const controller=new AbortController();readController.current=controller;setLoading(true);
    try {
      const response=await fetch('/api/automations',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data?.aiBudget){
        if((response.status===401||response.status===403)&&alive.current){setFetched(null);setDraft(null);setBaseline(null);prior.current=null;}
        throw new Error(data?.error||'Text usage limits could not be loaded. Refresh to try again.');
      }
      if(alive.current&&!controller.signal.aborted){setFetched(data.aiBudget);setError('');}
    } catch(e){if(alive.current&&!controller.signal.aborted)setError(messageOf(e));}
    finally{if(readController.current===controller)inflight.current=false;if(alive.current&&!controller.signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{alive.current=true;if(!managed)void load();return()=>{alive.current=false;readController.current?.abort();};},[load,managed]);
  useEffect(()=>{
    if(settingsKey==='null')return;
    const incoming=JSON.parse(settingsKey) as AiBudgetSettings,previous=prior.current;
    setDraft(value=>mergeTextUsageDraft(value,previous,incoming));
    if(previous&&!settingsEqual(previous,incoming))setChangedElsewhere(true);
    prior.current={...incoming};setBaseline({...incoming});
  },[settingsKey]);
  const dirty=!!draft&&!settingsEqual(draft,baseline);
  function change(key:keyof AiBudgetSettings,value:number|boolean){setDraft(previous=>previous?{...previous,[key]:value}:previous);setSaved('');}
  async function save(event:FormEvent){
    event.preventDefault();if(!draft||saveLock.current)return;
    const values={enabled:draft.enabled,...Object.fromEntries(FIELDS.map(([key])=>[key,draft[key]]))} as AiBudgetSettings;
    for(const [key,label,min,max] of FIELDS)if(!Number.isSafeInteger(values[key])||values[key]<min||values[key]>max){setError(`${label} must be a whole number from ${format(min)} to ${format(max)}.`);return;}
    if(values.weekly_call_limit<values.daily_call_limit||values.weekly_token_limit<values.daily_token_limit){setError('Weekly limits must be at least as large as daily limits.');return;}
    saveLock.current=true;setSaving(true);setError('');setSaved('');
    try {
      if(onSave)await onSave(values);
      else {
        const response=await fetch('/api/automations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'ai_budget',settings:values}),signal:AbortSignal.timeout(15000)});
        const result=await response.json().catch(()=>null);
        if(!response.ok||!result?.ok)throw new Error(result?.error||'Saving could not be confirmed. Refresh before trying again.');
      }
      if(!alive.current)return;
      prior.current={...values};setBaseline({...values});setDraft({...values});setChangedElsewhere(false);setSaved('Text usage limits saved. They apply to subsequent requests.');
      if(!managed)await load();
    } catch(e){if(alive.current)setError(messageOf(e));}
    finally{saveLock.current=false;if(alive.current)setSaving(false);}
  }
  function useSaved(){if(baseline){setDraft({...baseline});setChangedElsewhere(false);setSaved('');setError('');}}
  return <section id="text-usage-limits" className={`card ${styles.card}`} aria-label="Text usage limits">
    <div className={styles.heading}><div><h2>Text usage limits</h2><p>Monitor AI usage and keep optional daily and weekly caps under your control.</p></div><div className={styles.headingActions}>{current&&<span className={`pill ${current.settings.enabled?'warn':'good'}`}>{current.settings.enabled?'App limits on':'Monitoring · no app caps'}</span>}{!managed&&<button className="btn ghost sm-btn" type="button" onClick={()=>void load()} disabled={loading||saving}><Icon name="sync" size={14}/>Refresh</button>}</div></div>
    <p className={styles.scope}>These counters cover AI Office only. They do not show or reset your shared ChatGPT plan allowance. A task can make several text requests. <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Check ChatGPT usage<Icon name="arrow" size={12}/></a></p>
    <p className={styles.accounting}>Automatic opportunity reviews run at most every four hours and skip unchanged evidence. Saved instructions and deterministic checks help reduce repeated model work.</p>
    {current&&<>
      <div className={styles.counters}><UsageWindow label="Last 24 hours" usage={current.daily} callLimit={current.settings.daily_call_limit} tokenLimit={current.settings.daily_token_limit} enabled={current.settings.enabled}/><UsageWindow label="Last 7 days" usage={current.weekly} callLimit={current.settings.weekly_call_limit} tokenLimit={current.settings.weekly_token_limit} enabled={current.settings.enabled}/></div>
      <p className={styles.accounting}>Estimated tokens include text and vision analysis across the configured providers. Failed requests or requests with an unknown outcome retain a conservative reservation. Image generation is counted separately; its current monitoring or limit status is shown in AI provider settings.</p>
      <p className={styles.accounting}>With app limits enabled, scheduled analysis can use at most half of each rolling call and token allowance, leaving at least half available for human-assigned work. This is a ceiling, not a usage target; the office pause still applies.</p>
      {current.blocked&&<div className={styles.blocked} role="status"><Icon name="clock" size={18}/><div><b>Text requests are waiting for the app budget</b><p>{current.nextAvailableAt?`A small request may become eligible around ${when(current.nextAvailableAt)} IST. Larger requests may need more time.`:'No request is currently eligible under the saved limits.'} Queued work can resume when enough budget is available. ChatGPT’s own limits still apply.</p></div></div>}
    </>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {!draft?<p className={styles.accounting} role="status">{loading?'Loading text usage limits…':'Text usage settings are not available yet.'}</p>:<form className={styles.form} onSubmit={save}>
      <label className={styles.toggle}><input type="checkbox" checked={draft.enabled} onChange={event=>change('enabled',event.target.checked)} disabled={saving||disabled}/><span><b>Enforce daily and weekly limits</b><small>When off, per-request prompt and reply limits still apply.</small></span></label>
      <div className={styles.fields}>{FIELDS.map(([key,label,min,max,help])=><label key={key} className="field" htmlFor={`${id}-${key}`}>{label}<input id={`${id}-${key}`} type="number" inputMode="numeric" min={min} max={max} step={1} required value={draft[key]} onChange={event=>change(key,Number(event.target.value))} disabled={saving||disabled}/><small>{help}</small></label>)}</div>
      {changedElsewhere&&dirty&&<p className={styles.changeNotice}>Saved settings changed while you were editing. Your edits are kept. Use the saved settings or review your changes before saving.</p>}
      {saved&&<p className={`flash ok ${styles.saved}`} role="status">{saved}</p>}
      <div className={styles.actions}><p>Limits use rolling windows, not a midnight reset.</p><button className="btn ghost" type="button" disabled={!dirty||saving||disabled} onClick={useSaved}>Use saved settings</button><button className="btn" type="submit" disabled={!dirty||saving||disabled}>{saving?'Saving…':'Save limits'}</button></div>
    </form>}
  </section>;
}

function UsageWindow({label,usage,callLimit,tokenLimit,enabled}:{label:string;usage:{calls:number;tokens:number};callLimit:number;tokenLimit:number;enabled:boolean}) {
  return <div className={styles.window}><b>{label}</b><dl><div><dt>Text requests</dt><dd>{format(usage.calls)}<span>{enabled?` / ${format(callLimit)}`:' · no app cap'}</span></dd></div><div><dt>Estimated text tokens</dt><dd>{format(usage.tokens)}<span>{enabled?` / ${format(tokenLimit)}`:' · no app cap'}</span></dd></div></dl>{enabled&&<div className={styles.bar} role="meter" aria-label={`${label} text requests`} aria-valuemin={0} aria-valuemax={callLimit} aria-valuenow={Math.min(callLimit,usage.calls)}><i style={{width:`${Math.min(100,Math.max(0,usage.calls/callLimit*100))}%`}}/></div>}</div>;
}
