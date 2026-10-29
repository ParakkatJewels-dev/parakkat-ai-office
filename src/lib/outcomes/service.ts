import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { conversationUser } from '@/lib/agents/conversation-api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isPaused } from '@/lib/pause';
import { UUID } from '@/lib/automation/core.mjs';
import { campaignMonitoringScope,fingerprint,measurementWindow, observeOutcome, sourceUrl, text, validateBaseline, validateMetricConfig } from './core.mjs';
import type { CampaignCoverageRow, CampaignRegistryRow, OutcomeInitiative, OutcomesSnapshot } from './types';
import type { AppRole } from '@/lib/roles';
import { openIncidentInitiativeIds } from './attention.mjs';
import { recommendCampaignBenchmark } from './benchmarks.mjs';
import { readRecentCampaignActivity } from './recent-activity.mjs';
import { OUTCOME_CADENCE_SECONDS,withOutcomeMonitoringLease } from './cadence.mjs';
export class OutcomeError extends Error {constructor(message:string,public status=400){super(message);}}
export async function outcomeSession(){const s=await conversationUser();if(!s)throw new OutcomeError('Please sign in.',401);if(s.role==='viewer')throw new OutcomeError('Outcome access is limited to department heads.',403);return s;}
export type OutcomeSession=Awaited<ReturnType<typeof outcomeSession>>;
const limits={initiatives:300,incidents:300,experiments:200,campaigns:500,coverage:100,sourceScanPerKind:5000};
export async function getOutcomes(s:OutcomeSession):Promise<OutcomesSnapshot>{
 const [initiatives,incidents,experiments,campaigns,coverage,departments,agents,paused,monitorStatus]=await Promise.all([
  s.db.from('outcome_initiatives').select('*').order('updated_at',{ascending:false}).limit(limits.initiatives),
  s.db.from('outcome_incidents').select('*').order('last_seen_at',{ascending:false}).limit(limits.incidents),
  s.db.from('outcome_experiments').select('*').order('evaluation_at',{ascending:true}).limit(limits.experiments),
  s.db.from('campaign_registry').select('*').order('last_seen_at',{ascending:false}).limit(limits.campaigns),
  s.db.from('campaign_sync_coverage').select('*').order('provider').limit(limits.coverage),
  s.db.from('departments').select('id,name,human_head_role'),s.db.from('agents').select('id,name,department_id,enabled'),isPaused(),s.db.rpc('read_outcome_monitoring_status'),
 ]);
 if([initiatives,incidents,experiments,campaigns,coverage,departments,agents,monitorStatus].some(r=>r.error))throw new OutcomeError('Outcome data is unavailable. Check that the monitoring migration is installed.',503);
 const depts=(departments.data||[]).filter(d=>s.role==='super_admin'||d.human_head_role===s.role),ids=new Set(depts.map(d=>d.id));
 const rows=(initiatives.data||[]).map(row=>({...row,source_url:sourceUrl(row),can_manage:ids.has(row.department_id)})) as OutcomeInitiative[];
 const now=Date.now();
 return {initiatives:rows,incidents:incidents.data||[],experiments:experiments.data||[],campaigns:campaigns.data||[],coverage:coverage.data||[],departments:depts,agents:(agents.data||[]).filter(a=>ids.has(a.department_id)),paused,isAdmin:s.role==='super_admin',role:s.role as AppRole,limits,
  summary:{total:rows.length,awaiting_human:rows.filter(r=>r.approval_state==='awaiting_human').length,approved_not_executed:rows.filter(r=>r.approval_state==='approved'&&r.execution_state==='not_started').length,needs_attention:openIncidentInitiativeIds(rows,incidents.data||[]).size,awaiting_data:rows.filter(r=>['awaiting_data','inconclusive'].includes(r.outcome_state)).length,due_reviews:rows.filter(r=>r.next_review_at&&Date.parse(r.next_review_at)<=now&&r.outcome_state!=='closed').length},
  monitoring:{modelCalls:0,readOnlyProviders:true,cadenceSeconds:OUTCOME_CADENCE_SECONDS,lastRefreshedAt:monitorStatus.data?.last_refreshed_at||null,limited:monitorStatus.data?.limited===true||rows.length===limits.initiatives||(campaigns.data||[]).length===limits.campaigns||(incidents.data||[]).length===limits.incidents||(experiments.data||[]).length===limits.experiments||(coverage.data||[]).length===limits.coverage,checked:rows.filter(r=>r.last_observed_at).length}};
}
const date=(v:unknown)=>{if(v===null)return null;if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw new OutcomeError('Enter a valid date.');return new Date(v).toISOString();};
const required=(v:unknown,max:number)=>{const out=text(v,max);if(!out||typeof v!=='string'||Array.from(v.trim()).length>max)throw new OutcomeError(`Enter 1 to ${max} characters.`);return out;};
const evidence=(v:unknown)=>{if(!Array.isArray(v)||v.length>12)throw new OutcomeError('Add up to twelve evidence references.');return v.map(x=>({source:required(x?.source,200),detail:required(x?.detail,1500),...(x?.at?{at:date(x.at)!}:{})}));};
export async function mutateOutcome(s:OutcomeSession,body:Record<string,any>){
 const allowed=['create_manual','configure','note','experiment_create','experiment_evaluate'];if(!allowed.includes(body.action))throw new OutcomeError('Choose a supported outcome action.');
 const payload:Record<string,unknown>={};let id=body.action==='experiment_evaluate'?body.experimentId:body.id;
 if(body.action!=='create_manual'&&(!UUID.test(id||'')||!Number.isSafeInteger(body.revision)||body.revision<1))throw new OutcomeError('Refresh the record before saving.');
 if(['create_manual','experiment_create'].includes(body.action)){if(!UUID.test(body.requestId||''))throw new OutcomeError('A valid request identifier is required.');payload.requestId=body.requestId;}
 try{
  if(body.action==='create_manual'){
   payload.departmentId=required(body.departmentId,80);payload.ownerAgent=required(body.ownerAgent,80);payload.title=required(body.title,180);payload.summary=body.summary?required(body.summary,6000):'';
   if(body.dueAt!==undefined)payload.dueAt=date(body.dueAt);if(body.nextReviewAt!==undefined)payload.nextReviewAt=date(body.nextReviewAt);id=null;
  }else if(body.action==='configure'){
   if(body.ownerAgent!==undefined)payload.ownerAgent=required(body.ownerAgent,80);
   if(body.dueAt!==undefined)payload.dueAt=date(body.dueAt);if(body.nextReviewAt!==undefined)payload.nextReviewAt=date(body.nextReviewAt);
   if(body.metricConfig!==undefined)payload.metricConfig=validateMetricConfig(body.metricConfig);
   if(body.baseline!==undefined)payload.baseline=validateBaseline(body.baseline);
   if(!Object.keys(payload).length)throw new OutcomeError('Choose a setting to update.');
  }else if(body.action==='note')payload.note=required(body.note,3000);
  else if(body.action==='experiment_create'){
   payload.hypothesis=required(body.hypothesis,3000);payload.primaryMetric=required(body.primaryMetric,160);payload.plannedChange=required(body.plannedChange,3000);payload.evaluationAt=date(body.evaluationAt);
   if(!Array.isArray(body.guardrails)||body.guardrails.length>8)throw new OutcomeError('Add up to eight experiment guardrails.');payload.guardrails=body.guardrails.map((x:unknown)=>required(x,500));payload.baseline=validateBaseline(body.baseline??null);
  }else{
   if(!['improved','no_improvement','harmful','inconclusive'].includes(body.verdict))throw new OutcomeError('Choose an evaluation verdict.');payload.verdict=body.verdict;payload.summary=required(body.summary,4000);payload.evidence=evidence(body.evidence);
  }
 }catch(e){throw e instanceof OutcomeError?e:new OutcomeError(e instanceof Error?e.message:'Check the outcome settings.');}
 // Caller authentication and current ownership are rechecked inside this RPC.
 const result=await s.db.rpc('mutate_outcome',{p_action:body.action,p_id:id,p_revision:body.revision??null,p_payload:payload});
 if(result.error){const code=result.error.code;throw new OutcomeError(code==='40001'?'This record changed. Refresh before saving.':code==='42501'?'This outcome belongs to another department.':code==='22023'?'Check the inputs, evidence and evaluation date. No source action was approved or executed.':'The outcome could not be saved.',code==='40001'?409:code==='42501'?403:400);}
 return result.data as string;
}

/** Materializes source state and evaluates recorded facts only. No provider or LLM calls. */
export async function refreshOutcomeMonitoring(db:SupabaseClient=supabaseAdmin(),options:{force?:boolean}={}){
 return withOutcomeMonitoringLease(db,async({scan,signal,now})=>{
  let checked=0,limited=false;
  const materialized=await db.rpc('materialize_outcome_sources').abortSignal(signal);if(materialized.error)throw new Error('Could not materialize outcome records.');
  const [registryRead,coverageRead]=await Promise.all([db.from('campaign_registry').select('*').limit(10001).abortSignal(signal),db.from('campaign_sync_coverage').select('*').limit(1001).abortSignal(signal)]);
  if(registryRead.error||coverageRead.error)throw new Error('Could not read campaign monitoring coverage.');
  limited=materialized.data?.limited===true||(registryRead.data||[]).length>10000||(coverageRead.data||[]).length>1000;
  const registry=new Map((registryRead.data||[]).slice(0,10000).map(row=>[row.id,row as CampaignRegistryRow]));
  const coverages=new Map((coverageRead.data||[]).slice(0,1000).map(row=>[`${row.provider}:${row.account_id}`,row as CampaignCoverageRow]));
  const activity=await readRecentCampaignActivity(db,registry.values(),{now,signal});limited=limited||!activity.complete;
  let cursor:string|null=scan.monitor_after||null,monitorLimited=false;
  for(let offset=0;offset<limits.sourceScanPerKind;offset+=250){
   let query=db.from('outcome_initiatives').select('*').order('id').limit(250);if(cursor)query=query.gt('id',cursor);
   const read=await query.abortSignal(signal);
   if(read.error)throw new Error('Could not read initiatives for monitoring.');
   const rows=read.data||[];
   // Bounded small batches avoid hundreds of simultaneous database requests.
   for(let start=0;start<rows.length;start+=8)await Promise.all(rows.slice(start,start+8).map(async row=>{
    const campaign=row.registry_id?registry.get(row.registry_id):undefined;
    const coverage=campaign?coverages.get(`${campaign.provider}:${campaign.account_id}`):undefined;
    const recentActivity=campaign?activity.forCampaign(campaign):undefined;
    // An incomplete activity read cannot establish that an inactive campaign has
    // no recent delivery. Leave its existing findings unchanged until verified.
    if(campaign&&campaign.selected&&row.execution_state!=='cancelled'&&row.approval_state!=='rejected'&&campaignMonitoringScope(row,campaign,recentActivity).mode==='scope_unknown'){limited=true;return;}
    let config=null;try{config=validateMetricConfig(row.metric_config);}catch{/* pure observer records invalid configuration */}
    const period=config&&campaign?measurementWindow(config,campaign.account_timezone,now):null;
    let metrics=null;
    if(period&&config?.target!==null&&config?.minSample!==null&&coverage?.complete&&campaign?.selected&&campaign.details?.metrics_supported!==false){
     const facts=await db.rpc('read_outcome_campaign_metrics',{p_registry_id:campaign.id,p_from:period.from,p_to:period.to}).abortSignal(signal);if(!facts.error)metrics=facts.data;
    }
    const observation=observeOutcome(row,{campaign,coverage,metrics,recentActivity,now});
    if(campaign&&observation.campaignMonitoring?.mode==='current'){observation.benchmarkProposal=recommendCampaignBenchmark(campaign,coverage,recentActivity,now);observation.fingerprint=fingerprint({observation:observation.fingerprint,benchmarkProposal:observation.benchmarkProposal});}
    const saved=await db.rpc('save_outcome_observation',{p_id:row.id,p_revision:row.revision,p_observation:observation}).abortSignal(signal);
    if(saved.error)throw new Error('Could not save monitoring progress.');checked++;
   }));
   cursor=rows.at(-1)?.id||cursor;
   if(rows.length<250){cursor=null;break;}
   if(offset+250>=limits.sourceScanPerKind){const more=await db.from('outcome_initiatives').select('id').gt('id',cursor!).limit(1).abortSignal(signal);if(more.error)throw new Error('Could not check monitoring coverage.');monitorLimited=!!more.data?.length;if(!monitorLimited)cursor=null;}
  }
  limited=limited||monitorLimited;
  const scanSaved=await db.from('outcome_scan_state').update({monitor_after:cursor,monitor_limited:limited,last_refreshed_at:now.toISOString()}).eq('singleton',true).abortSignal(signal);if(scanSaved.error)throw new Error('Could not save monitoring continuation.');
  return {checked,limited,materialized:materialized.data,modelCalls:0,readOnlyProviders:true};
 },options);
}
