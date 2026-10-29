const STATES = {
  approval: {proposed:'Proposed',producing:'In production',needs_correction:'Needs correction',qc_passed:'QC passed',awaiting_human:'Awaiting human review',approved:'Approved',rejected:'Rejected',expired:'Approval expired'},
  execution: {not_started:'Not started',scheduled:'Scheduled',attempted:'Attempted',provider_confirmed:'Provider confirmed',uncertain:'Outcome uncertain',failed:'Failed',cancelled:'Cancelled'},
  outcome: {awaiting_data:'Awaiting data',healthy:'Healthy',underperforming:'Underperforming',improving:'Improving',inconclusive:'Inconclusive',ready_for_scaling_review:'Ready for scaling review',closed:'Closed'},
};
export const METRICS = [
  {id:'spend',label:'Ad spend',unit:'₹'}, {id:'impressions',label:'Impressions',unit:''},
  {id:'clicks',label:'Clicks',unit:''}, {id:'purchases',label:'Purchases',unit:''},
  {id:'revenue',label:'Attributed revenue',unit:'₹'}, {id:'ctr',label:'Click-through rate',unit:'%'},
  {id:'cpc',label:'Cost per click',unit:'₹'}, {id:'cpa',label:'Cost per purchase',unit:'₹'},
  {id:'roas',label:'Attributed ROAS',unit:'×'},
];

export function stateLabel(dimension,value) {
  return STATES[dimension]?.[value] || 'Unknown';
}

/** Keep the three status dimensions independent; an approval is not an execution receipt. */
export function stateTone(dimension,value) {
  if(dimension==='approval')return ['approved','qc_passed'].includes(value)?'good':['needs_correction','expired'].includes(value)?'warn':value==='rejected'?'bad':'';
  if(dimension==='execution')return value==='provider_confirmed'?'acc':['uncertain','attempted'].includes(value)?'warn':value==='failed'?'bad':'';
  if(dimension==='outcome')return ['healthy','improving'].includes(value)?'good':['underperforming','inconclusive'].includes(value)?'warn':value==='ready_for_scaling_review'?'acc':'';
  return '';
}

export function metricValue(value,metric,currency) {
  if(typeof value!=='number'||!Number.isFinite(value))return 'Not available';
  const unit=METRICS.find(row=>row.id===metric)?.unit||'';
  const number=value.toLocaleString('en-IN',{maximumFractionDigits:['impressions','clicks','purchases'].includes(metric)?0:2});
  return unit==='₹'?`${currency||'Currency units'} ${number}`:`${number}${unit}`;
}

export function validTime(value) {
  const timestamp=typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(timestamp)?timestamp:null;
}

export function dateTimeIST(value) {
  const time=validTime(value);
  return time===null?'':new Date(time+330*60_000).toISOString().slice(0,16);
}

export function optionalNumber(value,{integer=false,min=-Infinity,max=Infinity,label='Value'}={}) {
  if(typeof value==='string'&&!value.trim()||value===null||value===undefined)return null;
  if(!['string','number'].includes(typeof value))throw new Error(`${label} must be a number.`);
  const number=Number(value);
  if(!Number.isFinite(number)||integer&&!Number.isInteger(number)||number<min||number>max)throw new Error(`${label} must be ${integer?'a whole number':'a number'}${Number.isFinite(min)?` of at least ${min}`:''}${Number.isFinite(max)?` and at most ${max}`:''}.`);
  return number;
}

export function initiativeDeadlines(row,now=Date.now()) {
  const closed=row.outcome_state==='closed'||row.approval_state==='rejected'||row.execution_state==='cancelled';
  const due=validTime(row.due_at),review=validTime(row.next_review_at);
  return {
    overdue:!closed&&row.execution_state!=='provider_confirmed'&&due!==null&&due<now,
    reviewDue:!closed&&review!==null&&review<now,
  };
}

/** Navigation is either a local app path or an explicit HTTP(S) evidence reference. */
export function outcomeHref(value,{internal=false}={}) {
  if(typeof value!=='string'||/[\u0000-\u0020\\]/.test(value))return null;
  if(/^\/(?!\/)/.test(value))return value;
  if(internal)return null;
  try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}

export function metricReadiness(config) {
  const missing=[];
  if(!config||!METRICS.some(row=>row.id===config.metric))missing.push('Primary metric');
  if(typeof config?.target!=='number'||!Number.isFinite(config.target))missing.push('Target');
  if(!Number.isInteger(config?.minSample)||config.minSample<1)missing.push('Minimum sample');
  return {ready:missing.length===0,missing};
}

export function coverageTone(value) {
  return ['complete','fresh','ok','healthy','success'].includes(value)?'good':['failed','error','denied','permission_denied'].includes(value)?'bad':'warn';
}

export function evaluationLabel(value) {
  return ({improved:'Improved',no_improvement:'No improvement',harmful:'Harmful',inconclusive:'Inconclusive'})[value]||'Not evaluated';
}

export function qualityStatus(review) {
  if(!review)return {label:'Not recorded',tone:'',passed:false};
  const passed=review.current===true&&review.decision==='pass';
  return {label:passed?'QC passed':review.current!==true?'Earlier review · version changed':review.decision==='revise'?'Correction requested':'Blocked',tone:passed?'good':'warn',passed};
}

/** Imported campaigns are provider observations, not proposals created by AI Office. */
export function initiativeState(row,dimension) {
  if(row.source_kind==='provider_campaign'&&dimension==='approval')return {title:'Source',label:'External campaign',tone:''};
  if(row.source_kind==='provider_campaign'&&dimension==='execution')return {title:'Delivery evidence',label:'Provider observation',tone:''};
  const value=row[dimension==='approval'?'approval_state':dimension==='execution'?'execution_state':'outcome_state'];
  return {title:({approval:'Approval',execution:'Implementation',outcome:'Business outcome'})[dimension]||'State',label:stateLabel(dimension,value),tone:stateTone(dimension,value)};
}

export function campaignMonitoring(observation) {
  const item=observation?.campaignMonitoring;
  const mode=['current','inventory_only','scope_unknown'].includes(item?.mode)?item.mode:'scope_unknown';
  const label=({current:'In monitoring',inventory_only:'Inventory only',scope_unknown:'Activity coverage unknown'})[mode];
  const detail=({configured_active:'The provider configuration is active. This does not confirm delivery or a business result.',recent_delivery:'The checked reporting window contains recorded delivery. This does not establish delivery right now, profit or an AI Office approval.',explicit_review:'An explicit measurement plan or review date keeps this campaign in monitoring.',inactive_inventory:'Retained as inactive inventory. The complete checked activity window contains no recent recorded delivery.',unknown_activity:'Recent activity coverage is incomplete or unavailable. Inactivity has not been established.'})[item?.reason]||'Monitoring scope has not been recorded for this campaign.';
  const window=item?.activityWindow;
  return {mode,label,detail,recentDeliveryAt:typeof item?.recentDeliveryAt==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(item.recentDeliveryAt)?item.recentDeliveryAt:null,windowLabel:typeof window?.from==='string'&&typeof window?.to==='string'&&typeof window?.timezone==='string'?`${window.from} to ${window.to} · ${window.timezone}`:'Not recorded',complete:typeof item?.activityComplete==='boolean'?item.activityComplete:null};
}

export function campaignDelivery(observation) {
  const item=observation?.deliverySummary;
  if(!item||typeof item.from!=='string'||typeof item.to!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(item.from)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(item.to))return null;
  const value=key=>typeof item[key]==='number'&&Number.isFinite(item[key])&&item[key]>=0?item[key]:null;
  return {from:item.from,to:item.to,timezone:typeof item.timezone==='string'?item.timezone:'',impressions:value('impressions'),clicks:value('clicks'),spend:value('spend'),recordedDays:value('recordedDays'),lastDeliveryAt:typeof item.lastDeliveryAt==='string'?item.lastDeliveryAt:null,currency:typeof item.currency==='string'?item.currency:null,lastSyncedAt:validTime(item.lastSyncedAt)!==null?item.lastSyncedAt:null};
}

/** Proposals are descriptive previews; only an explicit configure save can adopt one. */
export function benchmarkSuggestion(observation) {
  const item=observation?.benchmarkProposal;
  if(!item||typeof item!=='object')return null;
  const settings=item.settings,baseline=item.baseline;
  const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  const valid=settings?.metric==='roas'&&settings.direction==='higher'&&finite(settings.target)&&item.target===settings.target&&settings.sampleMetric==='purchases'&&Number.isSafeInteger(settings.minSample)&&settings.minSample>=1&&Number.isInteger(settings.windowDays)&&settings.windowDays>=1&&settings.windowDays<=90&&finite(settings.maturityHours)&&settings.maturityHours<=720&&finite(settings.maxDataAgeHours)&&settings.maxDataAgeHours>=1&&settings.maxDataAgeHours<=720&&finite(baseline?.value)&&typeof baseline?.source==='string'&&(baseline.at===null||validTime(baseline.at)!==null);
  return {available:item.available===true&&valid,kind:'match_recent_observation',confidence:'descriptive_data_only',target:finite(item.target)?item.target:null,settings:valid?settings:null,baseline:valid?baseline:null,recent:item.recent&&typeof item.recent==='object'?item.recent:null,previous:item.previous&&typeof item.previous==='object'?item.previous:null,reasons:Array.isArray(item.reasons)?item.reasons.filter(x=>typeof x==='string'):[],warnings:Array.isArray(item.warnings)?item.warnings.filter(x=>typeof x==='string'):[]};
}
