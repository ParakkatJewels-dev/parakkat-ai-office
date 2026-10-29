import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recommendCampaignBenchmark} from '../src/lib/outcomes/benchmarks.mjs';
const now=new Date('2026-10-26T12:00:00Z');
const campaign={selected:true,currency:'INR',account_timezone:'Asia/Kolkata',details:{metrics_supported:true}};
const coverage={selected:true,complete:true,status:'complete',last_success_at:now.toISOString(),coverage:{metrics_complete:true,window_from:'2026-09-26',window_to:'2026-10-25'}};
const days=Array.from({length:28},(_,i)=>({day:new Date(Date.parse('2026-09-26T00:00:00Z')+i*864e5).toISOString().slice(0,10),spend:i<14?100:200,revenue:i<14?200:600,purchases:2,rowCount:1,delivered:true,purchaseKnown:true,currency:'INR',timezoneKnown:true,allRefreshed:true,oldestRefresh:now.toISOString()}));
const activity={complete:true,window:{from:'2026-09-26',to:'2026-10-25',timezone:'Asia/Kolkata'},days};
const recommend=(extra={})=>recommendCampaignBenchmark(extra.campaign||campaign,extra.coverage||coverage,extra.activity||activity,extra.now||now);
test('proposes a weighted recent ROAS baseline from two complete mature windows without inventing uplift or profit',()=>{
 const out=recommend();assert.equal(out.available,true);assert.equal(out.target,3);assert.equal(out.previous.value,2);assert.deepEqual([out.recent.from,out.recent.to,out.previous.from,out.previous.to],['2026-10-10','2026-10-23','2026-09-26','2026-10-09']);
 assert.equal(out.settings.minSample,10);assert.equal(out.settings.maturityHours,48);assert.equal(out.baseline.value,3);assert.equal(out.requiresHumanReview,true);assert.equal(out.confidence,'descriptive_data_only');assert.match(out.warnings.join(' '),/operational safeguards, not statistical confidence/);assert.match(out.warnings.join(' '),/No spend or campaign change/);
});
test('ratio of sums is used instead of averaging daily ratios or adding an arbitrary target uplift',()=>{
 const changed=days.map(d=>({...d}));changed[14].spend=2000;changed[14].revenue=1000;
 const out=recommend({activity:{...activity,days:changed}});assert.equal(out.target,(1000+13*600)/(2000+13*200));assert.notEqual(out.target,(0.5+13*3)/14);
});
test('unknown purchase rows, conflicting currency, stale rows or unknown timezone block proposed targets',()=>{
 for(const patch of [{purchaseKnown:false},{revenue:null},{purchases:null},{currency:'USD'},{timezoneKnown:false},{allRefreshed:false},{oldestRefresh:'2026-10-01T00:00:00Z'}]){const changed=days.map((d,i)=>i===0?{...d,...patch}:d);const out=recommend({activity:{...activity,days:changed}});assert.equal(out.available,false);assert.equal(out.target,null);assert.equal(out.settings,null);assert.ok(out.reasons.length);}
});
test('partial, incomplete or stale coverage cannot produce a target even when visible rows look strong',()=>{
 for(const extra of [{activity:{...activity,complete:false}},{coverage:{...coverage,complete:false}},{coverage:{...coverage,status:'partial'}},{coverage:{...coverage,last_success_at:'2026-10-01T00:00:00Z'}},{coverage:{...coverage,coverage:{...coverage.coverage,window_from:'2026-09-27'}}},{campaign:{...campaign,account_timezone:null}},{campaign:{...campaign,currency:null}},{campaign:{...campaign,details:{metrics_supported:false}}}])assert.equal(recommend(extra).available,false);
});
test('sample safeguards are explicit and exclude weak periods without asserting statistical confidence',()=>{
 const fewDays=days.map((d,i)=>({...d,delivered:i%14<6}));assert.equal(recommend({activity:{...activity,days:fewDays}}).available,false);
 const fewPurchases=days.map(d=>({...d,purchases:0.5}));assert.equal(recommend({activity:{...activity,days:fewPurchases}}).available,false);
 const noSpend=days.map(d=>({...d,spend:0}));assert.equal(recommend({activity:{...activity,days:noSpend}}).available,false);
});
test('unmatured recent rows do not enter either comparison window',()=>{
 const extra={...days[0],day:'2026-10-25',purchaseKnown:false,revenue:null};assert.equal(recommend({activity:{...activity,days:[...days,extra]}}).available,true);
});

test('finite row values cannot produce a proposal with overflowing sums or ratios',()=>{
 for(const patch of [{spend:1e308},{revenue:1e308},{purchases:1e308},{spend:1e-308,revenue:1e100}]){
  const out=recommend({activity:{...activity,days:days.map(d=>({...d,...patch}))}});assert.equal(out.available,false);assert.equal(out.target,null);assert.equal(out.settings,null);assert.ok(out.recent.value===null||Number.isFinite(out.recent.value));
 }
});
