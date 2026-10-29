import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readRecentCampaignActivity} from '../src/lib/outcomes/recent-activity.mjs';
const now=new Date('2026-10-26T12:00:00Z');
const campaign=(id='c1',extra={})=>({provider:'meta',account_id:'a1',campaign_id:id,account_timezone:'Asia/Kolkata',...extra});
const row=(extra={})=>({platform:'meta',account_id:'a1',campaign_id:'c1',day:'2026-10-25',spend:10,impressions:100,clicks:1,...extra});
function dbFor(rows,failAt=Infinity){const calls=[];return {calls,from(table){assert.equal(table,'ad_insights_daily');let range;const q={select(){return q;},gte(k,v){calls.push(['gte',k,v]);return q;},lte(k,v){calls.push(['lte',k,v]);return q;},not(){return q;},or(){return q;},order(){return q;},range(a,b){range=[a,b];calls.push(['range',a,b]);return q;},abortSignal:async()=>range[0]>=failAt?{error:{message:'Incomplete'}}:{data:rows.slice(range[0],range[1]+1)}};return q;}};}
test('one paginated local read separates stable campaign identities and excludes old, open-day and zero activity',async()=>{
 const db=dbFor([row({day:'2023-01-01'}),row({day:'2026-10-26'}),row({spend:0,impressions:0,clicks:0}),row(),row({account_id:'a2',day:'2026-10-24'}),row({campaign_id:'c2',day:'2026-10-20'})]);
 const a=campaign(),b=campaign('c1',{account_id:'a2'}),c=campaign('c2');const out=await readRecentCampaignActivity(db,[a,b,c],{now,pageSize:2});
 assert.equal(out.complete,true);assert.equal(out.forCampaign(a).lastDeliveryAt,'2026-10-25');assert.equal(out.forCampaign(b).lastDeliveryAt,'2026-10-24');assert.equal(out.forCampaign(c).lastDeliveryAt,'2026-10-20');assert.deepEqual(out.forCampaign(a).window,{from:'2026-09-26',to:'2026-10-25',timezone:'Asia/Kolkata'});
 assert.ok(db.calls.some(c=>c[0]==='gte'&&c[2]==='2026-09-26'));
});
test('row bounds and query failures never establish absent recent delivery for unobserved campaigns',async()=>{
 const a=campaign(),b=campaign('other');const limited=await readRecentCampaignActivity(dbFor([row(),row(),row()]),[a,b],{now,pageSize:2,maxRows:2});
 assert.equal(limited.complete,false);assert.equal(limited.rowsRead,2);assert.equal(limited.forCampaign(b).complete,false);assert.equal(limited.forCampaign(a).lastDeliveryAt,'2026-10-25');
 const failed=await readRecentCampaignActivity(dbFor([row(),row(),row()],2),[a,b],{now,pageSize:2});assert.equal(failed.complete,false);assert.equal(failed.forCampaign(b).complete,false);
});
test('missing provider timezone cannot turn an absent row into verified inactive inventory',async()=>{
 const c=campaign('c1',{account_timezone:null}),db=dbFor([]),out=await readRecentCampaignActivity(db,[c],{now});assert.equal(out.forCampaign(c).complete,false);assert.equal(out.forCampaign(c).window,null);assert.equal(db.calls.length,0);
});
test('shared activity read aggregates daily rows with null propagation for benchmark evidence',async()=>{
 const c=campaign(),base={purchases:2,revenue:50,conversion_definition:'purchase',data_updated_at:now.toISOString(),currency:'INR',account_timezone:'Asia/Kolkata'};
 const out=await readRecentCampaignActivity(dbFor([row(base),row({...base,spend:20,revenue:70}),row({...base,day:'2026-10-24',purchases:null,conversion_definition:'unknown'})]),[c],{now});
 const facts=out.forCampaign(c);assert.equal(facts.days.length,2);assert.equal(facts.days[1].spend,30);assert.equal(facts.days[1].revenue,120);assert.equal(facts.days[1].purchases,4);assert.equal(facts.days[1].purchaseKnown,true);assert.equal(facts.days[0].purchaseKnown,false);assert.equal(facts.days[0].purchases,null);
});
