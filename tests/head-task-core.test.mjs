import test from 'node:test';
import assert from 'node:assert/strict';
import { headTaskRoster, selectHeadSpecialists, validateHeadPlan, validateHeadOutput, validateHeadReview, nextHeadWorker, resumeHeadWorkflow, compactHeadEvidence } from '../src/lib/automation/head-task-core.mjs';

const agent = (id, department_id='creative', extra={}) => ({ id, department_id, name:id, role_desc:'Creates useful work', enabled:true, is_lead:false, ...extra });
const people = [ {id:'head'}, {id:'copy'}, {id:'otherHead'}, {id:'hidden'}, {id:'off'}, {id:'human',human:true}, {id:'sync',model:'Scheduled job'} ];
const agents = [agent('head','creative',{is_lead:true}), agent('copy'), agent('otherHead','insights',{is_lead:true}),agent('hidden','perf'),agent('off','creative',{enabled:false}),agent('human'),agent('sync'),agent('invented')];
const plan = {understanding:'Write festival captions.',successCriteria:['Accurate, usable copy.'],assignments:[{agentId:'copy',task:'Write three captions.',deliverable:'Three captions.'}]};
const output = {summary:'Captions prepared.',body:'Three actual captions.',blocked:false,missing:[],warnings:[],evidenceSources:['Catalogue']};
const evidence = [{source:'Catalogue',detail:'Recorded sample, not live.'}];
const state = () => ({version:1,phase:'review',headAgentId:'head',plan,outputs:{copy:validateHeadOutput(output,evidence)},revisionRound:0,humanRevision:0});

test('roster permits authorized enabled real agents including peer heads, never people or sync bots',()=>{
  const roster=headTaskRoster(agents,people,'head',['creative','insights']);
  assert.equal(roster.head.id,'head');assert.deepEqual(roster.specialists.map(a=>a.id),['copy','otherHead']);
  assert.equal(headTaskRoster(agents,people,'head',['insights']).head,null);
  assert.equal(headTaskRoster(agents,people,'copy',['creative']).head,null);
  assert.equal(headTaskRoster(agents,people,'head',null).head,null);
});

test('plan accepts exact roster IDs and drops execution fields instead of converting them to actions',()=>{
  const valid=validateHeadPlan({...plan,actions:[{tool:'publish'}]},[agent('copy')]);
  assert.deepEqual(valid,plan);assert.equal(valid.actions,undefined);
  for(const assignments of [[],[...plan.assignments,...plan.assignments],[{...plan.assignments[0],agentId:'stranger'}],Array(3).fill(plan.assignments[0])]) {
    assert.throws(()=>validateHeadPlan({...plan,assignments},[agent('copy')]),/assignment|specific/);
  }
});

test('short or non-English briefs retain the head’s own specialists in the bounded roster',()=>{
  const many=[...Array.from({length:15},(_,i)=>agent(`lead${i}`,'insights',{is_lead:true})),agent('copy','creative',{role_desc:'Malayalam captions and creative writing'})];
  assert.equal(selectHeadSpecialists(many,'creative','തയ്യാറാക്കുക')[0].agentId,'copy');
  const ranked=selectHeadSpecialists([...many,agent('sales','insights',{role_desc:'Sales units and product forecasts'})],'creative','Review sales units and product forecasts');
  assert.equal(ranked[0].agentId,'sales');assert.ok(ranked.some(a=>a.agentId==='copy'));assert.equal(ranked.length,10);
});

test('worker output keeps actual evidence only and explicit missing inputs cannot be approved away',()=>{
  const result=validateHeadOutput({...output,blocked:false,missing:['Available stock'],evidenceSources:['Catalogue','Invented live lookup'],actions:[{kind:'send'}]},evidence);
  assert.equal(result.blocked,true);assert.deepEqual(result.evidence,evidence);assert.equal(result.actions,undefined);
  const s=state();s.outputs.copy=result;
  assert.equal(validateHeadReview({decision:'approve',note:'Looks fine',finalMarkdown:'Approved'},s).decision,'blocked');
  s.outputs={};assert.equal(validateHeadReview({decision:'approve',note:'Looks fine',finalMarkdown:'Approved'},s).decision,'blocked');
  assert.throws(()=>validateHeadOutput({...output,body:''},evidence),/complete deliverable/);
});

test('head review requires real final output and limits revisions to one existing specialist and one round',()=>{
  const s=state();
  assert.throws(()=>validateHeadReview({decision:'approve',note:'Fine',finalMarkdown:''},s),/final deliverable/);
  assert.equal(validateHeadReview({decision:'approve',note:'Meets criteria',finalMarkdown:'Final captions',revisionRequests:[{agentId:'hidden',instruction:'Send'}]},s).revisionRequests.length,0);
  assert.throws(()=>validateHeadReview({decision:'revise',note:'Fix',revisionRequests:[{agentId:'hidden',instruction:'Fix'}]},s),/unavailable/);
  assert.throws(()=>validateHeadReview({decision:'revise',note:'Fix',revisionRequests:[]},s),/exactly one/);
  s.revisionRound=1;
  assert.equal(validateHeadReview({decision:'revise',note:'Fix again',revisionRequests:[{agentId:'copy',instruction:'Again'}]},s).decision,'blocked');
});

test('durable stage selection runs only pending work or the explicit revision target',()=>{
  const s=state();s.plan={...plan,assignments:[...plan.assignments,{agentId:'otherHead',task:'Check evidence',deliverable:'Review'}]};
  assert.equal(nextHeadWorker(s).agentId,'otherHead');
  s.outputs.otherHead={...s.outputs.copy};assert.equal(nextHeadWorker(s),null);
  s.review={decision:'revise',revisionRequests:[{agentId:'copy',instruction:'Fix copy'}]};s.revisionRound=1;
  assert.equal(nextHeadWorker(s).agentId,'copy');s.outputs.copy.revision=1;assert.equal(nextHeadWorker(s),null);
});

test('explicit retry clears uncertain-call marker and only unresolved outputs, preserving peers',()=>{
  const s=state();s.phase='blocked';s.resumePhase='review';s.blockReason='Missing stock';s.pendingCall={phase:'review',agentId:'head'};
  s.outputs.copy={...s.outputs.copy,blocked:true,missing:['Stock']};s.outputs.otherHead={...s.outputs.copy,blocked:false,missing:[]};s.evidenceSnapshot={old:true};
  const resumed=resumeHeadWorkflow(s);
  assert.equal(resumed.phase,'work');assert.equal(resumed.outputs.copy,undefined);assert.ok(resumed.outputs.otherHead);
  assert.equal(resumed.pendingCall,undefined);assert.equal(resumed.evidenceSnapshot,undefined);assert.equal(resumed.blockReason,undefined);
  assert.ok(s.pendingCall,'caller object not mutated');
});

test('retry after atomic handoff failure preserves approved work and the handoff stage',()=>{
  const s=state();s.phase='handoff';s.review={decision:'approve',note:'Ready',finalMarkdown:'Final delivery',revisionRequests:[]};s.evidenceSnapshot={saved:true};
  const resumed=resumeHeadWorkflow(s);assert.deepEqual(resumed,s);assert.equal(resumed.phase,'handoff');assert.notEqual(resumed,s);
});

test('bounded evidence retains product quantities, unknown stock, period totals and missing-row coverage',()=>{
  const raw={products:{available:true,data:[],coverage:'No product sample rows does not establish zero stock.'},productSales7d:{available:true,observed_at:'2026-10-26',coverage:{stock_note:'Null is unknown; explicit 0 is recorded zero.'},summary:{units_all_recorded_products:174},data:[{product_id:'1',units:12,stock:null},{product_id:'2',units:7,stock:0}]}};
  const compact=compactHeadEvidence(raw);
  assert.equal(compact.productSales7d.summary.units_all_recorded_products,174);
  assert.deepEqual(compact.productSales7d.data.map(r=>r.stock),[null,0]);assert.equal(compact.products.data.length,0);
  assert.match(compact.contextCoverage,/unknown, never zero/);
  assert.equal(Object.hasOwn(compactHeadEvidence(compact),'0'),false);
});
