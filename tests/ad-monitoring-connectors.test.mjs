import test from 'node:test';
import assert from 'node:assert/strict';
import {adReportingWindow,googleAdMetrics,googlePerformanceMaxMetrics,googlePurchaseMap,metaPurchase,metaBudget} from '../src/lib/connectors/ad-monitoring-core.mjs';
test('reporting windows use account-local closed days across timezones',()=>{
  assert.deepEqual(adReportingWindow('Asia/Kolkata',new Date('2026-10-26T01:00:00Z')),{from:'2026-09-26',to:'2026-10-25'});
  assert.deepEqual(adReportingWindow('America/Los_Angeles',new Date('2026-10-26T01:00:00Z')),{from:'2026-09-25',to:'2026-10-24'});
  assert.throws(()=>adReportingWindow(''),/timezone/);
});
const action=(id,category)=>({conversionAction:{resourceName:id,category,status:'ENABLED',primaryForGoal:true}});
const row=(id,n,v)=>({segments:{date:'2026-10-25',conversionAction:id},campaign:{id:'1'},adGroupAd:{ad:{id:'2'}},metrics:{conversions:n,conversionsValue:v}});
test('only classified PURCHASE actions count; leads are never purchases',()=>{
  const p=googlePurchaseMap([action('buy','PURCHASE'),action('lead','SUBMIT_LEAD_FORM')],[row('lead',30,3000),row('buy',2,500)]);
  assert.equal(p.valid,true);assert.deepEqual([...p.totals.values()],[{purchases:2,revenue:500}]);
});
test('unknown conversion actions and absent purchase setup remain unknown',()=>{
  assert.equal(googlePurchaseMap([action('lead','SUBMIT_LEAD_FORM')],[]).valid,false);
  assert.equal(googlePurchaseMap([action('buy','PURCHASE')],[row('unmapped',1,20)]).valid,false);
  const base={...row('lead',10,1000),campaign:{id:'1',name:'Same display name'},metrics:{costMicros:'1000000',clicks:'20',impressions:'100'}};
  const [m]=googleAdMetrics([base],[],[],{id:'123',currency:'INR',timezone:'Asia/Kolkata'},{from:'2026-10-01',to:'2026-10-25'},'2026-10-26T00:00:00Z');
  assert.equal(m.purchases,null);assert.equal(m.revenue,null);assert.equal(m.conversion_definition,'unknown');assert.equal(m.spend,1);assert.equal(m.account_id,'123');
});
test('disabled and secondary purchase actions cannot justify zero-filling absent purchase rows',()=>{
 for(const change of [{status:'REMOVED'},{status:'HIDDEN'},{primaryForGoal:false}]) {
  const a=action('buy','PURCHASE');Object.assign(a.conversionAction,change);
  assert.equal(googlePurchaseMap([a],[]).valid,false);
 }
});
test('Performance Max delivery uses one campaign row per day and leaves purchases unknown',()=>{
 const account={id:'123',currency:'INR',timezone:'Asia/Kolkata'},window={from:'2026-10-20',to:'2026-10-25'},at='2026-10-26T00:00:00Z';
 const base={segments:{date:'2026-10-25'},campaign:{id:'99',name:'Performance Max'},metrics:{costMicros:'12500000',impressions:'1000',clicks:'40'}};
 const [m]=googlePerformanceMaxMetrics([base],account,window,at);
 assert.equal(m.ad_id,'pmax:99');assert.equal(m.spend,12.5);assert.equal(m.impressions,1000);assert.equal(m.clicks,40);
 assert.equal(m.purchases,null);assert.equal(m.revenue,null);assert.equal(m.conversion_definition,'unknown');
 assert.throws(()=>googlePerformanceMaxMetrics([{...base,metrics:{...base.metrics,impressions:null}}],account,window,at),/incomplete/);
});
test('Meta omitted purchases remain unknown, verified zero remains zero, unsupported budget units are not invented',()=>{
  assert.equal(metaPurchase(undefined),null);assert.equal(metaPurchase([{action_type:'lead',value:'20'}]),null);
  assert.equal(metaPurchase([{action_type:'purchase',value:'0'}]),0);
  assert.equal(metaBudget('50000','INR'),500);assert.equal(metaBudget('50000','UNKNOWN'),null);
});
