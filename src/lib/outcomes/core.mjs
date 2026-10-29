import { createHash } from 'node:crypto';
export const METRICS=['spend','impressions','clicks','purchases','revenue','ctr','cpc','cpa','roas'];
export const text=(v,max=1000)=>typeof v==='string'?Array.from(v.trim()).slice(0,max).join(''):'';
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const fingerprint=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function validateMetricConfig(value){
 if(value===null)return null;
 if(!value||!METRICS.includes(value.metric)||!['higher','lower'].includes(value.direction)||!['impressions','clicks','purchases'].includes(value.sampleMetric))throw new Error('Choose a supported metric, direction and sample.');
 const {target,minSample,windowDays,maturityHours,maxDataAgeHours}=value;
 if(target!==null&&number(target)===null)throw new Error('Target must be a nonnegative number or left unknown.');
 if(minSample!==null&&(!Number.isSafeInteger(minSample)||minSample<1))throw new Error('Set a positive minimum sample or leave it unknown.');
 if(!Number.isInteger(windowDays)||windowDays<1||windowDays>90||number(maturityHours)===null||maturityHours>720||number(maxDataAgeHours)===null||maxDataAgeHours<1||maxDataAgeHours>720)throw new Error('Choose a bounded measurement window, maturity delay and freshness limit.');
 return {metric:value.metric,direction:value.direction,target,minSample,sampleMetric:value.sampleMetric,windowDays,maturityHours,maxDataAgeHours};
}
export function validateBaseline(value){
 if(value===null)return null;
 if(!value||value.value!==null&&number(value.value)===null)throw new Error('Baseline must be a nonnegative number or left unknown.');
 const at=value.at===null?null:text(value.at,100);if(at&&!Number.isFinite(Date.parse(at)))throw new Error('Enter a valid baseline date.');
 return {value:value.value,at:at||null,source:text(value.source,500)};
}
export function measurementWindow(config,timezone,now=new Date()){
 if(typeof timezone!=='string'||!timezone)return null;
 try{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now.getTime()-config.maturityHours*3600000)).map(p=>[p.type,p.value]));
  const end=Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`)-864e5;
  return {from:new Date(end-(config.windowDays-1)*864e5).toISOString().slice(0,10),to:new Date(end).toISOString().slice(0,10),timezone};
 }catch{return null;}
}
export function campaignMonitoringScope(initiative,campaign,recentActivity={complete:false,window:null,lastDeliveryAt:null}){
 const configured=String(campaign.configured_status||'').toUpperCase(),effective=String(campaign.effective_status||'').toUpperCase();
 const configuredActive=['ACTIVE','ENABLED'].includes(configured)||(!configured&&['ACTIVE','ELIGIBLE','LIMITED','LEARNING','LEARNING_LIMITED','IN_PROCESS','PENDING','NOT_ELIGIBLE','WITH_ISSUES'].includes(effective));
 const explicit=initiative.metric_config!=null||!!initiative.next_review_at||!!initiative.due_at;
 const window=recentActivity.window,last=recentActivity.lastDeliveryAt;
 const recent=typeof last==='string'&&!!window&&last>=window.from&&last<=window.to;
 const reason=configuredActive?'configured_active':recent?'recent_delivery':explicit?'explicit_review':recentActivity.complete?'inactive_inventory':'unknown_activity';
 return {mode:configuredActive||recent||explicit?'current':recentActivity.complete?'inventory_only':'scope_unknown',reason,configuredActive,recentDeliveryAt:recent?last:null,activityWindow:window||null,activityComplete:recentActivity.complete===true};
}
/** Delivery facts are independent of a chosen success target. Missing rows stay unknown. */
export function campaignDeliverySummary(campaign,coverage,activity){
 const window=activity?.window;
 const covered=campaign?.selected&&campaign?.details?.metrics_supported!==false&&activity?.complete===true&&window&&coverage?.complete===true&&coverage?.status==='complete'&&coverage?.coverage?.metrics_complete===true&&coverage?.coverage?.window_from<=window.from&&coverage?.coverage?.window_to>=window.to;
 if(!covered)return null;
 const days=(activity.days||[]).filter(day=>day.day<=window.to&&day.day>=new Date(Date.parse(`${window.to}T00:00:00Z`)-6*864e5).toISOString().slice(0,10));
 const sum=key=>days.length&&days.every(day=>number(day[key])!==null)?days.reduce((total,day)=>total+day[key],0):null;
 const from=new Date(Date.parse(`${window.to}T00:00:00Z`)-6*864e5).toISOString().slice(0,10);
 return {from,to:window.to,timezone:window.timezone,impressions:sum('impressions'),clicks:sum('clicks'),spend:sum('spend'),recordedDays:days.length,lastDeliveryAt:activity.lastDeliveryAt||null,currency:campaign.currency||null,lastSyncedAt:coverage.last_success_at||null};
}
const incident=(problem_key,severity,title,detail)=>({problem_key,severity,title,detail,evidence:[]});
export function observeOutcome(initiative,{campaign=null,coverage=null,metrics=null,recentActivity,now=new Date()}={}){
 const incidents=[],warnings=[],evidence=[];let state='awaiting_data';let observed={};
 if(initiative.execution_state==='uncertain')incidents.push(incident('execution_uncertain','critical','Execution needs reconciliation','A prior external attempt is uncertain. Inspect its provider receipt before any retry.'));
 if(initiative.execution_state==='failed')incidents.push(incident('execution_failed','warning','Implementation needs attention','Inspect the recorded failure and assign a specific correction. No automatic provider retry is authorized.'));
 if(initiative.approval_state==='needs_correction')incidents.push(incident('work_blocked','warning','Work needs correction','The linked work has unresolved requirements or a failed stage. Inspect its saved progress before retrying.'));
 if(initiative.due_at&&Date.parse(initiative.due_at)<now.getTime()&&!['approved','rejected','expired'].includes(initiative.approval_state)&&initiative.execution_state!=='cancelled')incidents.push(incident('work_overdue','warning','Assigned work is overdue','The recorded deadline has passed. The owner should update the plan or resolve the blocker.'));
 if(initiative.next_review_at&&Date.parse(initiative.next_review_at)<=now.getTime()&&initiative.outcome_state!=='closed')incidents.push(incident('evaluation_due','info','Outcome review is due','The owner should record an evaluation with evidence or set the next review date.'));
 if(initiative.execution_state==='cancelled'||initiative.approval_state==='rejected'){state='closed';warnings.push('Cancelled or rejected work is closed without asserting a business result.');}
 else if(!campaign){
  const manual=initiative.observation?.manualEvaluation;
  if(manual){state=manual.verdict==='improved'?'improving':manual.verdict==='harmful'?'underperforming':'inconclusive';observed.manualEvaluation=manual;warnings.push('Outcome is a human-recorded evaluation, not an independently measured or causal result.');}
  else warnings.push('No linked measurement adapter establishes this work’s business result. Record an experiment and evidence; acceptance alone does not establish execution.');
  if(initiative.metric_config)warnings.push('Automatic campaign metrics are available only for a linked provider campaign. This initiative requires a manual evidence-backed evaluation.');
 }else{
  evidence.push({source:`${campaign.provider} campaign ${campaign.campaign_id}`,detail:`Account ${campaign.account_id}; configured status ${campaign.configured_status||'unknown'}; effective status ${campaign.effective_status||'unknown'}. Inventory does not establish delivery.`,at:campaign.last_seen_at});
  const scope=campaignMonitoringScope(initiative,campaign,recentActivity);observed.campaignMonitoring=scope;
  observed.deliverySummary=campaignDeliverySummary(campaign,coverage,recentActivity);
  if(scope.recentDeliveryAt)evidence.push({source:'Imported provider activity',detail:`Nonzero spend, impressions or clicks were recorded on ${scope.recentDeliveryAt}. This does not establish current delivery, purchases, profit or AI Office approval.`});
  if(!campaign.selected){state='inconclusive';warnings.push('This campaign is outside the latest selected inventory. Historical results do not establish current monitoring.');}
  else if(scope.mode!=='current'){state='inconclusive';warnings.push(scope.mode==='inventory_only'?'Inactive campaign retained as historical inventory. No recent recorded delivery or explicit measurement/review plan places it in the current alert queue.':'Recent activity coverage is incomplete; monitoring eligibility is unknown. Previous findings require a complete check before resolution.');}
  else{
   const problems=[];if(campaign.details?.metrics_supported===false)problems.push('This campaign type is outside the implemented metric adapter coverage.');let config=null;try{config=validateMetricConfig(initiative.metric_config);}catch{problems.push('The saved measurement configuration is invalid.');}
   if(!config||config.target===null||config.minSample===null)problems.push('Set an explicit metric target and minimum sample before judging performance.');
   const period=config?measurementWindow(config,campaign.account_timezone,now):null;
   if(config&&!period)problems.push('A valid provider account timezone is required for the configured measurement window.');
   if(!coverage?.selected||!coverage.complete||coverage.status!=='complete'||coverage.coverage?.metrics_complete!==true)problems.push('The account metric import is missing, partial, failed or outside selection.');
   if(config&&(!coverage?.last_success_at||now.getTime()-Date.parse(coverage.last_success_at)>config.maxDataAgeHours*3600000||!Number.isFinite(Date.parse(coverage.last_success_at))))problems.push('The last complete account snapshot is not fresh enough.');
   if(period&&(!(coverage?.coverage?.window_from<=period.from)||!(coverage?.coverage?.window_to>=period.to)))problems.push('The complete imported dates do not cover the required mature measurement window.');
   if(config&&period&&(!metrics||metrics.from!==period.from||metrics.to!==period.to))problems.push('A complete campaign metric result for the exact window is unavailable.');
   if(metrics&&config){
    if(metrics.row_count>0&&(!metrics.all_refreshed||!metrics.oldest_refresh||now.getTime()-Date.parse(metrics.oldest_refresh)>config.maxDataAgeHours*3600000))problems.push('One or more recorded metric rows are stale or have unknown refresh coverage.');
    const purchaseNeeded=['purchases','revenue','cpa','roas'].includes(config.metric)||config.sampleMetric==='purchases';
    const purchaseKnown=metrics.row_count===0?coverage?.coverage?.conversion_definition==='purchase'&&coverage?.coverage?.purchase_tracking_verified===true:metrics.purchase_known===true;
    if(purchaseNeeded&&!purchaseKnown)problems.push('Purchase-only conversion definitions and values are not verified. Generic conversions are not purchases.');
    if(['spend','revenue','cpc','cpa','roas'].includes(config.metric)&&(!campaign.currency||metrics.currency!==campaign.currency))problems.push('Consistent account currency is required for monetary comparisons.');
   }
   if(problems.length){warnings.push(...new Set(problems));incidents.push(incident('measurement_requirements','info','Measurement requirements are incomplete',warnings.join(' ')));}
   else{
    const sums=Object.fromEntries(['spend','impressions','clicks','purchases','revenue'].map(k=>[k,number(metrics[k])]));
    const ratio=(a,b,m=1)=>a!==null&&b!==null&&b>0?a/b*m:null;
    const value={...sums,ctr:ratio(sums.clicks,sums.impressions,100),cpc:ratio(sums.spend,sums.clicks),cpa:ratio(sums.spend,sums.purchases),roas:ratio(sums.revenue,sums.spend)}[config.metric];
    const sample=sums[config.sampleMetric];
    observed={...observed,metric:config.metric,value,sample,sampleMetric:config.sampleMetric,target:config.target,period,currency:campaign.currency,observedDays:metrics.date_count,measurement:'provider_attributed',rowCount:metrics.row_count};
    evidence.push({source:'Recorded campaign metrics',detail:`${period.from} to ${period.to} (${period.timezone}); ${metrics.row_count} recorded ad/day rows. ${config.metric}: ${value===null?'unknown':value}; ${config.sampleMetric} sample: ${sample===null?'unknown':sample}.`,at:coverage.last_success_at});
    warnings.push('These are provider-attributed observations, not unique reconciled sales, profit or proof that a change caused an improvement. No budget or campaign change is authorized.');
    if(value===null||sample===null){state='inconclusive';warnings.push('The metric or denominator is unknown or zero; no performance conclusion was made.');}
    else if(sample<config.minSample){state='awaiting_data';warnings.push(`The recorded sample (${sample}) is below the configured minimum (${config.minSample}).`);}
    else{
     const meets=config.direction==='higher'?value>=config.target:value<=config.target;
     const baseline=number(initiative.baseline?.value),improved=baseline!==null&&(config.direction==='higher'?value>baseline:value<baseline);
     state=meets?(improved?'improving':'healthy'):'underperforming';
     if(!meets)incidents.push(incident('performance_below_target','warning','Recorded performance is below the configured target',`${config.metric} is ${value}; configured ${config.direction==='higher'?'minimum':'maximum'} is ${config.target}. The mature sample meets the configured minimum. Investigate measurement and delivery before proposing a change.`));
    }
   }
   const delivery=String(campaign.effective_status||'').toUpperCase();
   if(['DISAPPROVED','REJECTED','WITH_ISSUES','PENDING_BILLING_INFO','NOT_ELIGIBLE'].includes(delivery))incidents.push(incident('delivery_attention','warning','Provider delivery status needs attention',`The recorded effective status is ${delivery}. Inspect the provider status; no automatic corrective write was attempted.`));
   if(campaign.provider==='google'&&delivery==='LIMITED')incidents.push(incident('delivery_limited','info','Google reports limited eligibility','Inspect the recorded campaign limitations before proposing changes. Limited eligibility does not by itself prove failed delivery.'));
  }
 }
 const output={outcome_state:state,...observed,evidence,warnings:[...new Set(warnings)],incidents};
 // Exclude observation timestamps so polling alone never changes a fingerprint.
 output.fingerprint=fingerprint({source:initiative.source_fingerprint,config:initiative.metric_config,baseline:initiative.baseline,state,observed,evidence:evidence.map(({at,...e})=>e),warnings:output.warnings,incidents});
 return output;
}
export function sourceUrl(row){
 const id=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value)?value:null;
 if(id(row.source_task_id))return `/automations?task=${row.source_task_id}`;
 if(id(row.source_campaign_id))return `/approvals?campaign=${row.source_campaign_id}#campaign-${row.source_campaign_id}`;
 if(id(row.source_report_id))return `/approvals?report=${row.source_report_id}#report-${row.source_report_id}`;
 if(id(row.registry_id))return `/outcomes?campaign=${row.registry_id}`;
 return null;
}
