import test from 'node:test';
import assert from 'node:assert/strict';
import { opportunityWindows, opportunityProductFacts, opportunityAdFacts, selectOpportunityLeads, normalizeOpportunityTurn, opportunityReviewDue,
  normalizeOpportunityReview, coordinateOpportunities, duplicateOpportunity, opportunityFailure, opportunityEvidenceFingerprint, opportunityEvidenceGate } from '../src/lib/agents/opportunities-core.mjs';

const leads = [
  {id:'analyticsLead',name:'Analytics',department_id:'insights',enabled:true,is_lead:true},
  {id:'perfLead',name:'Performance',department_id:'perf',enabled:true,is_lead:true},
  {id:'strategist',name:'Strategy',department_id:'strategy',enabled:true,is_lead:true},
  {id:'catalogLead',name:'Catalogue',department_id:'catalog',enabled:true,is_lead:true},
];
const facts = [{id:'product:42',category:'products',source:'Shopify',text:'Bangle 42 recorded 6 units during 2026-10-19 through 2026-10-25. Recorded stock: 724.'},
  {id:'ad:meta:a:5',category:'ads',source:'Meta',text:'Ad 5 recorded INR 900 spend and INR 0 attributed revenue over 3 observed days.'}];
const raw = (title='Investigate bangle demand',source=facts[0]) => ({summary:'Reviewed recorded demand and stock.',opportunities:[{
  title,finding:'Recorded sales justify a small merchandising investigation, not a demand guarantee.',
  evidence:[{sourceId:source.id,quote:source.text}],nextStep:'E-commerce head: review a product-page merchandising draft.',successMetric:'Compare recorded conversion after a bounded test.',priority:'normal',
}]});

test('a fresh result under the shared lease cancels stale scheduled selection while manual reviews can run',()=>{
  const now=Date.parse('2026-10-26T10:00:00Z');
  assert.equal(opportunityReviewDue('scheduled','2026-10-26T09:59:59Z',now),false);
  assert.equal(opportunityReviewDue('scheduled','2026-10-26T06:00:00Z',now),true);
  assert.equal(opportunityReviewDue('scheduled',null,now),true);
  assert.equal(opportunityReviewDue('manual','2026-10-26T09:59:59Z',now),true);
});

test('evidence fingerprint ignores observation clocks and row order but notices metrics, availability and guidance',()=>{
  const data={sources:[{name:'products',available:true,data:[{id:42,units:5,stock:null,updated_at:'first'},{id:43,units:7}]}],observedAt:'first',instructions:[{agent_id:'lead',revision:1}]};
  const changed=structuredClone(data);changed.observedAt='second';changed.sources[0].data.reverse();changed.sources[0].data[1].updated_at='second';
  const key=opportunityEvidenceFingerprint(data);assert.equal(key,opportunityEvidenceFingerprint(changed));
  for(const modify of [v=>{v.sources[0].data[0].stock=0;},v=>{v.sources[0].available=false;},v=>{v.instructions[0].revision=2;}]){const next=structuredClone(data);modify(next);assert.notEqual(key,opportunityEvidenceFingerprint(next));}
});

test('unchanged completed evidence skips indefinitely; failed attempts wait and fresh data bypasses the wait',()=>{
  const now=Date.parse('2026-10-26T10:00:00Z');
  assert.equal(opportunityEvidenceGate({completedFingerprint:'same'},'same',now),'unchanged');
  const failed={attemptFingerprint:'same',retryAfter:new Date(now+14400000).toISOString()};
  assert.equal(opportunityEvidenceGate(failed,'same',now),'backoff');
  assert.equal(opportunityEvidenceGate(failed,'fresh',now),'ready');
  assert.equal(opportunityEvidenceGate(failed,'same',now+14400000),'ready');
  assert.equal(opportunityEvidenceGate(null,'same',now),'ready');
});

test('opportunity windows exclude the current partial UTC day even after IST midnight',()=>{
  assert.deepEqual(opportunityWindows(new Date('2026-10-26T22:00:00Z')).current,{from:'2026-10-19',to:'2026-10-25'});
  assert.deepEqual(opportunityWindows(new Date('2026-10-26T22:00:00Z')).previous,{from:'2026-10-12',to:'2026-10-18'});
});

test('product evidence joins exact IDs, preserves stock zero and never assigns missing prior samples zero',()=>{
  const w=opportunityWindows(new Date('2026-10-26T10:00:00Z'));
  const current={available:true,data:[{product_id:'42',title:'Bangle',units:6,revenue:600,stock:0,stock_source:'odoo'},{product_id:'43',title:'Same Bangle',units:2,revenue:200,stock:null}]};
  const prior={available:true,data:[{product_id:'42',units:3},{product_id:'999',title:'Same Bangle',units:100}]};
  const rows=opportunityProductFacts(current,prior,w.current,w.previous);
  assert.match(rows[0].text,/3 recorded units/);assert.match(rows[0].text,/Recorded stock: 0; stock source: odoo/);
  assert.match(rows[1].text,/unknown; product absent/);assert.match(rows[1].text,/Recorded stock: unknown/);assert.doesNotMatch(rows[1].text,/100 recorded units/);
  assert.deepEqual(opportunityProductFacts({available:false},prior,w.current,w.previous),[]);
});

test('ad evidence separates platform and account IDs, keeps zero return and labels partial samples',()=>{
  const w={from:'2026-10-19',to:'2026-10-25'};
  const rows=opportunityAdFacts([
    {day:'2026-10-20',platform:'meta',account_id:'one',ad_id:'5',spend:20,revenue:0,purchases:0},
    {day:'2026-10-21',platform:'meta',account_id:'one',ad_id:'5',spend:30,revenue:0,purchases:0},
    {day:'2026-10-21',platform:'meta',account_id:'two',ad_id:'5',spend:100,revenue:400,purchases:2},
    {day:'2026-10-26',platform:'meta',account_id:'one',ad_id:'5',spend:999,revenue:999,purchases:99},
  ],true,w);
  assert.equal(rows.length,2);
  assert.match(rows.find(row=>row.id==='ad:meta:one:5').text,/INR 50.00 spend, INR 0.00/);
  assert.match(rows.find(row=>row.id==='ad:meta:one:5').text,/2 observed days/);
  assert.match(rows[0].limitation,/truncated/);
});

test('relevant enabled leads rotate without selecting disabled, human or nonlead agents',()=>{
  const roster=[...leads,{...leads[0],id:'disabled',enabled:false},{...leads[0],id:'staff',is_lead:false}];
  const first=selectOpportunityLeads(roster,facts);assert.equal(first.length,2);
  const next=selectOpportunityLeads(roster,facts,first.map(lead=>lead.id));assert.equal(next.length,2);
  assert.ok(next.every(lead=>!first.some(old=>old.id===lead.id)));
  assert.ok([...first,...next].every(lead=>!['disabled','staff'].includes(lead.id)));
});

test('rotation reaches all relevant departments rather than alternating the same two pairs',()=>{
  const roster=[...leads,{...leads[0],id:'seoLead',department_id:'seo'},{...leads[0],id:'creativeDirector',department_id:'creative'}];
  const broad=[...facts,{id:'search:one',category:'search'},{id:'social:one',category:'social'},{id:'calendar:one',category:'calendar'}];
  let recent=[];const picked=[];
  for(let turn=0;turn<3;turn++){const ids=selectOpportunityLeads(roster,broad,recent).map(lead=>lead.id);picked.push(...ids);recent=[...ids,...recent];}
  assert.equal(new Set(picked).size,6);
  assert.deepEqual(new Set(selectOpportunityLeads(roster,broad,recent).map(lead=>lead.id)),new Set(picked.slice(0,2)));
});

test('unrecognized references and invented quotes cannot become report candidates',()=>{
  const wrong=raw();wrong.opportunities[0].evidence=[{sourceId:'invented',quote:facts[0].text},{sourceId:facts[0].id,quote:'This product sold 9999 units.'}];
  assert.equal(normalizeOpportunityTurn(wrong,leads[0],facts).candidates.length,0);
  const result=normalizeOpportunityTurn(raw(),leads[0],facts);assert.equal(result.candidates.length,1);
  assert.throws(()=>normalizeOpportunityTurn({opportunities:[]},leads[0],facts),/invalid/);
});

test('CMO can only review real candidate IDs and duplicate decisions are ignored',()=>{
  const candidates=normalizeOpportunityTurn(raw(),leads[0],facts).candidates;
  const review=normalizeOpportunityReview({summary:'Review complete',decisions:[{candidateId:'fake',decision:'forward',note:'wrong'},{candidateId:candidates[0].id,decision:'forward',note:'Supported'},{candidateId:candidates[0].id,decision:'forward',note:'Repeated'}]},candidates);
  assert.equal(review.decisions.length,1);
});

test('real sequential lead contributions feed CMO review before any report is forwarded',async()=>{
  const calls=[],saved=[],sent=[];
  const result=await coordinateOpportunities({leads:leads.slice(0,2),facts,recent:[],
    ask:async(lead,step)=>{calls.push({lead:lead?.id,step});if(lead)return raw(lead.id,lead.id==='perfLead'?facts[1]:facts[0]);
      return {summary:'Both leads found distinct supported next steps.',decisions:step.candidates.map(candidate=>({candidateId:candidate.id,decision:'forward',note:'Supported; requires human decision.'}))};},
    saveTurn:async turn=>saved.push(turn),saveReview:async review=>saved.push(review),forward:async candidate=>sent.push(candidate),
  });
  assert.equal(calls.length,3);assert.equal(calls[1].step.previousTurns.length,1);assert.equal(calls[2].step.turns.length,2);
  assert.deepEqual(calls[2].step.facts,facts);
  assert.ok(calls[2].step.turns.every(turn=>!Object.hasOwn(turn,'candidates')));
  assert.deepEqual(calls[2].step.turns.flatMap(turn=>turn.candidateIds),calls[2].step.candidates.map(candidate=>candidate.id));
  assert.equal(saved.length,3);assert.equal(sent.length,2);assert.equal(result.forwarded.length,2);
});

test('lead inputs preserve relevant source limitations and explicit gaps without unrelated domains',async()=>{
  const gap={id:'gap:ads',category:'data_gap',source:'Reader',text:'Ad evidence is unavailable, not zero.',limitation:'Retry the source read before making an ad-performance claim.'};
  const relevant={...facts[0],dateFrom:'2026-10-19',dateTo:'2026-10-25',observedAt:'2026-10-26T10:00:00Z',limitation:'Bounded sample; missing products are not zero.'};
  const ownAlert={id:'alert:insights',category:'alerts',departmentId:'insights',source:'Watcher',text:'Verify a change in recorded product sales.'};
  const otherAlert={...ownAlert,id:'alert:perf',departmentId:'perf'};
  const all=[relevant,facts[1],gap,ownAlert,otherAlert,{id:'social:1',category:'social',source:'Instagram',text:'A social post had twelve saves.'}];
  const calls=[];
  const result=await coordinateOpportunities({leads:[leads[0]],facts:all,
    ask:async(lead,step)=>{calls.push(step);return lead?raw('Investigate current demand',relevant):{summary:'The supplied sample supports a bounded investigation.',decisions:step.candidates.map(candidate=>({candidateId:candidate.id,decision:'forward',note:'Preserve the sample limitation.'}))};},
    saveTurn:async()=>{},saveReview:async()=>{},forward:async()=>{},
  });
  assert.deepEqual(calls[0].facts,[relevant,gap,ownAlert]);
  assert.deepEqual(calls[0].evidenceCoverage.includedFacts,3);assert.equal(calls[0].evidenceCoverage.omittedFacts,3);
  assert.match(calls[0].evidenceCoverage.note,/omitted, not unavailable or zero/);
  assert.deepEqual(calls[1].facts,all);
  assert.equal(result.forwarded.length,1);
});

test('a quote from a globally valid but unsupplied source cannot become a lead candidate',async()=>{
  let cmoCalls=0,forwarded=0;const saved=[];
  const result=await coordinateOpportunities({leads:[leads[0]],facts,
    ask:async(lead,step)=>{
      if(!lead){cmoCalls++;throw new Error('No valid candidate should reach CMO inference.');}
      assert.deepEqual(step.facts,[facts[0]]);
      return raw('Attempted out-of-scope ad finding',facts[1]);
    },saveTurn:async turn=>saved.push(turn),saveReview:async review=>saved.push(review),forward:async()=>{forwarded++;},
  });
  assert.equal(cmoCalls,0);assert.equal(forwarded,0);assert.equal(saved[0].candidates.length,0);
  assert.equal(saved.length,2);assert.deepEqual(saved[1].decisions,[]);assert.deepEqual(result.forwarded,[]);
});

test('department-scoped alerts do not select another department with no relevant evidence',()=>{
  const alerts=[{id:'alert:creative',category:'alerts',departmentId:'creative',source:'Watcher',text:'Verify a creative handoff.'}];
  assert.deepEqual(selectOpportunityLeads(leads,alerts),[]);
  assert.deepEqual(selectOpportunityLeads(leads,[{...alerts[0],departmentId:'perf'}]).map(lead=>lead.id),['perfLead']);
});

test('repeated titles or evidence are suppressed and a CMO skip produces no report',async()=>{
  const original=normalizeOpportunityTurn(raw(),leads[0],facts).candidates[0];
  const renamed=normalizeOpportunityTurn(raw('A paraphrased title'),leads[0],facts).candidates[0];
  assert.equal(duplicateOpportunity(renamed,[original]),true);
  let forwarded=0;
  const result=await coordinateOpportunities({leads:leads.slice(0,2),facts,recent:[original],ask:async(lead,step)=>lead?raw(lead.id,lead.id==='perfLead'?facts[1]:facts[0]):
    {summary:'Existing opportunity already covers this.',decisions:step.candidates.map((candidate,i)=>({candidateId:candidate.id,decision:i?'skip':'forward',note:'Existing report or too weak.'}))},
    saveTurn:async()=>{},saveReview:async()=>{},forward:async()=>{forwarded++;},
  });
  assert.equal(forwarded,0);assert.equal(result.duplicates.length,1);
});

test('a provider failure preserves prior completed lead work and never fabricates a CMO/report',async()=>{
  const saved=[];let calls=0,forwarded=0;
  await assert.rejects(coordinateOpportunities({leads:leads.slice(0,2),facts,ask:async()=>{if(++calls===2)throw new Error('provider private response');return raw();},
    saveTurn:async turn=>saved.push(turn),saveReview:async()=>{throw new Error('must not review');},forward:async()=>{forwarded++;},
  }),/provider private/);
  assert.equal(saved.length,1);assert.equal(calls,2);assert.equal(forwarded,0);
  assert.doesNotMatch(opportunityFailure(new Error('token=private')),/token|private/);
});

test('no defensible opportunities is a valid completed review with no pretend reports',async()=>{
  let forwarded=0,leadCalls=0,cmoCalls=0;const reviews=[];
  const result=await coordinateOpportunities({leads:leads.slice(0,2),facts,ask:async lead=>{
    if(!lead){cmoCalls++;throw new Error('Empty candidates must not spend CMO inference.');}
    leadCalls++;return {summary:'Data reviewed; no defensible new recommendation.',opportunities:[]};
  },saveTurn:async()=>{},saveReview:async review=>reviews.push(review),forward:async()=>{forwarded++;}});
  assert.equal(leadCalls,2);assert.equal(cmoCalls,0);assert.equal(forwarded,0);assert.equal(result.forwarded.length,0);
  assert.equal(reviews.length,1);assert.deepEqual(reviews[0].decisions,[]);assert.match(reviews[0].summary,/No CMO review or reports were needed/);
});
