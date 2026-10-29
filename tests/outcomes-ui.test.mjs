import test from 'node:test';
import assert from 'node:assert/strict';
import { stateLabel,stateTone,metricValue,optionalNumber,metricReadiness,initiativeDeadlines,outcomeHref,dateTimeIST,qualityStatus,initiativeState,campaignMonitoring,benchmarkSuggestion } from '../src/app/(app)/outcomes/outcomes-ui.mjs';

test('approval, implementation and business results keep independent labels and evidence requirements',()=>{
  assert.equal(stateLabel('approval','approved'),'Approved');
  assert.equal(stateLabel('execution','approved'),'Unknown');
  assert.equal(stateLabel('outcome','provider_confirmed'),'Unknown');
  assert.equal(stateTone('execution','provider_confirmed'),'acc');
  assert.equal(stateTone('outcome','awaiting_data'),'');
  assert.equal(stateLabel('outcome','ready_for_scaling_review'),'Ready for scaling review');
});

test('missing or nonnumeric observations are not converted to zero and currencies are not assumed',()=>{
  for(const value of [undefined,null,'0',NaN,Infinity,false])assert.equal(metricValue(value,'revenue'),'Not available');
  assert.equal(metricValue(0,'purchases'),'0');
  assert.equal(metricValue(0,'revenue'),'Currency units 0');
  assert.equal(metricValue(35.6,'cpa','USD'),'USD 35.6');
  assert.equal(metricValue(2.34,'ctr'),'2.34%');
  assert.equal(metricValue(1.5,'roas'),'1.5×');
});

test('unknown target and sample remain null; zero sample cannot unlock recommendations',()=>{
  assert.equal(optionalNumber(''),null);assert.equal(optionalNumber('  '),null);assert.equal(optionalNumber(null),null);
  assert.equal(optionalNumber('0',{min:0}),0);
  assert.throws(()=>optionalNumber('0',{integer:true,min:1}));
  for(const value of [false,{},NaN,'Infinity','2.5'])assert.throws(()=>optionalNumber(value,{integer:true,min:1,max:90}));
  assert.equal(metricReadiness({metric:'roas',target:0,minSample:1}).ready,true);
  assert.equal(metricReadiness({metric:'roas',target:null,minSample:null}).ready,false);
  assert.equal(metricReadiness({metric:'roas',target:2,minSample:0}).ready,false);
  assert.equal(metricReadiness({metric:'profit',target:2,minSample:100}).ready,false);
});

test('confirmed execution clears implementation overdue but an outcome review can still be due',()=>{
  const now=Date.parse('2026-10-26T10:00:00Z'),row={approval_state:'approved',execution_state:'not_started',outcome_state:'awaiting_data',due_at:'2026-10-25T00:00:00Z',next_review_at:'2026-10-26T00:00:00Z'};
  assert.deepEqual(initiativeDeadlines(row,now),{overdue:true,reviewDue:true});
  assert.deepEqual(initiativeDeadlines({...row,execution_state:'provider_confirmed'},now),{overdue:false,reviewDue:true});
  assert.deepEqual(initiativeDeadlines({...row,execution_state:'cancelled'},now),{overdue:false,reviewDue:false});
});

test('source links stay in the app and provider destinations reject executable, disguised and credential links',()=>{
  assert.equal(outcomeHref('/approvals?campaign=valid#campaign-valid',{internal:true}),'/approvals?campaign=valid#campaign-valid');
  assert.equal(outcomeHref('https://example.com/product',{internal:true}),null);
  assert.equal(outcomeHref('https://example.com/product'),'https://example.com/product');
  for(const value of ['javascript:alert(1)','data:text/plain,hello','//evil.example','/\\evil.example','https://user:secret@example.com',' https://example.com',null])assert.equal(outcomeHref(value),null);
});

test('stored dates round-trip to explicit IST fields, and invalid timestamps stay blank',()=>{
  assert.equal(dateTimeIST('2026-10-26T04:30:00Z'),'2026-10-26T10:00');
  assert.equal(dateTimeIST(null),'');assert.equal(dateTimeIST('not a date'),'');
});

test('historical QC passes do not display as a pass for changed work',()=>{
  assert.deepEqual(qualityStatus(null),{label:'Not recorded',tone:'',passed:false});
  assert.equal(qualityStatus({decision:'pass',current:true}).passed,true);
  assert.equal(qualityStatus({decision:'pass',current:false}).passed,false);
  assert.match(qualityStatus({decision:'pass',current:false}).label,/version changed/);
  assert.equal(qualityStatus({decision:'blocked',current:true}).passed,false);
  assert.equal(qualityStatus({decision:'revise',current:true}).label,'Correction requested');
});


test('external campaign inventory does not imply an AI Office proposal, approval or implementation',()=>{
  const external={source_kind:'provider_campaign',approval_state:'proposed',execution_state:'not_started',outcome_state:'awaiting_data'};
  assert.deepEqual(initiativeState(external,'approval'),{title:'Source',label:'External campaign',tone:''});
  assert.deepEqual(initiativeState(external,'execution'),{title:'Delivery evidence',label:'Provider observation',tone:''});
  assert.equal(initiativeState(external,'outcome').label,'Awaiting data');
  assert.equal(initiativeState({...external,approval_state:'approved',execution_state:'provider_confirmed'},'approval').label,'External campaign');
  assert.equal(initiativeState({...external,source_kind:'campaign'},'approval').label,'Proposed');
  assert.equal(initiativeState({...external,source_kind:'campaign'},'execution').label,'Not started');
});

test('campaign scope distinguishes inactive inventory, recorded delivery and unknown coverage',()=>{
  const empty=campaignMonitoring({});assert.equal(empty.mode,'scope_unknown');assert.equal(empty.complete,null);assert.equal(empty.recentDeliveryAt,null);
  const scope={mode:'current',reason:'recent_delivery',recentDeliveryAt:'2026-10-25',activityWindow:{from:'2026-09-26',to:'2026-10-25',timezone:'Asia/Kolkata'},activityComplete:true};
  const current=campaignMonitoring({campaignMonitoring:scope});assert.equal(current.label,'In monitoring');assert.match(current.detail,/does not establish delivery right now/);assert.equal(current.recentDeliveryAt,'2026-10-25');
  const inactive=campaignMonitoring({campaignMonitoring:{...scope,mode:'inventory_only',reason:'inactive_inventory',recentDeliveryAt:null}});
  assert.equal(inactive.label,'Inventory only');assert.equal(inactive.recentDeliveryAt,null);assert.match(inactive.detail,/complete checked activity window/);
  const partial=campaignMonitoring({campaignMonitoring:{mode:'scope_unknown',reason:'unknown_activity',activityComplete:false}});assert.match(partial.detail,/Inactivity has not been established/);assert.equal(partial.complete,false);
});


test('recent-data benchmark prefill needs explicit available bounded values and remains descriptive',()=>{
  assert.equal(benchmarkSuggestion({}),null);
  const settings={metric:'roas',direction:'higher',target:2.4,minSample:10,sampleMetric:'purchases',windowDays:14,maturityHours:48,maxDataAgeHours:48};
  const proposal={available:true,target:2.4,settings,baseline:{value:2.4,at:'2026-10-24T00:00:00Z',source:'Two provider windows'},recent:{value:2.4,purchases:20},previous:{value:2,purchases:15},reasons:[],warnings:['Provider attributed']};
  const ready=benchmarkSuggestion({benchmarkProposal:proposal});assert.equal(ready.available,true);assert.equal(ready.confidence,'descriptive_data_only');assert.deepEqual(ready.settings,settings);
  for(const patch of [{available:false},{target:3},{settings:{...settings,target:null}},{settings:{...settings,minSample:0}},{settings:{...settings,windowDays:100}},{baseline:{...proposal.baseline,value:null}}])assert.equal(benchmarkSuggestion({benchmarkProposal:{...proposal,...patch}}).available,false);
});
