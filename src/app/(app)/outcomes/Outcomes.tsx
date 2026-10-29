'use client';

import Link from 'next/link';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { openIncidentInitiativeIds } from '@/lib/outcomes/attention.mjs';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, PageHead, Tile, when } from '@/components/ui';
import { Pagination } from '@/components/Pagination';
import { Icon, type IconName } from '@/components/Icon';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';
import type { CampaignCoverageRow, CampaignRegistryRow, OutcomeEvidence, OutcomeIncident, OutcomeInitiative, OutcomesSnapshot } from '@/lib/outcomes/types';
import OutcomeForm, { type OutcomeDialog, type OutcomeSend } from './OutcomeForms';
import { METRICS, coverageTone, evaluationLabel, initiativeDeadlines, metricReadiness, metricValue, outcomeHref, validTime, qualityStatus, initiativeState, campaignMonitoring, campaignDelivery, benchmarkSuggestion } from './outcomes-ui.mjs';
import { outcomeBrief, campaignStatusLabel } from './outcome-brief.mjs';
import styles from './Outcomes.module.css';

type View='initiatives'|'campaigns'|'experiments'|'quality';
const VIEWS:Array<{id:View;label:string;icon:IconName}>=[{id:'initiatives',label:'Work and results',icon:'trend'},{id:'campaigns',label:'Ad campaigns',icon:'megaphone'},{id:'experiments',label:'Tests and results',icon:'spark'},{id:'quality',label:'Quality checks',icon:'check'}];
const sourceLabel=(kind:string)=>({task:'Agent task',campaign:'AI Office campaign',report:'Team report',provider_campaign:'External campaign',manual:'Manual initiative'} as Record<string,string>)[kind]||'Initiative';
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'This view could not be refreshed. Try again.';
const timeLabel=(value:unknown)=>validTime(value)===null?'Not recorded':`${when(String(value))} IST`;
const deliveryMetric=(delivery:ReturnType<typeof campaignDelivery>,metric:'impressions'|'clicks'|'spend')=>delivery?.recordedDays===0?(metric==='impressions'?'No recorded delivery':'—'):metricValue(delivery?.[metric],metric,delivery?.currency||undefined);

export default function Outcomes({initialView='initiatives',initialInitiative,initialCampaign,initialRole}:{initialView?:string;initialInitiative?:string;initialCampaign?:string;initialRole:AppRole}) {
  const [snapshot,setSnapshot]=useState<OutcomesSnapshot|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState(''),[loadedAt,setLoadedAt]=useState<string|null>(null);
  const [view,setView]=useState<View>(VIEWS.some(item=>item.id===initialView)?initialView as View:'initiatives'),[selectedId,setSelectedId]=useState(initialInitiative||''),[campaignId,setCampaignId]=useState(initialCampaign||'');
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('attention'),[department,setDepartment]=useState('all'),[dialog,setDialog]=useState<OutcomeDialog|null>(null),[sending,setSending]=useState(false),[syncingAds,setSyncingAds]=useState(false),[now,setNow]=useState(Date.now);
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(20);
  const epoch=useRef(0);
  const alive=useRef(true),posting=useRef(false),controller=useRef<AbortController|null>(null),inflight=useRef<Promise<void>|null>(null);
  const load=useCallback(async()=>{
    if(inflight.current&&!controller.current?.signal.aborted)return inflight.current;
    const requestController=new AbortController();controller.current=requestController;setLoading(true);
    const request=(async()=>{
      try {
        const response=await fetch('/api/outcomes',{cache:'no-store',signal:AbortSignal.any([requestController.signal,AbortSignal.timeout(15000)])});
        const body=await response.json().catch(()=>null);
        if(!alive.current||controller.current!==requestController||requestController.signal.aborted)return;
        if(!response.ok||!body){
          if(response.status===401||response.status===403){setSnapshot(null);setDialog(null);setSelectedId('');}
          throw new Error(body?.error||'Outcomes could not be loaded. Refresh to try again.');
        }
        if(!['initiatives','incidents','experiments','campaigns','coverage','departments','agents'].every(key=>Array.isArray(body[key]))||!body.limits||!body.summary)throw new Error('The saved snapshot was incomplete. Refresh to try again.');
        setSnapshot(body);setDialog(previous=>!previous?null:body.role==='viewer'?null:previous.kind==='manual'?previous:body.initiatives.some((row:OutcomeInitiative)=>row.id===previous.initiative.id&&row.can_manage)?previous:null);setError('');setLoadedAt(new Date().toISOString());setNow(Date.now());
      }catch(e){if(alive.current&&controller.current===requestController&&!requestController.signal.aborted)setError(errorMessage(e));}
      finally{if(controller.current===requestController){inflight.current=null;if(alive.current&&!requestController.signal.aborted)setLoading(false);}}
    })();inflight.current=request;return request;
  },[]);
  useEffect(()=>{
    alive.current=true;let stopped=false,timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{if(document.visibilityState==='visible'&&!posting.current)await load();if(!stopped)timer=setTimeout(refresh,30000);};
    const visible=()=>{if(document.visibilityState==='visible'&&!posting.current)void load();};
    void refresh();document.addEventListener('visibilitychange',visible);
    return()=>{stopped=true;alive.current=false;clearTimeout(timer);controller.current?.abort();document.removeEventListener('visibilitychange',visible);};
  },[load]);
  useEffect(()=>{
    let user:string|null|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    const {data:{subscription}}=supabaseBrowser().auth.onAuthStateChange((event:AuthChangeEvent,session:Session|null)=>{
      const next=session?.user.id||null;
      if(user===undefined&&event==='INITIAL_SESSION'&&next){user=next;return;}
      if(user===next&&event!=='SIGNED_OUT')return;
      user=next;epoch.current++;controller.current?.abort();inflight.current=null;
      setSnapshot(null);setDialog(null);setSelectedId('');setCampaignId('');setMessage('');setLoadedAt(null);setLoading(false);
      setError(next?'Refreshing your accessible outcomes…':'Sign in to view outcomes.');
      clearTimeout(timer);if(next)timer=setTimeout(()=>{void load();},0);
    });
    return()=>{clearTimeout(timer);subscription.unsubscribe();};
  },[load]);
  const send:OutcomeSend=async body=>{
    if(posting.current)throw new Error('Wait for the current save to finish.');
    const requestEpoch=epoch.current;
    posting.current=true;setSending(true);setMessage('');
    try {
      const response=await fetch('/api/outcomes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
      const result=await response.json().catch(()=>null);
      if(!alive.current||requestEpoch!==epoch.current)throw new Error('Your sign-in changed. Refresh the current account before making another change.');
      if(response.status===401||response.status===403){setSnapshot(null);setDialog(null);setSelectedId('');}
      if(response.status===409){await load();throw new Error('This record changed. Your draft is kept here. Copy any text you need, close this form, then reopen the current record before saving.');}
      if(!response.ok||!result?.ok)throw new Error(result?.error||'The save could not be confirmed. Refresh before trying again; your draft is kept.');
      if(inflight.current)await inflight.current;
      await load();
      if(!alive.current||requestEpoch!==epoch.current)throw new Error('Your sign-in changed. Refresh the current account before making another change.');
      return result;
    }catch(e){throw e instanceof DOMException&&e.name==='TimeoutError'?new Error('The save timed out. Refresh to check whether it was recorded before retrying. Your draft is kept.'):e;}
    finally{posting.current=false;if(alive.current)setSending(false);}
  };
  const refreshAds=async()=>{
    if(posting.current)return;
    posting.current=true;setSyncingAds(true);setMessage('');
    try{
      const response=await fetch('/api/outcomes/refresh-ads',{method:'POST',signal:AbortSignal.timeout(280000)});
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.ok)throw new Error(result?.error||'Ad accounts could not be refreshed.');
      await load();
      setMessage(`Ad accounts checked. ${Object.entries(result.results||{}).map(([name,status])=>`${name}: ${status}`).join(' · ')}${result.reviewPending?' · The campaign summaries are still updating; refresh this view shortly.':''}`);
    }catch(e){setError(errorMessage(e));}
    finally{posting.current=false;setSyncingAds(false);}
  };
  function chooseView(next:View){setView(next);setSearch('');setPage(1);const url=new URL(window.location.href);url.searchParams.set('view',next);window.history.replaceState(null,'',url);}
  function chooseInitiative(id:string){setSelectedId(id);setView('initiatives');const url=new URL(window.location.href);url.searchParams.set('initiative',id);url.searchParams.set('view','initiatives');url.searchParams.delete('campaign');window.history.replaceState(null,'',url);}
  const role=snapshot?.role||initialRole,names=Object.fromEntries((snapshot?.agents||[]).map(agent=>[agent.id,agent.name])),departments=Object.fromEntries((snapshot?.departments||[]).map(dept=>[dept.id,dept.name]));
  const initiatives=snapshot?.initiatives||[],selected=initiatives.find(row=>row.id===selectedId)||null;
  const attentionIds=openIncidentInitiativeIds(initiatives,snapshot?.incidents||[]);
  const shown=initiatives.filter(row=>(department==='all'||row.department_id===department)&&(filter==='all'||filter==='attention'&&attentionIds.has(row.id)||filter==='human'&&row.approval_state==='awaiting_human'||filter==='execution'&&row.approval_state==='approved'&&row.execution_state!=='provider_confirmed'||filter==='review'&&initiativeDeadlines(row,now).reviewDue)&&(!search.trim()||`${row.title} ${row.summary} ${names[row.owner_agent||'']||''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const boardPage=Math.min(page,Math.max(1,Math.ceil(shown.length/pageSize)));
  const pageInitiatives=shown.slice((boardPage-1)*pageSize,boardPage*pageSize);
  useEffect(()=>{if(selectedId&&window.innerWidth<1100)document.getElementById?.('selected-outcome')?.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},[selectedId]);
  const summary=snapshot?.summary;
  return <div className={`page ${styles.page}`}>
    <PageHead title="Outcomes" sub="See what needs attention, what happened, and what to do next."><button className="btn ghost" type="button" disabled={loading||sending||syncingAds} onClick={()=>void load()}><Icon name="sync" size={16}/>Refresh view</button>{view==='campaigns'&&snapshot&&<button className="btn ghost" type="button" disabled={syncingAds||sending} onClick={()=>void refreshAds()}><Icon name="sync" size={16}/>{syncingAds?'Checking ad accounts…':'Update ad results'}</button>}{snapshot&&role!=='viewer'&&snapshot.departments.length>0&&<button className="btn" type="button" disabled={sending||syncingAds} onClick={()=>setDialog({kind:'manual'})}><Icon name="plus" size={16}/>Track new work</button>}</PageHead>
    {snapshot?.paused&&<div className={styles.notice} role="status"><Icon name="pause" size={18}/><div><b>The office is paused.</b><p>You can configure plans and review saved evidence. Agent work and scheduled monitoring wait for the office to resume.</p></div></div>}
    {error&&<div className={styles.error} role="alert">{error}{snapshot&&' The last successfully loaded data is shown.'}</div>}
    {message&&<div className={`flash ok ${styles.message}`} role="status">{message}<button type="button" aria-label="Dismiss confirmation" onClick={()=>setMessage('')}><Icon name="x" size={15}/></button></div>}
    {summary&&<section className="tiles" aria-label="What needs attention"><Tile icon="check" label="Waiting for your decision" value={summary.awaiting_human} sub="Open the original approval to decide"/><Tile icon="clock" tone="amber" label="Approved, launch unconfirmed" value={summary.approved_not_executed} sub="Check whether the change went live"/><Tile icon="bell" tone="rose" label="Needs attention" value={summary.needs_attention} sub="Open issues need a follow-up"/><Tile icon="trend" tone="blue" label="Results to review" value={summary.due_reviews} sub="The planned review date has arrived"/></section>}
    <div className={styles.toolbar}><nav className={styles.tabs} aria-label="Outcome views">{VIEWS.map(item=><button key={item.id} type="button" aria-pressed={view===item.id} onClick={()=>chooseView(item.id)}><Icon name={item.icon} size={17}/>{item.label}</button>)}</nav><small>{loadedAt?`Board updated ${timeLabel(loadedAt)}`:'Loading saved records…'}</small></div>
    {snapshot&&<details className={styles.refreshInfo}><summary><Icon name="clock" size={14}/>When was this checked?</summary><p className={styles.note}>Saved results are normally checked at most every five minutes. New work or fresh ad data can start an earlier check.{snapshot.monitoring?.lastRefreshedAt&&` Last check: ${timeLabel(snapshot.monitoring.lastRefreshedAt)}.`}</p></details>}
    {loading&&!snapshot?<Empty title="Loading outcomes…" text="Reading saved initiatives, coverage and reviews."/>:!snapshot?<Empty title="Outcomes are unavailable" text="Refresh this page to retry. No result has been inferred from the missing data."/>:<>
      {snapshot.monitoring?.limited&&<p className={styles.warning}>Some older records may be missing from this view. Refresh or check the source before deciding that work is complete.</p>}
      {view==='initiatives'?<>
        <div className={styles.filters}><label className={styles.search}><Icon name="search" size={16}/><input type="search" aria-label="Search initiatives" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} placeholder="Find work or an owner…"/></label><label>Show<select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="attention">Needs attention</option><option value="human">Waiting for your decision</option><option value="execution">Approved, launch unconfirmed</option><option value="review">Results to review</option><option value="all">All work</option></select></label><label>Team<select value={department} onChange={event=>{setDepartment(event.target.value);setPage(1);}}><option value="all">All teams I can see</option>{snapshot.departments.map(dept=><option key={dept.id} value={dept.id}>{dept.name}</option>)}</select></label></div>
        <div className={styles.boardLayout}><section className={`card ${styles.board}`} aria-label="Initiative board"><div className={styles.sectionHead}><div><h2>{filter==='attention'?'Work that needs attention':'Tracked work'}</h2><p>{filter==='attention'?'Start here. Switch to All work to see the full history.':'Choose a record to see its next step.'}</p></div><small>{shown.length} shown</small></div>
          {shown.length?<div className={styles.initiativeList}>{pageInitiatives.map(row=><InitiativeCard key={row.id} row={row} names={names} department={departments[row.department_id]} selected={row.id===selectedId} now={now} onSelect={()=>chooseInitiative(row.id)}/>)}</div>:<Empty title={search?'No matching work':'Nothing needs attention in this view'} text={search?'Try a different name or filter.':'Choose All work to see saved campaigns and past tasks.'}/>}
          <Pagination label="Initiatives" page={boardPage} total={shown.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1);}}/>
          {initiatives.length>=snapshot.limits.initiatives&&<p className={styles.note}>Showing up to {snapshot.limits.initiatives} recent initiatives. Older records may be outside this snapshot.</p>}
        </section>{selected?<InitiativeDetail row={selected} snapshot={snapshot} names={names} departments={departments} now={now} busy={sending} onDialog={setDialog} onViewExperiments={()=>chooseView('experiments')}/>:<section className={`card ${styles.detailEmpty}`}><Icon name="trend" size={28}/><h2>{selectedId?'This work is not in the current view':'Choose a piece of work'}</h2><p>{selectedId?'Refresh or choose work you can access.':'You will see what is happening, what we know, and the next step.'}</p></section>}</div>
      </>:view==='campaigns'?<CampaignHealth snapshot={snapshot} names={names} campaignId={campaignId} onCampaign={id=>{setCampaignId(id);const url=new URL(window.location.href);url.searchParams.set('campaign',id);url.searchParams.set('view','campaigns');window.history.replaceState(null,'',url);}} onInitiative={chooseInitiative}/>:view==='experiments'?<Experiments snapshot={snapshot} names={names} onInitiative={chooseInitiative} onDialog={setDialog} busy={sending}/>:<QualityInbox snapshot={snapshot} names={names} onInitiative={chooseInitiative}/>}
    </>}
    {dialog&&snapshot&&<OutcomeForm dialog={dialog} snapshot={snapshot} send={send} onClose={()=>setDialog(null)} onSaved={()=>{setDialog(null);setMessage('Saved. Source approvals and provider settings are unchanged.');}}/>}
  </div>;
}

function Empty({title,text}:{title:string;text:string}) {return <div className={styles.empty}><Icon name="doc" size={25}/><h2>{title}</h2><p>{text}</p></div>;}

function StatusStrip({row}:{row:OutcomeInitiative}) {
  return <dl className={styles.statusStrip}>{(['approval','execution','outcome'] as const).map(kind=>{const state=initiativeState(row,kind);return <div key={kind}><dt>{state.title}</dt><dd><span className={`pill ${state.tone}`}>{state.label}</span></dd></div>;})}</dl>;
}

function InitiativeCard({row,names,department,selected,now,onSelect}:{row:OutcomeInitiative;names:Record<string,string>;department?:string;selected:boolean;now:number;onSelect:()=>void}) {
  const dates=initiativeDeadlines(row,now),brief=outcomeBrief(row);
  return <article className={`${styles.initiativeCard} ${selected?styles.selected:''}`}><button type="button" className={styles.initiativeSelect} aria-pressed={selected} onClick={onSelect}><span className={styles.cardEyebrow}>{sourceLabel(row.source_kind)} · {department||row.department_id}</span><h3>{row.title}</h3><Icon name="arrow" size={16}/></button><p className={styles.cardBrief}>{brief.headline}</p><div className={styles.cardFoot}><span><Avatar name={names[row.owner_agent||'']||'Unassigned'} dept={row.department_id} size={23}/>{names[row.owner_agent||'']||'Owner not assigned'}</span><small className={dates.overdue||dates.reviewDue?styles.due:''}>{dates.overdue?'Launch check overdue':dates.reviewDue?'Review due':row.next_review_at?`Review ${timeLabel(row.next_review_at)}`:'No review date'}</small></div></article>;
}

function Evidence({items,label='Recorded evidence'}:{items:OutcomeEvidence[];label?:string}) {
  if(!items?.length)return <p className={styles.note}>No supporting evidence is recorded here.</p>;
  return <details className={styles.evidence}><summary>{label} · {items.length}</summary><ul>{items.map((entry,index)=><li key={`${entry.source}-${index}`}><b>{entry.source}</b><p>{entry.detail}</p>{entry.at&&<small>{timeLabel(entry.at)}</small>}</li>)}</ul></details>;
}

function InitiativeDetail({row,snapshot,names,departments,now,busy,onDialog,onViewExperiments}:{row:OutcomeInitiative;snapshot:OutcomesSnapshot;names:Record<string,string>;departments:Record<string,string>;now:number;busy:boolean;onDialog:(dialog:OutcomeDialog)=>void;onViewExperiments:()=>void}) {
  const dates=initiativeDeadlines(row,now),metric=row.metric_config,readiness=metricReadiness(metric),inventoryOnly=row.source_kind==='provider_campaign'&&campaignMonitoring(row.observation).mode==='inventory_only',source=outcomeHref(row.source_url,{internal:true}),brief=outcomeBrief(row);
  const incidents=snapshot.incidents.filter(incident=>incident.initiative_id===row.id),experiments=snapshot.experiments.filter(experiment=>experiment.initiative_id===row.id);
  const human=snapshot.departments.find(dept=>dept.id===row.department_id)?.human_head_role;
  return <section className={`card ${styles.detail}`} id="selected-outcome" aria-label="Selected initiative"><div className={styles.cardEyebrow}>{sourceLabel(row.source_kind)} · {departments[row.department_id]||row.department_id}</div><h2>{row.title}</h2>
    <section className={styles.plainBrief} aria-label="In plain language"><span className={`pill ${brief.tone}`}>At a glance</span><h3>{brief.headline}</h3><p>{brief.explanation}</p><p><b>What to do next:</b> {brief.next}</p><small>Owner: {names[row.owner_agent||'']||'Not assigned'}{row.next_review_at?` · Review ${timeLabel(row.next_review_at)}`:''}</small></section>
    {row.source_kind==='provider_campaign'&&<DeliveryResults row={row}/>}
    <div className={styles.actions}>{source&&<Link className="btn ghost" href={source}><Icon name="doc" size={15}/>{row.source_kind==='provider_campaign'?'Open campaign':'Open original work'}</Link>}{row.can_manage&&<><button className="btn" type="button" disabled={busy} onClick={()=>onDialog({kind:'configure',initiative:row})}><Icon name="edit" size={15}/>Set goal and review date</button><button className="btn ghost" type="button" disabled={busy} onClick={()=>onDialog({kind:'note',initiative:row})}>Add update</button></>}</div>
    <details className={styles.moreDetail}><summary>Progress and original notes</summary><StatusStrip row={row}/>{row.summary&&<p className={styles.summary}>{row.summary}</p>}
    <dl className={styles.facts}><div><dt>Agent responsible</dt><dd>{names[row.owner_agent||'']||'Not assigned'}</dd></div><div><dt>Person responsible</dt><dd>{human?ROLE_LABEL[human as AppRole]||human:'Not recorded'}</dd></div><div><dt>Launch deadline</dt><dd className={dates.overdue?styles.due:''}>{row.due_at?timeLabel(row.due_at):'Not set'}</dd></div><div><dt>Next review</dt><dd className={dates.reviewDue?styles.due:''}>{row.next_review_at?timeLabel(row.next_review_at):'Not set'}</dd></div><div><dt>Source last checked</dt><dd>{timeLabel(row.last_observed_at)}</dd></div><div><dt>Record version</dt><dd>{row.revision}</dd></div></dl></details>
    <details className={styles.moreDetail}><summary>Numbers, checks and supporting evidence</summary><div className={styles.technicalContent}>
    <p className={styles.note}>{row.source_kind==='provider_campaign'?'This campaign was found in an ad account; that alone does not mean AI Office launched it.':'Approval and launch status come from the original workflow.'} This page does not change ads or spending.</p>
    {row.source_kind==='provider_campaign'&&<CampaignMonitoring row={row}/>}
    {row.warnings?.length>0&&<div className={styles.warning}><b>Evidence and coverage limits</b><ul>{row.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
    <section className={styles.measurement}><div className={styles.sectionHead}><h3>Measurement plan</h3><span className={`pill ${readiness.ready?'acc':inventoryOnly?'':'warn'}`}>{readiness.ready?'Thresholds configured':inventoryOnly?'Optional for inactive inventory':'Needs configuration'}</span></div>{!readiness.ready&&<p className={styles.note}>{inventoryOnly?'Add a measurement plan or review date to include this campaign in outcome monitoring.':`Still needed: ${readiness.missing.join(', ')}. Unknown thresholds block dependent recommendations.`}</p>}
      <dl className={styles.facts}><div><dt>Primary metric</dt><dd>{METRICS.find(item=>item.id===metric?.metric)?.label||'Not set'}</dd></div><div><dt>Target</dt><dd>{metric?.target!=null?`${metric.direction==='higher'?'At least':'At most'} ${metricValue(metric.target,metric.metric)}`:'Not set'}</dd></div><div><dt>Minimum sample</dt><dd>{metric?.minSample!=null?`${metric.minSample.toLocaleString('en-IN')} ${metric.sampleMetric}`:'Not set'}</dd></div><div><dt>Observation window</dt><dd>{metric?`${metric.windowDays} days`:'Not set'}</dd></div><div><dt>Conversion maturity</dt><dd>{metric?`${metric.maturityHours} hours`:'Not set'}</dd></div><div><dt>Maximum data age</dt><dd>{metric?`${metric.maxDataAgeHours} hours`:'Not set'}</dd></div><div><dt>Baseline</dt><dd>{metricValue(row.baseline?.value,metric?.metric)}</dd></div><div><dt>Baseline observed</dt><dd>{timeLabel(row.baseline?.at)}</dd></div></dl>{row.baseline?.source&&<p className={styles.note}>Baseline source: {row.baseline.source}</p>}
    </section>
    <BenchmarkProposal row={row} busy={busy} onDialog={onDialog}/>
    {!inventoryOnly&&<Observation row={row}/>}
    <Evidence items={row.evidence}/>
    </div></details>
    {incidents.some(incident=>incident.status!=='resolved'&&incident.severity==='critical')&&<p className={styles.warning}>An urgent issue is recorded for this work. Open follow-ups and checks to read it before deciding.</p>}
    <details className={styles.moreDetail}><summary>Follow-ups and checks{incidents.length?` · ${incidents.length} issue${incidents.length===1?'':'s'}`:''}</summary>
      {incidents.length>0&&<section className={styles.subsection}><h3>Issues to check · {incidents.length}</h3>{incidents.map(incident=><Incident key={incident.id} row={incident}/>)}</section>}
      <section className={styles.subsection}><div className={styles.sectionHead}><h3>Tests · {experiments.length}</h3>{row.can_manage&&<button className="btn ghost sm-btn" type="button" disabled={busy} onClick={()=>onDialog({kind:'experiment',initiative:row})}><Icon name="plus" size={14}/>Plan a test</button>}</div>{experiments.length?<><ul className={styles.compactList}>{experiments.map(experiment=><li key={experiment.id}><b>{experiment.hypothesis}</b><span>{evaluationLabel(experiment.verdict||'')} · check {timeLabel(experiment.evaluation_at)}</span></li>)}</ul><button className="btn ghost sm-btn" type="button" onClick={onViewExperiments}>See test history<Icon name="arrow" size={14}/></button></>:<p className={styles.note}>No test is recorded yet.</p>}</section>
      <QualityReview row={row} names={names}/>
      {row.notes?.length>0&&<section className={styles.subsection}><h3>Saved updates</h3><ol className={styles.notes}>{row.notes.map((note,index)=><li key={`${note.at}-${index}`}><p>{note.text}</p><small>{timeLabel(note.at)}</small></li>)}</ol></section>}
    </details>
  </section>;
}

function Incident({row}:{row:OutcomeIncident}) {
  return <article className={styles.incident}><div><b>{row.title}</b><span className={`pill ${row.status==='resolved'?'':row.severity==='critical'?'bad':'warn'}`}>{row.status==='resolved'?'Resolved':row.severity}</span></div><p>{row.detail}</p><small>Last seen {timeLabel(row.last_seen_at)}</small><Evidence items={row.evidence}/></article>;
}

function BenchmarkProposal({row,busy,onDialog}:{row:OutcomeInitiative;busy:boolean;onDialog:(dialog:OutcomeDialog)=>void}) {
  const proposal=benchmarkSuggestion(row.observation);
  if(!proposal)return null;
  return <section className={styles.measurement}><div className={styles.sectionHead}><h3>Recent-data benchmark</h3><span className={`pill ${proposal.available?'acc':''}`}>{proposal.available?'Ready for your review':'Not enough usable evidence'}</span></div><p className={styles.note}>A proposed target can match recent attributed ROAS. It does not establish profit, causal improvement or permission to scale spend.</p>{proposal.available&&<p><b>Suggested benchmark: {metricValue(proposal.target,'roas')}</b> · match recent performance</p>}<div className={styles.formGrid}>{([['Recent mature window',proposal.recent],['Previous mature window',proposal.previous]] as const).map(([label,period])=><div key={label}><h4>{label}</h4><dl className={styles.facts}><div><dt>Reporting dates</dt><dd>{typeof period?.from==='string'&&typeof period?.to==='string'?`${period.from} to ${period.to}`:'Not recorded'}</dd></div><div><dt>Attributed ROAS</dt><dd>{metricValue(period?.value,'roas')}</dd></div><div><dt>Purchases</dt><dd>{metricValue(period?.purchases,'purchases')}</dd></div><div><dt>Delivery days</dt><dd>{metricValue(period?.deliveryDays)}</dd></div><div><dt>Spend</dt><dd>{metricValue(period?.spend,'spend',typeof row.observation.currency==='string'?row.observation.currency:undefined)}</dd></div><div><dt>Attributed revenue</dt><dd>{metricValue(period?.revenue,'revenue',typeof row.observation.currency==='string'?row.observation.currency:undefined)}</dd></div></dl></div>)}</div><p className={styles.note}>Descriptive data only. The minimum sample and delivery-day requirements are operational safeguards, not statistical confidence. Review attribution, conversion delays and business costs separately.</p>{proposal.reasons.length>0&&<ul>{proposal.reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>}{proposal.warnings.length>0&&<ul className={styles.note}>{proposal.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}{proposal.available&&row.can_manage&&<button className="btn ghost" type="button" disabled={busy} onClick={()=>onDialog({kind:'configure',initiative:row,benchmark:proposal})}>Review suggested benchmark<Icon name="arrow" size={15}/></button>}</section>;
}

function CampaignMonitoring({row}:{row:OutcomeInitiative}) {
  const state=campaignMonitoring(row.observation);
  return <section className={styles.measurement}><div className={styles.sectionHead}><h3>Monitoring scope</h3><span className={`pill ${state.mode==='scope_unknown'?'warn':''}`}>{state.label}</span></div><p className={styles.note}>{state.detail}</p><dl className={styles.facts}><div><dt>Recent delivery recorded</dt><dd>{state.recentDeliveryAt||'Not established in this snapshot'}</dd></div><div><dt>Activity window</dt><dd>{state.windowLabel}</dd></div><div><dt>Activity coverage</dt><dd>{state.complete===true?'Complete for the checked window':state.complete===false?'Incomplete':'Not recorded'}</dd></div></dl></section>;
}

function DeliveryResults({row}:{row:OutcomeInitiative}) {
  const result=campaignDelivery(row.observation);
  if(!result)return <section className={styles.measurement}><h3>Recent ad results</h3><p className={styles.note}>Impressions, clicks and spend are unavailable for this campaign. Check the connected account and its reporting coverage.</p></section>;
  return <section className={styles.measurement} aria-label="Recent ad results"><div className={styles.sectionHead}><h3>Recent ad results</h3><span className="pill">Last 7 complete days</span></div><dl className={styles.deliveryStats}><div><dt>Impressions</dt><dd>{metricValue(result.impressions,'impressions')}</dd></div><div><dt>Clicks</dt><dd>{metricValue(result.clicks,'clicks')}</dd></div><div><dt>Spend</dt><dd>{metricValue(result.spend,'spend',result.currency||undefined)}</dd></div></dl><p className={styles.note}>{result.from} to {result.to} · {result.timezone||'Account timezone unavailable'} · Last synced {timeLabel(result.lastSyncedAt)}. These are saved platform figures through the last complete reporting day, not a live feed. {result.recordedDays===0?'No daily result rows were recorded for this period.':''}</p></section>;
}

function Observation({row}:{row:OutcomeInitiative}) {
  const observation=row.observation||{},metric=typeof observation.metric==='string'?observation.metric:row.metric_config?.metric;
  const period=observation.period&&typeof observation.period==='object'?observation.period as Record<string,unknown>:null;
  const currency=typeof observation.currency==='string'?observation.currency:undefined;
  const hasValue=typeof observation.value==='number'&&Number.isFinite(observation.value);
  return <section className={styles.measurement}><div className={styles.sectionHead}><h3>Latest saved measurement</h3><span className="pill">{observation.measurement==='provider_attributed'?'Provider attributed':'Recorded observation'}</span></div><dl className={styles.facts}><div><dt>{METRICS.find(item=>item.id===metric)?.label||'Primary metric'}</dt><dd>{metricValue(observation.value,metric,currency)}</dd></div><div><dt>Observed sample</dt><dd>{metricValue(observation.sample)}{typeof observation.sample==='number'&&typeof observation.sampleMetric==='string'?` ${observation.sampleMetric}`:''}</dd></div><div><dt>Comparison window</dt><dd>{typeof period?.from==='string'&&typeof period?.to==='string'?`${period.from} to ${period.to}`:'Not recorded'}</dd></div><div><dt>Account timezone</dt><dd>{typeof period?.timezone==='string'?period.timezone:'Not recorded'}</dd></div></dl><p className={styles.note}>{hasValue?'Interpret this result alongside its sample, source coverage and maturity window. Provider attribution does not establish profit or causation.':'No finite result is available in this snapshot. Missing measurements are not zero; check the evidence and coverage limits.'}</p></section>;
}

function CoverageCard({row}:{row:CampaignCoverageRow}) {
  return <article className={styles.coverageCard}><header><b>{row.provider==='meta'?'Meta':'Google Ads'} · {row.account_id}</b><span className={`pill ${coverageTone(row.status==='complete'&&!row.complete?'partial':row.status)}`}>{row.status==='complete'&&row.complete?'Complete inventory':row.status==='partial'?'Partial inventory':row.status==='failed'?'Refresh failed':row.status==='unsupported'?'Unsupported':'Not refreshed'}</span></header><dl><div><dt>Selected</dt><dd>{row.selected?'Yes':'No'}</dd></div><div><dt>Observed campaigns</dt><dd>{row.observed_count.toLocaleString('en-IN')}</dd></div><div><dt>Last successful refresh</dt><dd>{timeLabel(row.last_success_at)}</dd></div></dl>{row.safe_message&&<p>{row.safe_message}</p>}{!row.complete&&<small>An incomplete or empty import does not prove that no campaigns are running.</small>}</article>;
}

function CampaignHealth({snapshot,names,campaignId,onCampaign,onInitiative}:{snapshot:OutcomesSnapshot;names:Record<string,string>;campaignId:string;onCampaign:(id:string)=>void;onInitiative:(id:string)=>void}) {
  const [search,setSearch]=useState(''),[provider,setProvider]=useState('all'),[statusFilter,setStatusFilter]=useState('on'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(20);
  const rows=snapshot.campaigns.filter(row=>(provider==='all'||row.provider===provider)&&(statusFilter==='all'||statusFilter==='on'&&['On','Limited delivery'].includes(campaignStatusLabel(row.effective_status))||statusFilter==='paused'&&campaignStatusLabel(row.effective_status)==='Paused'||statusFilter==='removed'&&campaignStatusLabel(row.effective_status)==='Removed')&&(!search.trim()||`${row.name} ${row.campaign_id} ${row.account_id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))),focused=snapshot.campaigns.find(row=>row.id===campaignId);
  const currentPage=Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize))),pageCampaigns=rows.slice((currentPage-1)*pageSize,currentPage*pageSize);
  useEffect(()=>{if(campaignId)document.getElementById?.(`campaign-${campaignId}`)?.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},[campaignId]);
  return <>
    <div className={styles.notice}><Icon name="eye" size={18}/><div><b>Ads found in your connected accounts</b><p>Start with ads marked on. Their status does not tell us whether they ran today or made sales. This page only reads data; it does not change ads or spending.</p></div></div>
    <details className={styles.moreDetail}><summary>Connected ad accounts and last check</summary><section aria-label="Account import coverage">{snapshot.coverage.length?<div className={styles.coverageGrid}>{snapshot.coverage.map(row=><CoverageCard key={`${row.provider}:${row.account_id}`} row={row}/>)}</div>:<Empty title="No account data yet" text="We cannot tell which campaigns are in these accounts until they are checked."/>}</section></details>
    <div className={styles.filters}><label className={styles.search}><Icon name="search" size={16}/><input type="search" aria-label="Search campaign inventory" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} placeholder="Find a campaign…"/></label><label>Show campaigns<select value={statusFilter} onChange={event=>{setStatusFilter(event.target.value);setPage(1);}}><option value="on">On now</option><option value="paused">Paused</option><option value="removed">Removed</option><option value="all">All saved campaigns</option></select></label><label>Ad platform<select value={provider} onChange={event=>{setProvider(event.target.value);setPage(1);}}><option value="all">All platforms</option><option value="meta">Meta</option><option value="google">Google Ads</option></select></label><small>{rows.length} campaigns shown</small></div>
    {campaignId&&!focused&&<p className={styles.warning}>The selected campaign is outside this snapshot or your current access.</p>}
    {focused&&<CampaignDetail row={focused} snapshot={snapshot} names={names} onInitiative={onInitiative}/>}
    {rows.length?<div className={`card ${styles.tableWrap}`}><table><caption className={styles.srOnly}>Saved campaigns</caption><thead><tr><th>Campaign</th><th>Platform</th><th>Ad status</th><th>7-day impressions</th><th>7-day clicks</th><th>7-day spend</th><th>Person watching</th><th>Last checked</th></tr></thead><tbody>{pageCampaigns.map(row=>{const initiative=snapshot.initiatives.find(item=>item.registry_id===row.id),delivery=initiative?campaignDelivery(initiative.observation):null;return <tr key={row.id} className={row.id===campaignId?styles.focusedRow:''}><td><button type="button" className={styles.textButton} onClick={()=>onCampaign(row.id)}>{row.name||'Unnamed campaign'}</button></td><td>{row.provider==='meta'?'Meta':'Google Ads'}</td><td>{campaignStatusLabel(row.effective_status)}</td><td>{deliveryMetric(delivery,'impressions')}</td><td>{deliveryMetric(delivery,'clicks')}</td><td>{deliveryMetric(delivery,'spend')}</td><td>{initiative?.owner_agent?names[initiative.owner_agent]||initiative.owner_agent:'Not assigned'}</td><td>{timeLabel(delivery?.lastSyncedAt||row.last_seen_at)}</td></tr>;})}</tbody></table></div>:<Empty title="No campaigns match this view" text="Try All saved campaigns or check when the account was last refreshed."/>}
    <Pagination label="Campaign inventory" page={currentPage} total={rows.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1);}}/>
    {snapshot.campaigns.length>=snapshot.limits.campaigns&&<p className={styles.warning}>This inventory reached the {snapshot.limits.campaigns}-campaign display limit. Older rows may be outside this view.</p>}
    <section className={`card ${styles.funnelCoverage}`}><Icon name="filter" size={22}/><div><h2>Where customers leave</h2><p>We do not yet have a complete view from ad click to purchase. Once product views, carts, checkouts and purchases are connected, the team can check where people stop.</p></div></section>
  </>;
}

function budgetLabel(row:CampaignRegistryRow) {
  if(typeof row.daily_budget!=='number'||!Number.isFinite(row.daily_budget))return 'Not available';
  return `${row.currency||'Currency unknown'} ${row.daily_budget.toLocaleString('en-IN',{maximumFractionDigits:2})}`;
}

function CampaignDetail({row,snapshot,names,onInitiative}:{row:CampaignRegistryRow;snapshot:OutcomesSnapshot;names:Record<string,string>;onInitiative:(id:string)=>void}) {
  const initiative=snapshot.initiatives.find(item=>item.registry_id===row.id),destination=outcomeHref(row.destination_url);
  return <section className={`card ${styles.campaignDetail}`} id={`campaign-${row.id}`}><div className={styles.sectionHead}><div><span className={styles.cardEyebrow}>{row.provider==='meta'?'Meta':'Google Ads'}</span><h2>{row.name||'Unnamed campaign'}</h2></div><span className="pill">View only</span></div><section className={styles.plainBrief}><span className="pill">At a glance</span><h3>{initiative?outcomeBrief(initiative).headline:`This campaign is marked ${campaignStatusLabel(row.effective_status).toLowerCase()}.`}</h3><p>{initiative?outcomeBrief(initiative).explanation:'It was found in your ad account. We do not yet have a saved review of its results.'}</p><p><b>What to do next:</b> {initiative?outcomeBrief(initiative).next:'Open the campaign in the ad platform to confirm its recent activity.'}</p></section>{initiative&&<DeliveryResults row={initiative}/>}<div className={styles.actions}>{initiative&&<button type="button" className="btn" onClick={()=>onInitiative(initiative.id)}>See full review<Icon name="arrow" size={15}/></button>}{destination&&<a className="btn ghost" href={destination} target="_blank" rel="noopener noreferrer">Open saved destination<Icon name="arrow" size={15}/></a>}</div><details className={styles.moreDetail}><summary>Campaign details and supporting data</summary><dl className={styles.facts}><div><dt>Platform campaign ID</dt><dd>{row.campaign_id}</dd></div><div><dt>Goal set in platform</dt><dd>{row.objective||'Not reported'}</dd></div><div><dt>Ad status</dt><dd>{campaignStatusLabel(row.effective_status)}</dd></div><div><dt>Saved daily budget</dt><dd>{budgetLabel(row)}</dd></div><div><dt>Account</dt><dd>{row.account_id}</dd></div><div><dt>Last checked</dt><dd>{timeLabel(row.last_seen_at)}</dd></div></dl>{initiative&&<><StatusStrip row={initiative}/><CampaignMonitoring row={initiative}/><Evidence items={initiative.evidence}/>{initiative.warnings.length>0&&<ul className={styles.warning}>{initiative.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}</>}</details></section>;
}

function Experiments({snapshot,names,onInitiative,onDialog,busy}:{snapshot:OutcomesSnapshot;names:Record<string,string>;onInitiative:(id:string)=>void;onDialog:(dialog:OutcomeDialog)=>void;busy:boolean}) {
  const [filter,setFilter]=useState('all'),[page,setPage]=useState(1),rows=snapshot.experiments.filter(row=>filter==='all'||row.status===filter);
  const currentPage=Math.min(page,Math.max(1,Math.ceil(rows.length/6))),pageExperiments=rows.slice((currentPage-1)*6,currentPage*6);
  return <><div className={styles.sectionHead}><div><h2>Tests and what happened</h2><p>See what the team planned to try and whether the results are known.</p></div><label className={styles.selectLabel}>Show<select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All experiments</option><option value="planned">Awaiting evaluation</option><option value="evaluated">Evaluated</option><option value="cancelled">Cancelled</option></select></label></div><p className={styles.note}>Open a piece of work to add a test. A better result alone does not tell us what caused it.</p>
    {rows.length?<div className={styles.experimentGrid}>{pageExperiments.map(row=>{const initiative=snapshot.initiatives.find(item=>item.id===row.initiative_id);return <article key={row.id} className={`card ${styles.experiment}`}><header><span className={`pill ${row.verdict==='harmful'?'bad':row.verdict==='improved'?'acc':row.verdict==='inconclusive'?'warn':''}`}>{row.status==='cancelled'?'Cancelled':evaluationLabel(row.verdict||'')}</span><small>Version {row.revision}</small></header><h3>{row.hypothesis}</h3><p className={styles.note}>{initiative?.title||'Initiative outside this snapshot'}{initiative?.owner_agent?` · ${names[initiative.owner_agent]||initiative.owner_agent}`:''}</p><details className={styles.moreDetail}><summary>Test plan and supporting numbers</summary><dl className={styles.facts}><div><dt>Primary metric</dt><dd>{METRICS.find(item=>item.id===row.primary_metric)?.label||row.primary_metric}</dd></div><div><dt>Evaluation date</dt><dd>{timeLabel(row.evaluation_at)}</dd></div><div><dt>Baseline</dt><dd>{metricValue(row.baseline?.value,row.primary_metric)}</dd></div><div><dt>Baseline observed</dt><dd>{timeLabel(row.baseline?.at)}</dd></div></dl><h4>Proposed change</h4><p>{row.planned_change}</p>{row.guardrails.length>0&&<><h4>Guardrails</h4><ul>{row.guardrails.map((item,index)=><li key={index}>{item}</li>)}</ul></>}{row.baseline?.source&&<p className={styles.note}>Baseline source: {row.baseline.source}</p>}{row.evaluation_summary&&<section className={styles.evaluation}><h4>Recorded evaluation</h4><p>{row.evaluation_summary}</p><Evidence items={row.evaluation_evidence}/></section>}</details><div className={styles.actions}>{initiative&&<button className="btn ghost sm-btn" type="button" onClick={()=>onInitiative(initiative.id)}>Open work</button>}{initiative?.can_manage&&row.status==='planned'&&<button className="btn sm-btn" type="button" disabled={busy} onClick={()=>onDialog({kind:'evaluate',experiment:row,initiative})}>Record evaluation</button>}</div></article>;})}</div>:<Empty title="No experiments in this view" text="Open an initiative and record a hypothesis, baseline, guardrails and evaluation date."/>}
    <Pagination label="Experiments" page={currentPage} total={rows.length} pageSize={6} onPageChange={setPage}/>
    {snapshot.experiments.length>=snapshot.limits.experiments&&<p className={styles.note}>Showing up to {snapshot.limits.experiments} recent experiments.</p>}
  </>;
}

function QualityReview({row,names}:{row:OutcomeInitiative;names:Record<string,string>}) {
  const review=row.qa_review,status=qualityStatus(review),source=outcomeHref(row.source_url,{internal:true});
  return <section className={styles.subsection}><div className={styles.sectionHead}><h3>Independent quality review</h3><span className={`pill ${status.tone}`}>{status.label}</span></div>{review?<>{!review.current&&<p className={styles.warning}>This verdict is historical. The current deliverable or evidence no longer matches the checked version.</p>}<p><b>{names[review.reviewerId]||review.reviewerId}</b> · {timeLabel(review.checkedAt)}</p><p>{review.note}</p>{review.findings.length>0&&<ul>{review.findings.map((finding,index)=><li key={index}>{finding}</li>)}</ul>}<p className={styles.note}>Checked version {review.artifactFingerprint.slice(0,12)} · human round {review.humanRevision} · correction round {review.revisionRound}</p></>:<p className={styles.note}>No quality check is saved here yet. Open the original work to see its review.</p>}{source&&<Link href={source} className="btn ghost sm-btn">Inspect source review<Icon name="arrow" size={14}/></Link>}</section>;
}

function QualityInbox({snapshot,names,onInitiative}:{snapshot:OutcomesSnapshot;names:Record<string,string>;onInitiative:(id:string)=>void}) {
  const [filter,setFilter]=useState('attention'),[page,setPage]=useState(1);
  const rows=snapshot.initiatives.filter(row=>row.source_kind!=='provider_campaign'&&(filter==='all'||!qualityStatus(row.qa_review).passed&&['producing','needs_correction','awaiting_human','expired'].includes(row.approval_state)));
  const currentPage=Math.min(page,Math.max(1,Math.ceil(rows.length/6))),pageReviews=rows.slice((currentPage-1)*6,currentPage*6);
  return <><div className={styles.sectionHead}><div><h2>Work to check before approval</h2><p>Check the latest version and any feedback before deciding.</p></div><label className={styles.selectLabel}>Show<select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="attention">Needs review or correction</option><option value="all">All work with review visibility</option></select></label></div><p className={styles.warning}>If the work changes after a check, it needs another check before approval.</p>{rows.length?<div className={styles.qualityGrid}>{pageReviews.map(row=><article key={row.id} className={`card ${styles.qualityCard}`}><span className={styles.cardEyebrow}>{sourceLabel(row.source_kind)}</span><h3>{row.title}</h3><StatusStrip row={row}/><details className={styles.moreDetail}><summary>Review findings <span className={`pill ${qualityStatus(row.qa_review).tone}`}>{qualityStatus(row.qa_review).label}</span></summary><QualityReview row={row} names={names}/></details><button className="btn ghost sm-btn" type="button" onClick={()=>onInitiative(row.id)}>See next step<Icon name="arrow" size={14}/></button></article>)}</div>:<Empty title="No work needs checking here" text="Choose All work to see past checks."/>}<Pagination label="Quality reviews" page={currentPage} total={rows.length} pageSize={6} onPageChange={setPage}/></>;
}
