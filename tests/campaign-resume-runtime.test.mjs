import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as quality from '../src/lib/agents/quality-core.mjs';
import * as checkpoints from '../src/lib/agents/campaign-checkpoint-core.mjs';
import * as forecast from '../src/lib/agents/forecast-core.mjs';
import {AiBudgetError,isAiBudgetError} from '../src/lib/ai-budget-core.mjs';

const compile=file=>ts.transpileModule(readFileSync(new URL(`../src/lib/agents/${file}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const campaignCode=compile('campaign'),reportCode=compile('review'),designCode=compile('design');
const load=(code,modules)=>{const out={};new Function('exports','require',code)(out,key=>modules[key]||(key==='@/lib/artwork-mode.mjs'?{isChatGPTHandoff:()=>false}:key==='./agent-work'?{withAgentWork:(_scope,fn)=>fn()}:{}));return out;};
const proposed={name:'Recorded demand',occasion:'Season',headline:'Everyday jewellery',sub:'Explore the collection',product_ids:[1],budget_daily:100,days:7,channels:['meta'],split:'Meta',audiences:'Recorded regional audience',reasons:['Product 1 has recorded demand'],report:{why:'Recorded interest.',goal:'Test response without inventing a target.',data_used:[{source:'Shopify',finding:'Recorded product sales'}],how:['Use approved creative'],risks:['Incomplete coverage'],measure:'Recorded purchases and spend',impact:{budget_total:999999}}};

function harness(stage='create') {
  const h={tables:{agent_runs:[{id:'run',occasion:'Season',stage,status:'running',state:{plan:structuredClone(proposed)}}],campaigns:[],creatives:[],reports:[],product_stock:[{id:1,status:'ACTIVE',title:'Real product',product_type:'Necklace',price:1000,stock:5,stock_source:'shopify',image_url:'photo'}],products:[{id:1,title:'Real product',price:1000,image_url:'photo'}],job_locks:[],social_posts:[],competitors:[],competitor_moves:[]},calls:[],draws:0,events:[],deletes:0,instructions:'current',failWrite:null,answer:null,drawError:null,crashAfterImage:false,gemini:true,reportData:{spend:100,ad_revenue:300,revenue:1000,units:2},reuses:0};
  h.runRow=()=>h.tables.agent_runs[0];
  h.db={rpc:async(name,args)=>{
    if(name==='acquire_job_lock'){h.tables.job_locks=[{name:args.p_name,holder:args.p_holder,until:new Date(Date.now()+900000).toISOString()}];return {data:true,error:null};}
    if(name==='release_job_lock'){h.tables.job_locks=[];return {data:true,error:null};}
    return {data:name==='dashboard_report'?h.reportData:name==='sales_by_product'?[{product_id:1,title:'Product',units:2,revenue:1000}]:[],error:null};
  },from(table){let filters=[],action=null,payload=null,one=false,limit=Infinity,ignore=false;let promise;
    const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},gt:(k,v)=>{filters.push(r=>r[k]>v);return q;},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},not:()=>q,order:()=>q,limit:n=>{limit=n;return q;},or:()=>q,
      single:()=>{one=true;return q;},maybeSingle:()=>{one=true;return q;},update:v=>{action='update';payload=v;return q;},insert:v=>{action='insert';payload=v;return q;},upsert:(v,o)=>{action='insert';payload=v;ignore=!!o?.ignoreDuplicates;return q;},delete:()=>{h.deletes++;action='delete';return q;},
      then(resolve,reject){promise ||= Promise.resolve().then(()=>{
        h.tables[table] ||= [];const rows=h.tables[table];
        if(action && h.failWrite?.({table,action,payload}))return {data:null,error:new Error('Simulated write failure')};
        let found=rows.filter(r=>filters.every(fn=>fn(r))).slice(0,limit);
        if(action==='insert') {const duplicate=payload.id&&rows.find(r=>r.id===payload.id);if(duplicate&&ignore)found=[];else{const row={id:payload.id||crypto.randomUUID(),...(table==='reports'?{status:'lead_review',revision:1}:{}),...(table==='campaigns'?{status:'draft'}:{}),...structuredClone(payload)};rows.push(row);found=[row];}}
        if(action==='update')found.forEach(r=>Object.assign(r,structuredClone(payload)));
        if(action==='delete')h.tables[table]=rows.filter(r=>!found.includes(r));
        return {data:structuredClone(one?found[0]||null:found),error:null};
      });return promise.then(resolve,reject);},
    };return q;
  }};
  const people={persona:async(_db,agent,text)=>`${agent} ${h.instructions}: ${text}`,byId:{sales:{name:'Sales',room:'insights'},igScout:{name:'Scout',room:'insights'},analyticsLead:{name:'Analytics Lead'},human:{name:'Human'}},teamLead:()=> 'analyticsLead',HUMAN_HEAD:{insights:'human'}};
  const modules={'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>!!h.handoff},'node:crypto':crypto,'./quality-core.mjs':quality,'./campaign-checkpoint-core.mjs':checkpoints,'./forecast-core.mjs':forecast,'./people':people,'./events':{emit:async(...e)=>h.events.push(e)},'./memory':{loadMemory:async()=>{},pastResults:async()=>[]},'./branches':{branchBrief:async()=>[]},'./seo':{seoBrief:async()=>[]},'@/lib/usage':{withUsage:(_scope,fn)=>fn(),recordTaskUsageEvent:async()=>{h.reuses++;}},'@/lib/ai-budget':{isAiBudgetError},'@/lib/pause':{Paused:class extends Error{}},'./agent-instructions-core.mjs':{isAgentRuntimeError:()=>false},
    '@/lib/connectors/meta':{metaConfig:async()=>({ig:'account'}),competitorInstagram:async handle=>({followers_count:100,media:{data:[{timestamp:'2026-10-27',caption:`Recorded ${handle} post`,media_type:'IMAGE'}]}})},
    '@/lib/llm/gemini-config':{geminiConfigured:async()=>{h.configReads=(h.configReads||0)+1;return h.gemini;}},'@/lib/llm/openai':{chatJSON:async(tier,system,input)=>{h.calls.push({tier,system,input});if(h.answer)return h.answer({tier,system,input});return system.startsWith('strategist')?structuredClone(proposed):system.startsWith('copywriter')?{en:{headline:'Saved English',body:'English copy'},ml:{headline:'Saved Malayalam',body:'Malayalam copy'}}:system.startsWith('analyticsLead')?{decision:'forward',note:'Evidence checked'}:{title:'Sales finding',body:'Source-backed report'};}},
    './design':{prepareArtworkImport:async(_db,_source,id)=>{const row=h.tables.creatives.find(r=>r.id===id);if(row&&['queued','failed'].includes(row.art_status)){Object.assign(row,{art_status:'awaiting_import',queued_at:null,artwork_request_id:crypto.randomUUID()});return true;}return false;},drawItem:async(_db,_source,id)=>{h.draws++;if(h.drawError)throw h.drawError;const row=h.tables.creatives.find(r=>r.id===id);Object.assign(row,{image_path:'immutable.png',art_status:'ready',queued_at:null});if(h.crashAfterImage)throw new Error('Response lost after artifact saved');return true;}},
  };
  modules['./review']=load(reportCode,modules);
  const engine=load(campaignCode,modules);
  h.run=()=>engine.advance(h.db,'run');
  h.retry=()=>{Object.assign(h.runRow(),{status:'running',state:checkpoints.prepareCampaignRetry(h.runRow().state)});};
  return h;
}

test('a partial creative save resumes the same rows and copy without deleting or regenerating completed artwork',async()=>{
  const h=harness();let failed=false;
  h.failWrite=({table,action,payload})=>table==='creatives'&&action==='insert'&&payload.language==='ml'&&!failed&&(failed=true);
  await h.run();assert.equal(h.calls.length,1);assert.equal(h.tables.creatives.length,1);assert.equal(h.draws,0);
  const englishId=h.tables.creatives[0].id,dates={start_date:h.tables.campaigns[0].start_date,end_date:h.tables.campaigns[0].end_date};
  h.retry();await h.run();assert.equal(h.runRow().stage,'review');assert.equal(h.calls.length,1);assert.equal(h.tables.creatives.length,2);assert.equal(h.tables.creatives[0].id,englishId);assert.equal(h.draws,1);assert.equal(h.deletes,0);assert.deepEqual({start_date:h.tables.campaigns[0].start_date,end_date:h.tables.campaigns[0].end_date},dates);
});
test('saved ready image after a lost completion response is adopted without another generation',async()=>{
  const h=harness();h.crashAfterImage=true;await h.run();assert.equal(h.runRow().status,'failed');assert.equal(h.draws,1);assert.equal(checkpoints.campaignHasPendingCall(h.runRow().state),true);
  h.retry();await h.run();assert.equal(h.runRow().stage,'review');assert.equal(h.calls.length,1);assert.equal(h.draws,1);assert.equal(h.tables.creatives.length,2);assert.equal(checkpoints.campaignHasPendingCall(h.runRow().state),false);
});
test('legacy completed campaign rows are preserved with zero writer or image calls',async()=>{
  const h=harness();h.tables.campaigns.push({id:'old',run_id:'run',plan:structuredClone(proposed),status:'draft',start_date:'2026-10-01',end_date:'2026-10-08'});
  h.tables.creatives.push({id:'english',campaign_id:'old',kind:'banner',language:'en',headline:'Human-reviewed English',body:'Keep',image_path:'approved-version.png',art_status:'ready'}, {id:'malayalam',campaign_id:'old',kind:'banner',language:'ml',headline:'Human Malayalam',body:'Keep'});
  const before=structuredClone(h.tables.creatives);await h.run();assert.equal(h.runRow().stage,'review');assert.equal(h.calls.length,0);assert.equal(h.draws,0);assert.deepEqual(h.tables.creatives,before);assert.equal(h.deletes,0);
});
test('changed plan or instructions cannot overwrite previously saved creative artifacts',async()=>{
  const h=harness();let failed=false;h.failWrite=({table,action,payload})=>table==='creatives'&&action==='insert'&&payload.language==='ml'&&!failed&&(failed=true);
  await h.run();const saved=structuredClone(h.tables.creatives);h.instructions='new instruction';h.retry();await h.run();assert.equal(h.runRow().status,'failed');assert.equal(h.calls.length,1);assert.deepEqual(h.tables.creatives,saved);assert.match(h.runRow().error,/instructions or product facts changed/);
});
test('plan and qualitative proposal use one call and ignore model-supplied scenario arithmetic',async()=>{
  const h=harness('plan');await h.run();assert.equal(h.runRow().stage,'create');assert.equal(h.calls.length,1);assert.equal(h.runRow().state.plan.report.impact.budget_total,700);assert.equal(h.runRow().state.plan.report.impact.roas_basis,3);assert.equal(h.runRow().state.plan.report.impact.revenue_low,1575);
});
test('missing stock evidence blocks planning before inference; invalid product selection gets no repair call',async()=>{
  const missing=harness('plan');missing.tables.product_stock=[];await missing.run();assert.equal(missing.calls.length,0);
  const invalid=harness('plan');invalid.answer=()=>({...structuredClone(proposed),product_ids:[999]});await invalid.run();assert.equal(invalid.calls.length,1);assert.equal(invalid.runRow().status,'failed');assert.equal(invalid.runRow().stage,'plan');
});
test('report review budget wait resumes the saved writer and report row without duplicating either',async()=>{
  const h=harness('analyse');let fail=true;
  h.answer=({system})=>{if(system.startsWith('analyticsLead')){if(fail){fail=false;throw new AiBudgetError('Daily allowance',new Date(Date.now()+86400000).toISOString(),'daily_calls');}return {decision:'forward',note:'Checked source'};}return {title:'Saved report',body:'Evidence'};};
  await h.run();assert.equal(h.tables.reports.length,1);assert.equal(h.calls.length,2);assert.equal(h.runRow().state.retry.reason,'ai_budget');
  h.runRow().state.retry.at=new Date(Date.now()-1000).toISOString();await h.run();assert.equal(h.runRow().stage,'competitors');assert.equal(h.tables.reports.length,1);assert.equal(h.calls.length,3);assert.equal(h.tables.reports[0].status,'with_head');
});
test('a saved lead verdict survives report-write failure and still passes the actual gate on resume',async()=>{
  const h=harness('analyse');let failed=false;h.failWrite=({table,payload})=>table==='reports'&&payload.status==='with_head'&&!failed&&(failed=true);
  await h.run();assert.equal(h.calls.length,2);assert.equal(h.tables.reports[0].status,'lead_review');h.retry();await h.run();assert.equal(h.calls.length,2);assert.equal(h.tables.reports.length,1);assert.equal(h.tables.reports[0].status,'with_head');assert.equal(h.runRow().stage,'competitors');
});
test('review checkpoints reject unresolved corrections after one rewrite even across a retry',async()=>{
  const h=harness('analyse');let verdicts=0;
  h.answer=({system})=>system.startsWith('analyticsLead')?(verdicts++,{decision:'revise',note:'Source still missing'}):{title:'Draft',body:'Incomplete'};
  let failed=false;h.failWrite=({table,payload})=>table==='reports'&&payload.status==='rejected_by_lead'&&!failed&&(failed=true);
  await h.run();assert.equal(h.calls.length,4);h.retry();await h.run();assert.equal(h.calls.length,4);assert.equal(verdicts,2);assert.equal(h.tables.reports[0].status,'rejected_by_lead');assert.match(h.tables.reports[0].lead_note,/allowance exhausted/);assert.equal(h.runRow().state.insights.some(line=>line.includes('Incomplete')),false);
});
test('changed saved instructions invalidate writer and reviewer checkpoints instead of reusing old decisions',async()=>{
  const h=harness('analyse');let failed=false;h.failWrite=({table,payload})=>table==='reports'&&payload.status==='with_head'&&!failed&&(failed=true);
  await h.run();h.instructions='revised';h.retry();await h.run();assert.equal(h.calls.length,4);assert.equal(h.tables.reports.length,2);assert.equal(h.tables.reports[1].status,'with_head');
});

test('a later rival failure reuses the completed extraction and idempotent move row on explicit retry',async()=>{
  const h=harness('competitors');h.tables.competitors=[{id:'one',name:'One',instagram_handle:'one'},{id:'two',name:'Two',instagram_handle:'two'}];let failed=false;
  h.answer=({system,input})=>{
    if(system.startsWith('analyticsLead'))return {decision:'forward',note:'Verified evidence'};
    if(input.startsWith('Two')&&!failed){failed=true;throw new Error('Provider response lost');}
    return {kind:'creative',summary:'Recorded product post.',impact:'medium',confidence:.7};
  };
  await h.run();assert.equal(h.calls.length,2);assert.equal(h.tables.competitor_moves.length,1);assert.equal(h.runRow().status,'failed');
  const firstId=h.tables.competitor_moves[0].id;h.retry();await h.run();assert.equal(h.calls.length,4);assert.equal(h.tables.competitor_moves.length,2);assert.equal(h.tables.competitor_moves[0].id,firstId);assert.equal(h.runRow().stage,'plan');
});

test('a final stage-save failure reuses the combined plan without another model call',async()=>{
  const h=harness('plan');let failed=false;h.failWrite=({table,payload})=>table==='agent_runs'&&payload.stage==='create'&&!failed&&(failed=true);
  await h.run();assert.equal(h.calls.length,1);assert.equal(h.runRow().stage,'plan');h.retry();await h.run();assert.equal(h.runRow().stage,'create');assert.equal(h.calls.length,1);
});

test('stale campaign artwork with a pending attempt is not automatically generated again',async()=>{
  const h=harness();const at=new Date(Date.now()-20*60000).toISOString();h.runRow().state.checkpoints={version:1,entries:{'create.artwork':{status:'pending',startedAt:at,fingerprint:'saved'}}};
  h.tables.creatives.push({id:'asset',campaigns:{run_id:'run',status:'draft'},art_status:'making',queued_at:at,image_path:null});
  const design=load(designCode,{});const result=await design.drawItem(h.db,'creative','asset');assert.equal(result,false);assert.equal(h.tables.creatives[0].art_status,'failed');assert.match(h.tables.creatives[0].art_error,/explicitly retry/);
});
test('background catch-up cannot claim initial campaign artwork before its pending checkpoint is saved',async()=>{
  for (const status of ['running','failed']) {
    const h=harness();h.runRow().status=status;
    const row={id:'asset',campaigns:{run_id:'run',status:'draft'},art_status:'queued',queued_at:new Date(Date.now()-20*60000).toISOString(),image_path:null};
    h.tables.creatives.push(row);const before=structuredClone(row);let operations=0;
    const design=load(designCode,{'./memory':{loadMemory:async()=>{operations++;throw new Error('unexpected image operation');}},'@/lib/errors':{errText:e=>e.message}});
    assert.equal(await design.drawItem(h.db,'creative','asset'),false);
    await design.drainDesignQueue(h.db);
    assert.equal(operations,0);assert.deepEqual(h.tables.creatives[0],before);
  }
});
test('stale initial campaign artwork without a pending marker cannot repeat an unknown paid attempt',async()=>{
  const h=harness();h.tables.creatives.push({id:'asset',campaigns:{run_id:'run',status:'draft'},art_status:'making',queued_at:new Date(Date.now()-20*60000).toISOString(),image_path:null,redo_note:'An earlier explicit request'});
  let operations=0;const design=load(designCode,{'./memory':{loadMemory:async()=>{operations++;throw new Error('unexpected image operation');}},'@/lib/errors':{errText:e=>e.message}});
  assert.equal(await design.drawItem(h.db,'creative','asset'),false);assert.equal(operations,0);
  assert.equal(h.tables.creatives[0].art_status,'failed');assert.equal(h.tables.creatives[0].queued_at,null);assert.match(h.tables.creatives[0].art_error,/unknown outcome/);
});
test('an explicit note-free Studio request may start an initial campaign image once',async()=>{
  const h=harness();h.tables.creatives.push({id:'asset',campaigns:{run_id:'run',status:'draft'},art_status:'failed',queued_at:null,image_path:null});
  let operations=0;const design=load(designCode,{'./memory':{loadMemory:async()=>{operations++;throw new Error('entered explicit new artwork');}},'@/lib/errors':{errText:e=>e.message}});
  await design.queueRedesign(h.db,'creative','asset','');assert.match(h.tables.creatives[0].redo_note,/existing brief/);
  await assert.rejects(design.drawItem(h.db,'creative','asset'),/entered explicit new artwork/);assert.equal(operations,1);
  assert.equal(await design.drawItem(h.db,'creative','asset'),false);assert.equal(operations,1);
});
test('standalone Studio designs retain their existing queue path',async()=>{
  const h=harness();h.tables.designs=[{id:'design',status:'queued',format:'post',language:'en',brief:'Existing brief',product_ids:[]}];let operations=0;
  const design=load(designCode,{'./memory':{loadMemory:async()=>{operations++;throw new Error('entered standalone artwork');}},'@/lib/errors':{errText:e=>e.message}});
  await assert.rejects(design.drawItem(h.db,'design','design'),/entered standalone artwork/);assert.equal(operations,1);
});
test('a later explicit Studio redesign is allowed past the old pending campaign marker',async()=>{
  const h=harness();const at=new Date(Date.now()-20*60000).toISOString();h.runRow().state.checkpoints={version:1,entries:{'create.artwork':{status:'pending',startedAt:at,fingerprint:'saved'}}};
  h.tables.creatives.push({id:'asset',campaigns:{run_id:'run',status:'draft'},art_status:'queued',queued_at:new Date().toISOString(),image_path:'prior.png'});
  // Halt at the first actual design operation: reaching it proves the explicit request wasn't swallowed.
  const design=load(designCode,{'./memory':{loadMemory:async()=>{throw new Error('entered explicit new artwork');}},'@/lib/errors':{errText:e=>e.message}});
  await assert.rejects(design.drawItem(h.db,'creative','asset'),/entered explicit new artwork/);assert.equal(h.tables.creatives[0].image_path,'prior.png');
});

for (const provider of ['chatgpt','higgsfield','higgsfield_oauth']) test(`${provider} campaign handoff waits for import and fresh human Good review without image calls or repeated copy`,async()=>{
  const h=harness();h.handoff=true;h.gemini=false;
  await h.run();const en=h.tables.creatives.find(row=>row.language==='en');
  assert.equal(en.art_status,'awaiting_import');assert.ok(en.artwork_request_id);assert.equal(en.queued_at,null);
  assert.equal(h.runRow().status,'running');assert.equal(h.runRow().stage,'create');assert.equal(h.runRow().state.artworkWait.phase,'import');
  assert.equal(h.calls.length,1);assert.equal(h.draws,0);assert.equal(h.configReads||0,0);assert.equal(checkpoints.campaignHasPendingCall(h.runRow().state),false);
  await h.run();assert.equal(h.calls.length,1);assert.equal(h.draws,0);
  Object.assign(en,{image_path:'imported.png',art_status:'ready',artwork_origin:provider==='higgsfield_oauth'?provider:`${provider}_import`,imported_at:new Date(Date.now()-1000).toISOString()});
  await h.run();assert.equal(h.runRow().stage,'create');assert.equal(h.runRow().state.artworkWait.phase,'review');assert.equal(h.calls.length,1);
  await h.run();assert.equal(h.calls.length,1);assert.equal(h.runRow().state.stageFailures,undefined);
  h.tables.image_reviews.push({source:'creative',item_id:en.id,verdict:'good',updated_at:new Date(Date.now()-10_000).toISOString()});
  await h.run();assert.equal(h.runRow().stage,'create');assert.equal(h.runRow().state.artworkWait.phase,'review');assert.equal(h.calls.length,1,'a prior image review cannot release the imported replacement');
  h.tables.image_reviews[0].updated_at=new Date().toISOString();
  await h.run();assert.equal(h.runRow().stage,'review');assert.equal(h.runRow().state.artworkWait,undefined);assert.equal(h.calls.length,1);assert.equal(h.draws,0);
  assert.equal(h.runRow().state.checkpoints.entries['create.artwork'].value.image_path,'imported.png');
});

for (const provider of ['chatgpt','higgsfield','higgsfield_oauth']) test(`a campaign review cannot call compliance or the CMO while a ${provider} replacement is pending`,async()=>{
  const h=harness('review');h.handoff=true;h.runRow().state.campaign_id='campaign';
  h.tables.creatives.push({id:'pending',campaign_id:'campaign',headline:'Existing headline',body:'Existing copy',image_path:'previous.png',art_status:'awaiting_import',artwork_origin:provider==='higgsfield_oauth'?provider:`${provider}_import`});
  await h.run();assert.equal(h.runRow().stage,'review');assert.equal(h.runRow().status,'running');assert.equal(h.runRow().state.artworkWait.phase,'import');assert.equal(h.calls.length,0);assert.equal(h.draws,0);
});

test('active automatic generation blocks campaign review without a new model call',async()=>{
  const h=harness('review');h.handoff=true;h.runRow().state.campaign_id='campaign';
  h.tables.creatives.push({id:'pending',campaign_id:'campaign',headline:'Saved headline',body:'Saved copy',image_path:'previous.png',art_status:'generating',artwork_origin:'higgsfield_oauth'});
  await h.run();assert.equal(h.runRow().stage,'review');assert.equal(h.runRow().state.artworkWait.phase,'generation');assert.equal(h.calls.length,0);assert.equal(h.draws,0);
});
