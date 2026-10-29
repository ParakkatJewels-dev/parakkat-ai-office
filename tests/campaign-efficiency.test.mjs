import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as quality from '../src/lib/agents/quality-core.mjs';
import * as checkpoints from '../src/lib/agents/campaign-checkpoint-core.mjs';
import { AiBudgetError, isAiBudgetError } from '../src/lib/ai-budget-core.mjs';

const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/agents/campaign.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(stage,options={}) {
  const state={run:{id:'run',occasion:'Fixture campaign',stage,status:'running',state:{}},calls:[],reports:[],moves:[],classifications:0,events:[],feedReads:[]};
  const db={rpc:async name=>({data:name==='sales_by_product'?(options.sales||[]):name==='ad_rollup'?(options.ads||[]):true,error:null}),from:table=>{
    let change,insert,single=false;const q={select:()=>q,eq:()=>q,gt:()=>q,order:()=>q,limit:()=>q,not:()=>q,update:value=>{change=value;return q;},insert:value=>{insert=value;return q;},upsert:value=>{insert=value;return q;},single:()=>{single=true;return q;},maybeSingle:()=>{single=true;return q;},then:(resolve,reject)=>Promise.resolve().then(()=>{
      if(change&&table==='agent_runs')Object.assign(state.run,structuredClone(change));
      if(insert&&table==='competitor_moves')state.moves.push(insert);
      return {data:table==='agent_runs'?structuredClone(state.run):table==='job_locks'?{name:'campaign:run'}:table==='competitors'?(options.rivals||[]):table==='social_posts'?(options.posts||[]):single?null:[],error:null};
    }).then(resolve,reject)};return q;
  }};
  const modules={
    '@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>false},'node:crypto':crypto,'./quality-core.mjs':quality,'./memory':{loadMemory:async()=>{}},'./branches':{branchBrief:async()=>options.branches||[]},
    './people':{persona:async(_db,who,text)=>`${who}: ${text}`},'./events':{emit:async(...args)=>state.events.push(args)},
    '@/lib/usage':{withUsage:(_scope,fn)=>fn(),recordTaskUsageEvent:async()=>{}},'@/lib/ai-budget':{isAiBudgetError},'@/lib/pause':{Paused:class extends Error{}},
    './agent-instructions-core.mjs':{isAgentRuntimeError:()=>false},
    '@/lib/connectors/meta':{metaConfig:async()=>({ig:'fixture'}),competitorInstagram:async handle=>{state.feedReads.push(handle);return {followers_count:100,media:{data:options.media?.[handle]||[]}};}},
    '@/lib/llm/openai':{chatJSON:async(tier,system,input,callOptions)=>{state.calls.push({tier,system,input,callOptions});if(options.modelError)throw options.modelError;if(options.answer)return options.answer({tier,system,input,callOptions});return options.modelOutput||{kind:'creative',summary:'The recorded post features a necklace.',impact:'medium',confidence:.7,title:'Source finding',body:'Grounded finding'};}},
    '@/lib/llm/jev':{classify:async()=>{state.classifications++;throw new Error('A separate competitor classification must not run');}},
    './review':{fileReport:async(_db,_run,who,draft,context)=>{state.reports.push({who,draft,context});return {...draft,status:'with_head'};}},
  };
  const exports={};new Function('exports','require',compiled)(exports,id=>modules[id]||(id==='./campaign-checkpoint-core.mjs'?checkpoints:{}));
  return {state,run:()=>exports.advance(db,'run')};
}
test('missing campaign sources produce explicit unknown coverage without writer or report-review calls',async()=>{
  const h=harness('analyse');await h.run();assert.equal(h.state.run.stage,'competitors');assert.equal(h.state.calls.length,0);assert.equal(h.state.reports.length,0);
  assert.equal(h.state.run.state.insights.length,3);assert.ok(h.state.run.state.insights.every(note=>/unknown/.test(note)));assert.doesNotMatch(h.state.run.state.insights.join(' '),/zero|no demand/);
});
test('recorded zero-valued metrics still receive real analyst and report review while absent sources are skipped',async()=>{
  const h=harness('analyse',{ads:[{platform:'meta',campaign_name:'Recorded campaign',ad_name:'Recorded ad',spend:0,purchases:0,revenue:0}]});await h.run();
  assert.equal(h.state.calls.length,1);assert.match(h.state.calls[0].system,/adsAnalyst/);assert.equal(h.state.reports.length,1);assert.equal(h.state.reports[0].who,'adsAnalyst');assert.match(h.state.calls[0].input,/0 purchases/);
  assert.equal(h.state.run.state.insights.length,3);
});
test('empty competitor feeds avoid both extraction and report-review inference and preserve unknown activity',async()=>{
  const h=harness('competitors',{rivals:[{id:'rival',name:'Rival',instagram_handle:'rival'}]});await h.run();
  assert.equal(h.state.calls.length,0);assert.equal(h.state.reports.length,0);assert.equal(h.state.moves.length,0);assert.match(h.state.run.state.competitors[0],/activity is unknown/);
});
test('competitor extraction and impact share one bounded call per nonempty source and retain report review',async()=>{
  const posts=Array.from({length:20},(_,i)=>({timestamp:'2026-10-26',media_type:'IMAGE',like_count:i,caption:`Post ${i}: `+'long caption '.repeat(100)}));
  const h=harness('competitors',{rivals:[{id:'rival',name:'Rival',instagram_handle:'rival'},{id:'empty',name:'Empty',instagram_handle:'empty'}],media:{rival:posts}});await h.run();
  assert.equal(h.state.calls.length,1);assert.equal(h.state.classifications,0);assert.equal(h.state.calls[0].callOptions.maxOutputTokens,1200);assert.match(h.state.calls[0].input,/sample of 8/);assert.doesNotMatch(h.state.calls[0].input,/Post 8:/);
  assert.equal(h.state.moves.length,1);assert.deepEqual(h.state.moves[0].raw,{impact:'medium'});assert.equal(h.state.reports.length,1);assert.match(h.state.reports[0].context,/activity is unknown/);
});
test('malformed competitor verdicts cannot become saved evidence or reviewed findings',async()=>{
  for(const modelOutput of [null,{kind:'invented',summary:'Claim',impact:'medium',confidence:.5},{kind:'creative',summary:'Claim',impact:'medium',confidence:2},{kind:'creative',summary:'',impact:'high',confidence:.5}]) {
    const h=harness('competitors',{rivals:[{id:'rival',name:'Rival',instagram_handle:'rival'}],media:{rival:[{caption:'Recorded post'}]},modelOutput:modelOutput===null?{}:modelOutput});await h.run();
    assert.equal(h.state.moves.length,0);assert.equal(h.state.reports.length,0);assert.match(h.state.run.state.competitors[0],/could not read/);
  }
});
test('budget refusal stops scanning further competitors and retains the rolling retry guard',async()=>{
  const retryAt=new Date(Date.now()+86400000).toISOString();
  const h=harness('competitors',{rivals:[{id:'one',name:'One',instagram_handle:'one'},{id:'two',name:'Two',instagram_handle:'two'}],media:{one:[{caption:'Known'}],two:[{caption:'Known'}]},modelError:new AiBudgetError('Budget',retryAt,'daily_calls')});await h.run();
  assert.equal(h.state.calls.length,1);assert.equal(h.state.reports.length,0);assert.equal(h.state.run.stage,'competitors');assert.equal(h.state.run.state.retry.at,retryAt);
});
test('a shared provider pause, rate limit or outage stops before reading the next rival',async()=>{
  for(const code of ['usage_paused','rate_limit','usage_unavailable','unavailable','network','authentication']) {
    const h=harness('competitors',{rivals:[{id:'one',name:'One',instagram_handle:'one'},{id:'two',name:'Two',instagram_handle:'two'}],media:{one:[{caption:'Known'}],two:[{caption:'Known'}]},modelError:Object.assign(new Error('Provider unavailable'),{code})});
    await h.run();assert.equal(h.state.calls.length,1,code);assert.deepEqual(h.state.feedReads,['one'],code);assert.equal(h.state.reports.length,0,code);assert.equal(h.state.run.stage,'competitors',code);assert.equal(h.state.run.status,'failed',code);assert.equal(checkpoints.campaignHasPendingCall(h.state.run.state),true,code);
  }
});

// A fast successful writer must not start a review while another source can still fail.
test('campaign reviews wait for all writers and never start after a sibling writer fails',async()=>{
  let rejectWriter;
  const waiting=new Promise((_resolve,reject)=>{rejectWriter=reject;});
  const h=harness('analyse',{sales:[{product_id:1,title:'Recorded product',units:2,revenue:100}],ads:[{platform:'meta',campaign_name:'Recorded',ad_name:'Ad',spend:100,purchases:1,revenue:200}],answer:({system})=>system.startsWith('sales:')?{title:'Sales',body:'Source-backed'}:waiting});
  const running=h.run();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.state.calls.length,2);assert.equal(h.state.reports.length,0);
  rejectWriter(new Error('Second source writer unavailable'));
  await running;assert.equal(h.state.reports.length,0);assert.equal(h.state.run.stage,'analyse');assert.equal(h.state.run.status,'failed');assert.equal(checkpoints.campaignHasPendingCall(h.state.run.state),true);
});
