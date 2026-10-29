import test from 'node:test';
import assert from 'node:assert/strict';
import {headStageEvidence,rankHeadEvidence} from '../src/lib/automation/head-evidence.mjs';
import {eligibleHeadRoutes,routedHeadPlan} from '../src/lib/automation/head-routing-core.mjs';
const source=(data,extra={})=>({available:true,observed_at:'2026-10-27T00:00:00Z',coverage:'Recorded bounded sample; missing records are unknown.',data,...extra});
const snapshot={sync:source([{provider:'shopify'}]),products:source(Array.from({length:15},(_,i)=>({product_id:String(i),title:`Necklace ${i}`,stock:i===14?null:i,description:'Known details '.repeat(40)}))),performance:source({spend:1000,revenue:2000}),social:source([{caption:'Do not claim this is an approved promotion.'}]),competitors:source([],{available:false})};
test('planning sees source availability and summaries without repeating product rows',()=>{
 const plan=headStageEvidence(snapshot,{stage:'plan'});
 assert.equal(plan.sources.products.snapshotRows,15);assert.equal(plan.sources.products.data,undefined);assert.equal(plan.sources.competitors.available,false);
 assert.ok(JSON.stringify(plan).length<JSON.stringify(snapshot).length/2);assert.match(plan.contextCoverage,/No detailed rows/);
});
test('specialists receive assignment evidence with explicit omission coverage, preserving unknown stock',()=>{
 const before=structuredClone(snapshot),work=headStageEvidence(snapshot,{stage:'work',request:'Necklace 14',assignment:{task:'Write product copy for Necklace 14',deliverable:'One caption'}});
 assert.equal(work.products.data[0].product_id,'14');assert.equal(work.products.data[0].stock,null);
 assert.equal(work.performance,undefined);assert.equal(work.otherRecordedSources.performance.available,true);assert.equal(work.otherRecordedSources.competitors.available,false);
 assert.match(work.otherRecordedSources.performance.note,/not evidence of zero/);assert.deepEqual(snapshot,before);
});
test('review and independent QC retain all categories including contradictory or unavailable evidence',()=>{
 for(const stage of ['review','quality']){
  const review=headStageEvidence(snapshot,{stage,assignment:{task:'Write product copy'}});
  for(const key of Object.keys(snapshot))assert.ok(Object.hasOwn(review,key),`${stage}: ${key}`);
  assert.equal(review.competitors.available,false);assert.equal(review.performance.data.revenue,2000);
 }
});
test('rank before the snapshot row cap keeps a referenced product beyond the first five',()=>{
 assert.equal(rankHeadEvidence(snapshot,'Necklace 14').products.data[0].product_id,'14');
});
test('single-worker monthly sales requests retain the thirty-day source and explicit zero',()=>{
 const sources={...snapshot,productSales7d:source([{product_id:'14',units:0}]),productSales30d:source([{product_id:'14',units:12}])};
 const work=headStageEvidence(sources,{stage:'work',request:'Sales report for Necklace 14 last month'});
 assert.equal(work.productSales30d.data[0].units,12);assert.equal(work.productSales7d.data[0].units,0);
});
test('head specialists keep category ranking and enough rows to skip a sold-out Ring',()=>{
 const rows=Array.from({length:10},(_,i)=>({product_id:String(i+1),title:`Ring ${i+1}`,units:10-i,stock:i===4?0:10,image_url:`https://cdn.shopify.com/${i+1}.jpg`}));
 const category=source(rows,{sample:{order:'Exact Ring sales rank',top_rank_complete:true,truncated:true}});
 const ranked=rankHeadEvidence({sync:source([]),categorySales30d:category},'Make a five-card top-selling Ring carousel');
 assert.deepEqual(ranked.categorySales30d.data,rows);
 const work=headStageEvidence(ranked,{stage:'work',request:'Make a five-card top-selling Ring carousel',assignment:{task:'Select five products',deliverable:'Product list'}});
 assert.ok(work.categorySales30d.data.length>=6);
 assert.equal(work.categorySales30d.data[4].stock,0);
 assert.equal(work.categorySales30d.data[5].image_url,'https://cdn.shopify.com/6.jpg');
 assert.equal(work.categorySales30d.sample.top_rank_complete,true);
});
const candidates=[{agentId:'copywriter'},{agentId:'adsAnalyst'},{agentId:'sales'}];
test('Jev routing is eligible only for one available bounded template with no external execution',()=>{
 assert.equal(eligibleHeadRoutes({title:'Write three captions',brief:'Draft for a necklace.'},candidates)[0].agentId,'copywriter');
 for(const request of [
  {title:'Write captions and sales report'}, {title:'Launch ads with new captions'}, {title:'Make an image and captions'},
  {title:'Create a new strategy'}, {title:'Write captions',humanFeedback:'Change the original task'}, {title:'ക്യാപ്ഷൻ തയ്യാറാക്കുക'}
 ])assert.deepEqual(eligibleHeadRoutes(request,candidates),[]);
 assert.deepEqual(eligibleHeadRoutes({title:'Write captions'},[{agentId:'sales'}]),[]);
});
test('uncertain, general or forged Jev routes fall back to the responsible head planner',()=>{
 const request={title:'Write captions'},routes=eligibleHeadRoutes(request,candidates);
 const good={choice:'copy',confidence:.98,probabilities:{copy:.98,general:.02}};
 assert.equal(routedHeadPlan(good,routes,request).assignments[0].agentId,'copywriter');
 for(const answer of [{...good,confidence:.7},{...good,probabilities:{copy:.6,general:.4}},{...good,choice:'general'},{...good,choice:'invented'},{...good,confidence:NaN}])assert.equal(routedHeadPlan(answer,routes,request),null);
});
test('missing candidates cannot turn a mixed request into a single-template route',()=>{
 const request={title:'Write captions and sales report'};
 for(const available of [[{agentId:'copywriter'}],[{agentId:'sales'}],candidates,[]])assert.deepEqual(eligibleHeadRoutes(request,available),[]);
 assert.deepEqual(eligibleHeadRoutes({title:'Write captions'},[{agentId:'copywriter'}]),[{id:'copy',label:'A bounded copywriting draft only',agentId:'copywriter'}]);
});
