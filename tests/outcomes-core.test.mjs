import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeOutcome,measurementWindow,validateMetricConfig,validateBaseline,sourceUrl} from '../src/lib/outcomes/core.mjs';
const now=new Date('2026-10-26T12:00:00Z');
const config={metric:'roas',direction:'higher',target:2,minSample:10,sampleMetric:'purchases',windowDays:7,maturityHours:24,maxDataAgeHours:48};
const initiative={id:'00000000-0000-4000-8000-000000000001',source_fingerprint:'v1',approval_state:'proposed',execution_state:'not_started',outcome_state:'awaiting_data',metric_config:config,baseline:{value:1.5,at:null,source:'Recorded baseline'},observation:{}};
const campaign={id:'registry',provider:'meta',account_id:'1',campaign_id:'100',name:'Campaign',selected:true,currency:'INR',account_timezone:'Asia/Kolkata',last_seen_at:now.toISOString(),configured_status:'ACTIVE',effective_status:'ACTIVE',details:{metrics_supported:true}};
const period=measurementWindow(config,campaign.account_timezone,now);
const coverage={selected:true,status:'complete',complete:true,last_success_at:now.toISOString(),coverage:{metrics_complete:true,window_from:'2026-09-20',window_to:'2026-10-25',conversion_definition:'purchase',purchase_tracking_verified:true}};
const metrics={from:period.from,to:period.to,row_count:10,date_count:7,spend:1000,impressions:10000,clicks:1000,purchases:20,revenue:3000,purchase_known:true,currency:'INR',all_refreshed:true,oldest_refresh:now.toISOString()};
const observe=(o={},facts={})=>observeOutcome({...initiative,...o},{campaign,coverage,metrics,now,...facts});
test('metric settings preserve zero and unknown separately and require explicit safeguards',()=>{
 assert.equal(validateMetricConfig({...config,target:0}).target,0);assert.equal(validateMetricConfig({...config,target:null,minSample:null}).target,null);
 for(const patch of [{target:'0'},{target:NaN},{target:-1},{minSample:0},{windowDays:0},{windowDays:91},{maturityHours:721},{maxDataAgeHours:0}])assert.throws(()=>validateMetricConfig({...config,...patch}));
 assert.equal(validateBaseline({value:0,at:null,source:'Actual data'}).value,0);assert.equal(validateBaseline(null),null);assert.throws(()=>validateBaseline({value:'',at:null}));
});
test('mature windows use provider calendar days and reject missing or invalid timezone',()=>{
 assert.deepEqual(period,{from:'2026-10-18',to:'2026-10-24',timezone:'Asia/Kolkata'});
 assert.equal(measurementWindow(config,null,now),null);assert.equal(measurementWindow(config,'not/a_zone',now),null);
 assert.equal(measurementWindow({...config,maturityHours:0},'America/Los_Angeles',new Date('2026-10-26T03:00:00Z')).to,'2026-10-24');
});
test('supported mature evidence can show improvement but never promises profit or scaling',()=>{
 const out=observe();assert.equal(out.outcome_state,'improving');assert.equal(out.value,3);assert.equal(out.sample,20);
 assert.equal(out.incidents.length,0);assert.match(out.warnings.join(' '),/not unique reconciled sales, profit/);assert.equal(out.actions,undefined);
});
test('fingerprints and incidents do not change on polling with identical substantive evidence',()=>{
 const a=observe({}, {metrics:{...metrics,revenue:500}}),b=observe({}, {metrics:{...metrics,revenue:500},now:new Date(now.getTime()+1000)});
 assert.equal(a.fingerprint,b.fingerprint);assert.deepEqual(a.incidents,b.incidents);assert.equal(a.outcome_state,'underperforming');
 assert.notEqual(a.fingerprint,observe({}, {metrics:{...metrics,revenue:600}}).fingerprint);
});
test('unknown, generic, partial, stale and unsupported data cannot establish healthy performance',()=>{
 for(const facts of [
  {metrics:{...metrics,purchase_known:false}}, {metrics:{...metrics,purchases:null}},
  {coverage:{...coverage,complete:false,status:'partial'}}, {coverage:{...coverage,last_success_at:'2026-10-01T00:00:00Z'}},
  {coverage:{...coverage,coverage:{...coverage.coverage,window_from:'2026-10-25'}}},
  {campaign:{...campaign,account_timezone:null}}, {campaign:{...campaign,details:{metrics_supported:false}}},
  {metrics:{...metrics,currency:'USD'}},{metrics:{...metrics,all_refreshed:false}},
 ]){const out=observe({},facts);assert.ok(['awaiting_data','inconclusive'].includes(out.outcome_state));assert.notEqual(out.outcome_state,'healthy');}
});
test('targets and sample bounds are mandatory; low evidence never triggers performance incident',()=>{
 const unset=observe({metric_config:{...config,target:null}});assert.equal(unset.outcome_state,'awaiting_data');assert.ok(unset.incidents.some(i=>i.problem_key==='measurement_requirements'));
 const small=observe({}, {metrics:{...metrics,purchases:2,revenue:1}});assert.equal(small.outcome_state,'awaiting_data');assert.ok(!small.incidents.some(i=>i.problem_key==='performance_below_target'));
});
test('empty rows require explicit coverage and tracking verification, never fabricate purchases',()=>{
 const empty={...metrics,row_count:0,date_count:0,spend:0,impressions:0,clicks:0,purchases:0,revenue:0,purchase_known:null};
 const unknown=observe({}, {metrics:empty,coverage:{...coverage,coverage:{...coverage.coverage,purchase_tracking_verified:false}}});assert.match(unknown.warnings.join(' '),/not verified/);
 const verified=observe({}, {metrics:empty});assert.equal(verified.outcome_state,'inconclusive');assert.equal(verified.value,null);assert.equal(verified.sample,0);
});
test('provider status vocabulary handles Google limited and ineligible without assuming active means delivering',()=>{
 const limited=observe({}, {campaign:{...campaign,provider:'google',effective_status:'LIMITED'}});assert.equal(limited.incidents.find(i=>i.problem_key==='delivery_limited').severity,'info');
 const ineligible=observe({}, {campaign:{...campaign,provider:'google',effective_status:'NOT_ELIGIBLE'}});assert.ok(ineligible.incidents.some(i=>i.problem_key==='delivery_attention'));
 assert.equal(observe({}, {campaign:{...campaign,provider:'google',effective_status:'ELIGIBLE'}}).incidents.length,0);
});
test('accepted drafts stay unexecuted and unmeasured; cancellations do not masquerade as results',()=>{
 const accepted=observe({approval_state:'approved'},{campaign:null});assert.equal(accepted.outcome_state,'awaiting_data');assert.match(accepted.warnings[0],/acceptance alone/);
 const cancelled=observe({approval_state:'rejected',execution_state:'cancelled'},{campaign:null});assert.equal(cancelled.outcome_state,'closed');assert.match(cancelled.warnings[0],/without asserting/);
});
test('manual experiment conclusions are preserved and explicitly identified as human recorded',()=>{
 const out=observe({observation:{manualEvaluation:{experimentId:'e',verdict:'improved',at:now.toISOString()}}},{campaign:null});
 assert.equal(out.outcome_state,'improving');assert.match(out.warnings[0],/human-recorded/);assert.equal(out.manualEvaluation.verdict,'improved');
});
test('deadlines and uncertain writes produce stable bounded incidents without provider actions',()=>{
 const out=observe({execution_state:'uncertain',approval_state:'needs_correction',due_at:'2026-10-20T00:00:00Z',next_review_at:'2026-10-21T00:00:00Z'},{campaign:null});
 assert.deepEqual(new Set(out.incidents.map(i=>i.problem_key)),new Set(['execution_uncertain','work_blocked','work_overdue','evaluation_due']));assert.equal(out.actions,undefined);
});
test('source links are constructed internally and cannot use provider-controlled URLs',()=>{
 const id=initiative.id;assert.equal(sourceUrl({source_campaign_id:id}),`/approvals?campaign=${id}#campaign-${id}`);
 assert.equal(sourceUrl({source_report_id:'https://evil.example',source_url:'https://evil.example'}),null);
});
test('historical paused and removed inventory stays visible without opening current measurement alerts',()=>{
 for(const patch of [{configured_status:'PAUSED',effective_status:'PAUSED'},{provider:'google',configured_status:'REMOVED',effective_status:'REMOVED'},{configured_status:'ARCHIVED',effective_status:'ARCHIVED'}]){
  const out=observe({metric_config:null,baseline:null},{campaign:{...campaign,...patch},metrics:null,recentActivity:{complete:true,window:{from:'2026-09-26',to:'2026-10-25',timezone:'Asia/Kolkata'},lastDeliveryAt:null}});
  assert.equal(out.campaignMonitoring.mode,'inventory_only');assert.equal(out.incidents.length,0);assert.equal(out.outcome_state,'inconclusive');assert.match(out.warnings[0],/historical inventory/);
 }
});
test('active, recently delivered and explicitly reviewed campaigns keep measurement safeguards',()=>{
 const activity={complete:true,window:{from:'2026-09-26',to:'2026-10-25',timezone:'Asia/Kolkata'},lastDeliveryAt:null};
 for(const [patch,facts,reason] of [
  [{metric_config:null},{recentActivity:activity},'configured_active'],
  [{metric_config:null},{campaign:{...campaign,configured_status:'PAUSED',effective_status:'PAUSED'},recentActivity:{...activity,lastDeliveryAt:'2026-10-20'}},'recent_delivery'],
  [{metric_config:null,next_review_at:'2026-11-01T00:00:00Z'},{campaign:{...campaign,configured_status:'PAUSED',effective_status:'PAUSED'},recentActivity:activity},'explicit_review']
 ]){const out=observe(patch,facts);assert.equal(out.campaignMonitoring.mode,'current');assert.equal(out.campaignMonitoring.reason,reason);assert.ok(out.incidents.some(i=>i.problem_key==='measurement_requirements'));assert.notEqual(out.outcome_state,'healthy');}
 const recent=observe({metric_config:null},{campaign:{...campaign,configured_status:'PAUSED'},recentActivity:{...activity,lastDeliveryAt:'2026-10-20'}});assert.match(recent.evidence.map(e=>e.detail).join(' '),/does not establish current delivery/);assert.equal(recent.execution_state,undefined);
});
test('incomplete recent activity remains unknown and cancelled work still closes first',()=>{
 const facts={campaign:{...campaign,configured_status:'PAUSED',effective_status:'PAUSED'},recentActivity:{complete:false,window:null,lastDeliveryAt:null}};
 const out=observe({metric_config:null},facts);assert.equal(out.campaignMonitoring.mode,'scope_unknown');assert.match(out.warnings[0],/incomplete/);
 const cancelled=observe({metric_config:null,approval_state:'rejected',execution_state:'cancelled'},facts);assert.equal(cancelled.outcome_state,'closed');assert.equal(cancelled.campaignMonitoring,undefined);
 const active=observe({metric_config:null},{metrics:null});assert.ok(!active.warnings.some(s=>s.includes('timezone')),'known timezone is not blamed when the measurement plan is absent');
});
test('seven day ad delivery is saved without a goal and partial coverage stays unknown',()=>{
 const recentActivity={complete:true,window:{from:'2026-09-26',to:'2026-10-25',timezone:'Asia/Kolkata'},lastDeliveryAt:'2026-10-25',days:[
  {day:'2026-10-18',impressions:50,clicks:2,spend:10},
  {day:'2026-10-20',impressions:100,clicks:5,spend:20},
  {day:'2026-10-25',impressions:300,clicks:9,spend:40},
 ]};
 const out=observe({metric_config:null},{metrics:null,recentActivity});
 assert.equal(out.deliverySummary.impressions,400);
 assert.equal(out.deliverySummary.clicks,14);
 assert.equal(out.deliverySummary.spend,60);
 assert.equal(out.deliverySummary.from,'2026-10-19');
 assert.equal(out.outcome_state,'awaiting_data');
 assert.equal(observe({metric_config:null},{metrics:null,recentActivity:{...recentActivity,complete:false}}).deliverySummary,null);
 assert.equal(observe({metric_config:null},{metrics:null,recentActivity,coverage:{...coverage,complete:false}}).deliverySummary,null);
 assert.equal(observe({metric_config:null},{metrics:null,recentActivity:{...recentActivity,days:[]}}).deliverySummary.impressions,null);
});
