import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as quality from '../src/lib/agents/quality-core.mjs';
import * as checkpoints from '../src/lib/agents/campaign-checkpoint-core.mjs';
import {PEOPLE} from '../src/office/roster.mjs';
const load=(file,modules)=>{const compiled=ts.transpileModule(readFileSync(new URL(`../src/lib/agents/${file}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('exports','require',compiled)(exports,id=>modules[id]||(id==='@/lib/artwork-mode.mjs'?{isChatGPTHandoff:()=>false}:id==='./campaign-checkpoint-core.mjs'?checkpoints:id==='./agent-work'?{withAgentWork:(_scope,fn)=>fn()}:{}));return exports;};
const people={byId:Object.fromEntries(PEOPLE.map(p=>[p.id,p])),teamLead:()=> 'creativeDirector',HUMAN_HEAD:{creative:'creativeHead'},persona:async()=> 'Saved current instructions'};
const usage={withUsage:(_scope,fn)=>fn(),recordTaskUsageEvent:async()=>{}};
const budget={isAiBudgetError:e=>e?.code==='ai_budget'};

function campaignHarness(classification={claims:{choice:'clean'},policy:{choice:'ok'}},head={ok:true,note:'Verified'}) {
  const state={run:{id:'run',stage:'review',status:'running',state:{campaign_id:'campaign',plan:{name:'Campaign',budget_daily:100,days:7,channels:['meta']}}},creatives:[{id:'asset',headline:'Supported copy',body:'Body',image_path:'v1.png',art_status:'ready'}],approvals:[],calls:0,checks:0,campaign:null};
  const db={rpc:async(name,args)=>{if(name==='open_campaign_review'){state.campaign={status:'in_approval',plan:{...args.p_plan,quality:args.p_quality,ai_review:args.p_note}};state.approvals.push({id:'approval',version:1});return {data:'approval',error:null};}return {data:true,error:null};},from:table=>{let change,insert;const q={select:()=>q,eq:()=>q,gt:()=>q,order:()=>q,update:v=>{change=v;return q;},insert:v=>{insert=v;return q;},single:()=>q,maybeSingle:()=>q,then:(resolve,reject)=>Promise.resolve().then(()=>{
    if(change&&table==='agent_runs')Object.assign(state.run,structuredClone(change));if(change&&table==='campaigns')state.campaign=change;if(insert&&table==='approvals')state.approvals.push(insert);
    return {data:structuredClone(table==='agent_runs'?state.run:table==='job_locks'?{name:'campaign:run'}:table==='creatives'?state.creatives:null),error:null};}).then(resolve,reject)};return q;}};
  const engine=load('campaign',{'node:crypto':crypto,'./quality-core.mjs':quality,'./people':people,'./memory':{loadMemory:async()=>{}},'./events':{emit:async()=>{}},'@/lib/usage':usage,'@/lib/ai-budget':budget,'@/lib/pause':{Paused:class extends Error{}},'@/lib/llm/jev':{classify:async()=>{state.checks++;return classification;}},'@/lib/llm/openai':{chatJSON:async()=>{state.calls++;return head;}}});
  return {state,run:()=>engine.advance(db,'run')};
}
test('actual campaign stage stops negative compliance without CMO call or queued approval and never automatically repeats',async()=>{
  const h=campaignHarness({claims:{choice:'risky'},policy:{choice:'ok'}});await h.run();assert.equal(h.state.run.status,'failed');assert.equal(h.state.run.stage,'review');assert.equal(h.state.calls,0);assert.equal(h.state.approvals.length,0);
  await h.run();assert.equal(h.state.checks,1);assert.equal(h.state.run.state.quality.passed,false);
});
test('actual campaign CMO false or malformed cannot advance; changed candidate requires another quality stage',async()=>{
  for(const head of [null,{ok:false,note:'Unsupported claim'},{note:'No explicit verdict'}]){const h=campaignHarness(undefined,head);await h.run();assert.equal(h.state.run.status,'failed');assert.equal(h.state.run.stage,'review');assert.equal(h.state.approvals.length,0);}
  const h=campaignHarness();await h.run();assert.equal(h.state.run.stage,'approval');h.state.creatives[0].headline='Changed';await h.run();assert.equal(h.state.run.status,'failed');assert.equal(h.state.run.stage,'review');assert.equal(h.state.approvals.length,0);
});
test('actual campaign approval persists the exact quality snapshot before creating the human queue',async()=>{
  const h=campaignHarness();await h.run();await h.run();assert.equal(h.state.run.stage,'done');assert.equal(h.state.approvals.length,1);assert.ok(quality.campaignQualityCurrent(h.state.campaign.plan,h.state.creatives));
});
test('actual report loop permits one correction then rejects unresolved findings without forwarding',async()=>{
  let report={id:'report'},reviews=0,rewrites=0;const events=[];
  const db={from:()=>{const q={insert:()=>q,select:()=>q,single:async()=>({data:report,error:null}),update:v=>{Object.assign(report,v);return q;},eq:()=>q,then:resolve=>Promise.resolve({error:null}).then(resolve)};return q;}};
  const mod=load('review',{'./quality-core.mjs':quality,'./people':people,'./events':{emit:async(...args)=>events.push(args)},'@/lib/llm/openai':{chatJSON:async tier=>tier==='manager'?(reviews++,{decision:'revise',note:'Evidence still missing'}):(rewrites++,{title:'Revised',body:'Still incomplete'})}});
  const result=await mod.fileReport(db,null,'copywriter',{title:'Draft',body:'Draft'},'Known data');assert.equal(result.status,'rejected_by_lead');assert.equal(reviews,2);assert.equal(rewrites,1);assert.match(report.lead_note,/allowance exhausted/);assert.equal(events.some(e=>e[2]==='report'),false);
});
function designHarness(reviewFailure,imagePath='old-reviewed-or-unreviewed.png',options={}) {
  const state={row:{format:'post',brief:'Create banner',headline:'Real jewellery',language:'en',product_ids:[1],image_path:imagePath,concept:null,ref_ids:[],versions:[],redo_note:null,status:'queued',...options.row},images:0,uploads:0,uploadArgs:[],directions:0,headlines:0,photoReads:0,imagePrompts:[],reviews:[]};
  const db={from:table=>{let update;let single=false;const q={delete:()=>q,update:v=>{update=v;return q;},select:()=>q,eq:()=>q,in:()=>q,not:()=>q,or:()=>q,order:()=>q,limit:()=>q,single:()=>{single=true;return q;},maybeSingle:async()=>({data:{carousel_id:null},error:null}),then:(resolve,reject)=>Promise.resolve().then(()=>{if(update)Object.assign(state.row,update);return {data:table==='products'?[{id:1,title:'Real product',image_url:'https://example.test/photo.png'}]:single?state.row:update?[{id:'design'}]:[],error:null};}).then(resolve,reject)};return q;},storage:{from:()=>({upload:async(...args)=>{state.uploads++;state.uploadArgs.push(args);return {error:null};}})}};
  const mod=load('design',{
    'node:crypto':crypto,'./people':people,'./memory':{loadMemory:async()=>{}},'./events':{emit:async()=>{}},'@/lib/usage':usage,
    '@/lib/errors':{errText:e=>e.message},'@/lib/llm/gemini-config':{geminiConfigured:async()=>true},
    '@/lib/llm/openai':{
      canWrite:async()=>options.available!==false,
      chatJSON:async tier=>{
        if(tier==='worker'){state.headlines++;return Object.hasOwn(options,'headline')?options.headline:{headline:'Real jewellery'};}
        state.directions++;if(options.direction instanceof Error)throw options.direction;
        return Object.hasOwn(options,'direction')?options.direction:{concept:'Place the jewellery on deep green silk with warm directional light and a clear headline area.'};
      },
    },
    './library':{pickRefs:async()=>[],refParts:async()=>options.referenceParts||[]},
    './library-core.mjs':{recentConcepts:()=>[],versionPath:base=>base,refLine:ref=>ref.description},
    '@/lib/llm/gemini':{
      imagePart:async()=>{state.photoReads++;return {inlineData:{mimeType:'image/png',data:'official-product-photo'}};},
      bannerImage:async prompt=>{state.images++;state.imagePrompts.push(prompt);return {mimeType:'image/png',data:Buffer.from('fixture')};},
      geminiJSON:async(...args)=>{state.reviews.push(args);if(reviewFailure instanceof Error)throw reviewFailure;return reviewFailure;},
    },
  });
  return {state,run:()=>mod.drawItem(db,'design','design')};
}
test('unavailable art direction stops before requesting an image and preserves the old file',async()=>{
  const h=designHarness({ok:true,note:'Checked'},undefined,{available:false});
  await assert.rejects(h.run(),/Creative Director art direction is unavailable/);
  assert.equal(h.state.directions,0);assert.equal(h.state.images,0);assert.equal(h.state.photoReads,0);assert.equal(h.state.uploads,0);
  assert.equal(h.state.row.status,'needs_fix');assert.equal(h.state.row.image_path,'old-reviewed-or-unreviewed.png');
});
test('art-direction provider, budget and instruction errors stop before image generation instead of falling back',async()=>{
  for(const error of [new Error('Text provider unavailable'),Object.assign(new Error('Budget exhausted'),{code:'ai_budget'}),Object.assign(new Error('Agent instructions unavailable'),{name:'AgentRuntimeError'})]){
    const h=designHarness({ok:true,note:'Checked'},null,{direction:error});
    await assert.rejects(h.run(),e=>e===error);
    assert.equal(h.state.directions,1);assert.equal(h.state.images,0);assert.equal(h.state.photoReads,0);assert.equal(h.state.uploads,0);assert.equal(h.state.row.status,'failed');
  }
});
test('missing or malformed art direction cannot spend an image request',async()=>{
  for(const direction of [null,undefined,{}, {concept:null},{concept:42},{concept:{}},{concept:''},{concept:' \n\t '}]){
    const h=designHarness({ok:true,note:'Checked'},null,{direction});
    await assert.rejects(h.run(),/did not return valid art direction/);
    assert.equal(h.state.images,0);assert.equal(h.state.photoReads,0);assert.equal(h.state.uploads,0);assert.equal(h.state.row.status,'failed');
  }
});
test('validated art direction is trimmed, used in the image request and saved with the design',async()=>{
  const concept='Use deep blue velvet, one directional light, and a quiet upper-left headline.';
  const h=designHarness({ok:true,note:'Product and finish checked'},null,{direction:{concept:`  ${concept}\n`}});
  await h.run();assert.equal(h.state.images,1);assert.equal(h.state.row.status,'ready');assert.equal(h.state.row.concept,concept);
  assert.ok(h.state.imagePrompts[0].includes(`Art direction: ${concept}`));
});
test('normal image review receives the complete brief, direction, references and final redesign instruction',async()=>{
  const concept='Show the ring on deep blue velvet; light its setting from the upper left.';
  const fingerprint='Palette: midnight blue and gold; Lighting: soft left key; Typography: quiet serif hierarchy.';
  const tail='Keep clear space above the ring.';
  const note=`${'Keep the selected product. '.repeat(20)}${tail}`;
  const h=designHarness({ok:true,note:'Product, style and requested changes checked'},null,{
    direction:{concept},row:{format:'portrait',brief:'Prepare an elegant festive portrait.',redo_note:note},
    referenceParts:[{ref:{id:'style-1',description:fingerprint},part:{text:fingerprint}}],
  });
  await h.run();
  const [review,inputs]=h.state.reviews[0];
  assert.ok(review.includes(concept));assert.ok(review.includes(h.state.row.brief));assert.ok(review.includes(note));
  assert.ok(review.includes(tail));assert.match(review,/Instagram portrait .*4:5/);
  assert.match(review,/fails or cannot be verified/);assert.match(review,/"24K gold layered" and "trusted quality"/);
  assert.equal(inputs[0].inlineData.data,Buffer.from('fixture').toString('base64'));
  assert.equal(inputs[1].inlineData.data,'official-product-photo');
  assert.match(inputs[2].text,/STYLE FINGERPRINTS/);assert.equal(inputs[3].text,fingerprint);
  assert.equal(h.state.images,1);assert.equal(h.state.reviews.length,1);
});
test('invalid auto-written headlines fail before art direction or image generation',async()=>{
  for(const headline of [null,undefined,{}, {headline:null},{headline:42},{headline:{}},{headline:''},{headline:' \n\t '}]){
    const h=designHarness({ok:true,note:'Checked'},null,{row:{headline:''},headline});
    await assert.rejects(h.run(),/copywriter did not return a valid headline/);
    assert.equal(h.state.headlines,1);assert.equal(h.state.directions,0);assert.equal(h.state.images,0);assert.equal(h.state.photoReads,0);assert.equal(h.state.uploads,0);
  }
});
test('valid auto-written headline is trimmed and used consistently by designer and reviewer',async()=>{
  const h=designHarness({ok:true,note:'Product and copy checked'},null,{row:{headline:''},headline:{headline:'  A Golden Moment\n'}});
  await h.run();assert.equal(h.state.headlines,1);assert.equal(h.state.directions,1);assert.equal(h.state.images,1);
  assert.equal(h.state.row.headline,'A Golden Moment');assert.match(h.state.imagePrompts[0],/headline "A Golden Moment"/);
  assert.match(h.state.reviews[0][0],/exact headline "A Golden Moment"/);
});
test('image quality budget denial keeps an old file unapproved and never uploads an unchecked replacement',async()=>{
  const h=designHarness(Object.assign(new Error('Budget exhausted'),{code:'ai_budget'}));await assert.rejects(h.run(),/Budget exhausted/);assert.equal(h.state.row.status,'needs_fix');assert.equal(h.state.uploads,0);assert.equal(h.state.images,1);assert.equal(h.state.row.image_path,'old-reviewed-or-unreviewed.png');
});
test('malformed image verdict cannot be treated as ready; missing prior image stays failed',async()=>{
  for(const verdict of [{ok:'true',note:'Looks fine'}, {ok:true},null]){const h=designHarness(verdict,null);await assert.rejects(h.run(),/valid quality verdict/);assert.equal(h.state.row.status,'failed');assert.equal(h.state.uploads,0);}
});
test('learning records attribution as observation, without profit conclusions or budget ranking advice',async()=>{
  const saved=[];const db={rpc:async name=>({data:name==='campaign_results'?[{campaign_id:'provider',spend:100,revenue:1000,purchases:2}]:name==='ad_rollup'?[{platform:'meta',ad_name:'High',spend:3000,revenue:30000},{platform:'google',ad_name:'Low',spend:3000,revenue:0}]:[],error:null}),from:table=>{let inserted,changed;const q={select:()=>q,not:()=>q,order:()=>q,limit:()=>q,eq:()=>q,or:()=>q,insert:v=>{inserted=v;return q;},update:v=>{changed=v;return q;},then:resolve=>{if(inserted)saved.push(...(Array.isArray(inserted)?inserted:[inserted]));return Promise.resolve({data:table==='campaigns'?[{id:'campaign',name:'Sample',external_ids:{meta:{campaign_id:'provider'}}}]:[],error:null}).then(resolve);}};return q;}};
  const mod=load('learn',{});await mod.learnFromData(db);assert.ok(saved.length);const text=saved.map(r=>r.lesson).join('\n');assert.doesNotMatch(text,/Lost money|Paid back|Worth repeating|Move budget|Learn from its style/);assert.match(text,/ROAS does not establish profit/);assert.ok(saved.every(row=>row.decision==='data'));
});


test('checked design files get unique paths with overwrite disabled',async()=>{
  const a=designHarness({ok:true,note:'Actual product and text checked.'}),b=designHarness({ok:true,note:'Actual product and text checked.'});
  await a.run();await b.run();assert.equal(a.state.row.status,'ready');assert.equal(a.state.uploadArgs[0][2].upsert,false);assert.notEqual(a.state.uploadArgs[0][0],b.state.uploadArgs[0][0]);
});
