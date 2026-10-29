import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as headEvidence from '../src/lib/automation/head-evidence.mjs';
import * as core from '../src/lib/automation/head-task-core.mjs';
import * as handlerCore from '../src/lib/automation/handler-core.mjs';
import * as context from '../src/lib/agents/conversation-context.mjs';
import { PEOPLE } from '../src/office/roster.mjs';

const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/automation/head-task.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const assignment=id=>({agentId:id,task:'Write accurate festival captions.',deliverable:'Three usable captions.'});
const plan=(ids=['copywriter'])=>({understanding:'Prepare festival captions for human approval.',successCriteria:['Ready-to-use captions without invented offers.'],assignments:ids.map(assignment)});
const worker=(changes={})=>({summary:'Three captions written.',body:'1. A little gold, a lasting memory.\n2. Celebrate together.\n3. Made for your moments.',blocked:false,missing:[],warnings:[],evidenceSources:['Product catalogue'],...changes});
const approval={decision:'approve',note:'The copy meets the brief and contains no invented offers.',finalMarkdown:'Reviewed captions: a little gold, a lasting memory.',revisionRequests:[]};

const qc={decision:'pass',note:'The exact candidate is supported and complete.',findings:[],revisionRequests:[]};
function harness(responses=[plan(),worker(),approval,qc]) {
  const names=['outputQc','creativeDirector','copywriter','brandGuardian','analyticsLead','sales','shopifySync'];
  const tables={agents:names.map(id=>{const p=PEOPLE.find(p=>p.id===id);return {id,name:p.name,role_desc:p.role,department_id:p.dept,is_lead:!!p.head,enabled:true};}),connections:[{provider:'shopify',status:'connected',last_synced_at:'2026-10-26T00:00:00Z'}],social_posts:[],seo_keywords:[],competitor_moves:[]};
  const state={calls:[],queries:[],checkpoints:[],events:[],mapEvents:[],work:[],prompts:[],instructions:'Use concise English.',pause:false,fail:null,dbFailure:null,eventFailureKind:null,onPrompt:null};
  const controller=new AbortController();
  function from(table) {
    const filters=[];let one=false,limit=Infinity;
    const q={select:()=>q,eq:(k,v)=>{filters.push(row=>row[k]===v);return q;},in:(k,v)=>{filters.push(row=>v.includes(row[k]));return q;},order:()=>q,limit:n=>{limit=n;return q;},maybeSingle:()=>{one=true;return q;},abortSignal:()=>q,
      then:(resolve,reject)=>Promise.resolve().then(()=>{state.queries.push(table);if(state.dbFailure===table)return {data:null,error:{message:'read failed'}};const rows=(tables[table]||[]).filter(row=>filters.every(f=>f(row))).slice(0,limit);return {data:structuredClone(one?rows[0]||null:rows),error:null};}).then(resolve,reject)};return q;
  }
  const db={from,rpc:(name)=>{const q={abortSignal:()=>q,then:(resolve,reject)=>Promise.resolve({data:{units:174,days:[]},error:null}).then(resolve,reject)};state.queries.push(name);return q;}};
  const task={id:'task',kind:'head_task',title:'Festival captions',brief:'Prepare three captions for the upcoming festival. Draft only.',owner_agent:'creativeDirector',department_id:'creative',input:{allowedDepartments:['creative','insights']},state:{},due_at:null};
  const ctx={db,task,signal:controller.signal,assertActive:async()=>{controller.signal.throwIfAborted();if(state.pause)throw Object.assign(new Error('Office paused'),{name:'Paused'});},
    checkpoint:async patch=>{await ctx.assertActive();state.checkpoints.push(structuredClone(patch));task.state={...task.state,...structuredClone(patch)};},
    event:async(agentId,text,kind)=>{await ctx.assertActive();if(kind===state.eventFailureKind)throw new Error('Event storage unavailable');state.events.push({agentId,text,kind});},
  };
  const modules={
    'node:crypto':crypto,'server-only':{},'@/office/roster.mjs':{PEOPLE},'./head-task-core.mjs':core,'./head-evidence.mjs':headEvidence,'./head-task-jev':{tryJevHeadPlan:async()=>{state.jevAttempts=(state.jevAttempts||0)+1;if(state.jevError)throw state.jevError;state.onJev?.();return state.jevPlan||state.jevGeneral?{plan:state.jevPlan||null}:null;}},'./handler-core.mjs':handlerCore,
    '@/lib/agents/conversation-context.mjs':context,
    '@/lib/agents/conversation-sales.mjs':{
      requestedSalesCategory:()=>null,
      conversationProductCatalog:async()=>{state.queries.push('product_stock');return {available:true,observed_at:'2026-10-26',coverage:'Bounded catalogue. Empty rows do not prove zero stock.',data:[]};},
      conversationProductSales:async()=>{state.queries.push('conversation_product_sales');return {available:true,coverage:{stock_note:'Null is unknown; 0 is recorded zero.'},summary:{units_all_recorded_products:174},data:[{product_id:'1',units:12,stock:null}]};},
    },
    '@/lib/llm/openai':{chatJSON:async(tier,system,user,options)=>{assert.ok(task.state.headWorkflow.pendingCall,'call reservation is durable before provider');state.calls.push({tier,system,user:JSON.parse(user),options});if(state.fail)throw state.fail;assert.ok(responses.length,'unexpected extra model call');return structuredClone(responses.shift());}},
    '@/lib/agents/agent-instructions':{agentPrompt:async(_db,id,instruction,options)=>{state.promptOptions=options;state.prompts.push(id);state.onPrompt?.(id);return `Agent ${id}\nCurrent saved instruction: ${state.instructions}\n${instruction}`;}},
    '@/lib/agents/agent-work':{withAgentWork:async(scope,fn)=>{state.work.push(scope);return fn();}},
    '@/lib/agents/events':{emit:async(_db,_runId,kind,from,text,to,payload)=>{state.mapEvents.push({kind,from,text,to,payload});}},
    '@/lib/usage':{withUsage:(_scope,fn)=>fn()},'@/lib/ai-budget':{isAiBudgetError:error=>error?.code==='ai_budget'},
  };
  const exports={};new Function('exports','require',compiled)(exports,id=>{assert.ok(id in modules,`Unmocked import ${id}`);return modules[id];});
  return {state,tables,task,ctx,controller,run:()=>exports.runHeadTask(ctx)};
}

test('real engine delegates, executes and reviews in separate durable calls, then replays handoff without inference',async()=>{
  const h=harness();
  assert.equal((await h.run()).status,'queued');assert.equal(h.state.calls.length,1);assert.equal(h.task.state.headWorkflow.phase,'work');
  assert.equal((await h.run()).status,'queued');assert.equal(h.state.calls.length,2);assert.equal(h.task.state.headWorkflow.phase,'review');
  assert.equal((await h.run()).status,'queued');assert.equal(h.task.state.headWorkflow.phase,'quality');
  const result=await h.run();assert.equal(result.status,'review');assert.equal(result.markdown,approval.finalMarkdown);assert.equal(h.state.calls.length,4);assert.equal(h.task.state.headWorkflow.phase,'handoff');
  assert.equal((await h.run()).status,'review');assert.equal(h.state.calls.length,4,'atomic handoff retry never reruns approved model work');
  assert.deepEqual(h.state.prompts,['creativeDirector','copywriter','creativeDirector','outputQc']);
  assert.deepEqual(h.state.calls.map(c=>c.tier),['manager','worker','manager','manager']);
  assert.deepEqual(h.state.work.map(s=>s.agentId),h.state.prompts);assert.equal(h.state.work[2].kind,'review');
  assert.equal(h.state.calls[2].user.outputs.copywriter.body,worker().body);assert.deepEqual(result.actions,[]);
  assert.equal(h.task.state.headWorkflow.pendingCall,undefined);
  assert.ok(h.state.events.some(e=>e.kind==='specialist_report'&&e.agentId==='copywriter'));
  assert.ok(h.state.mapEvents.some(e=>e.kind==='report'&&e.from==='copywriter'&&e.to==='creativeDirector'));
  for(const e of h.state.mapEvents){assert.deepEqual(e.payload,{automation_task_id:'task'});assert.doesNotMatch(e.text,/Festival captions|lasting memory/);}
});

test('retry after handoff transaction failure needs zero new model calls',async()=>{
  const h=harness();await h.run();await h.run();await h.run();await h.run();
  h.task.state.headWorkflow=core.resumeHeadWorkflow(h.task.state.headWorkflow);
  assert.equal((await h.run()).status,'review');assert.equal(h.state.calls.length,4);assert.equal(h.task.state.headWorkflow.phase,'handoff');
});

test('head and independent QC see the exact saved evidence including details beyond the old review cap',async()=>{
  const h=harness();
  await h.run();
  // A valid saved snapshot can be longer than the old secondary 4,000-char
  // budget. Its detailed rows must survive both reviews without recompression.
  const snapshot={contextCoverage:'Bounded recorded sources; missing rows are unknown.'};
  for(const key of ['products','social','search','competitors'])snapshot[key]={
    available:true,observed_at:'2026-10-28T00:00:00Z',coverage:`${key} recorded sample.`,
    data:Array.from({length:4},(_,i)=>({id:`${key}-${i}`,detail:'Verified source context. '.repeat(10),restriction:`${key}-${i}: no discount is approved.`})),
  };
  assert.ok(JSON.stringify(snapshot).length>4000&&JSON.stringify(snapshot).length<7000);
  h.task.state.headWorkflow.evidenceSnapshot=structuredClone(snapshot);
  await h.run();await h.run();await h.run();
  for(const stage of ['review','quality']){
    const call=h.state.calls.find(call=>call.user.stage===stage);
    assert.deepEqual(call.user.recordedEvidence,snapshot);
    assert.equal(call.user.recordedEvidence.products.data[3].restriction,'products-3: no discount is approved.');
  }
  assert.equal(h.state.calls.length,4,'preserving evidence does not add inference calls');
});

test('a second specialist receives the entire saved peer draft and its ending constraint',async()=>{
  const body='Caption draft and product details. '.repeat(140)+' FINAL CONSTRAINT: no offer or purity claim has been approved.';
  assert.ok(body.length>1800&&body.length<6000);
  const h=harness([plan(['copywriter','brandGuardian']),worker({body,warnings:['Human approval is required.']}),worker()]);
  await h.run();await h.run();await h.run();
  assert.equal(h.state.calls[2].user.completedPeers[0].body,body);
  assert.deepEqual(h.state.calls[2].user.completedPeers[0].warnings,['Human approval is required.']);
});

test('an event-save failure after a durable worker output never repeats that specialist call',async()=>{
  const h=harness();await h.run();h.state.eventFailureKind='specialist_report';
  await assert.rejects(h.run(),/Event storage/);assert.equal(h.task.state.headWorkflow.phase,'review');assert.equal(h.state.calls.length,2);
  h.state.eventFailureKind=null;assert.equal((await h.run()).status,'queued');assert.equal((await h.run()).status,'review');assert.equal(h.state.calls.length,4);assert.equal(h.state.prompts.filter(id=>id==='copywriter').length,1);
});

test('two workers and one head revision plus independent QC use seven calls total; saved peer is never rerun',async()=>{
  const revision={decision:'revise',note:'Adjust the first caption.',finalMarkdown:'',revisionRequests:[{agentId:'copywriter',instruction:'Make the first caption warmer.'}]};
  const h=harness([plan(['copywriter','brandGuardian']),worker(),worker({body:'Brand check complete.'}),revision,worker({body:'Revised warm captions.'}),approval,qc]);
  for(let i=0;i<7;i++){const before=h.state.calls.length;await h.run();assert.equal(h.state.calls.length,before+1);}
  assert.equal(h.task.state.headWorkflow.phase,'handoff');assert.equal(h.task.state.headWorkflow.outputs.brandGuardian.revision,0);assert.equal(h.task.state.headWorkflow.outputs.copywriter.revision,1);
  assert.equal(h.state.prompts.filter(id=>id==='brandGuardian').length,1);
  await h.run();assert.equal(h.state.calls.length,7);
});

test('second AI revision request blocks instead of forwarding unfinished work to a human',async()=>{
  const revision={decision:'revise',note:'Needs another change.',finalMarkdown:'',revisionRequests:[{agentId:'copywriter',instruction:'Improve copy.'}]};
  const h=harness([plan(),worker(),revision,worker(),revision]);
  let result;for(let i=0;i<5;i++)result=await h.run();
  assert.equal(result.status,'blocked');assert.equal(h.task.state.headWorkflow.phase,'blocked');assert.match(result.summary,/one automatic revision/);
  await h.run();assert.equal(h.state.calls.length,5);
});

test('missing specialist evidence remains blocked even when model reviewer proposes approval',async()=>{
  const h=harness([plan(),worker({blocked:true,missing:['Confirmed product stock']}),approval]);
  await h.run();await h.run();const result=await h.run();
  assert.equal(result.status,'blocked');assert.equal(h.task.state.headWorkflow.review.decision,'blocked');assert.equal(h.task.state.headWorkflow.reportId,undefined);
});

test('disabled, unauthorized or invented assignments stop before specialist calls',async()=>{
  for(const problem of ['disabled','scope']) {
    const h=harness();await h.run();
    if(problem==='disabled')h.tables.agents.find(a=>a.id==='copywriter').enabled=false;else h.task.input.allowedDepartments=['insights'];
    const result=await h.run();assert.equal(result.status,'blocked');assert.equal(h.state.calls.length,1);
  }
  const h=harness([plan(['shopifySync'])]);await assert.rejects(h.run(),/unavailable/);assert.equal(h.state.calls.length,1);assert.equal(h.task.state.headWorkflow.outputs.copywriter,undefined);
});

test('scope narrowed during fresh specialist instructions prevents inference and clears the no-call marker',async()=>{
  const h=harness([plan(['analyticsLead']),worker(),approval]);await h.run();
  h.state.onPrompt=id=>{if(id==='analyticsLead')h.task.input.allowedDepartments=['creative'];};
  await assert.rejects(h.run(),error=>error.code==='head_task_access');
  assert.equal(h.state.calls.length,1);assert.equal(h.task.state.headWorkflow.pendingCall,undefined);assert.equal(h.task.state.headWorkflow.outputs.analyticsLead,undefined);
});

test('agent disabled or moved during prompt loading cannot make the next model request',async()=>{
  for(const change of ['disabled','moved']) {
    const h=harness();await h.run();
    h.state.onPrompt=id=>{if(id==='copywriter'){const agent=h.tables.agents.find(a=>a.id===id);if(change==='disabled')agent.enabled=false;else agent.department_id='insights';}};
    await assert.rejects(h.run(),error=>error.code==='head_task_access');assert.equal(h.state.calls.length,1);assert.equal(h.task.state.headWorkflow.pendingCall,undefined);
  }
});

test('head department access revoked during instructions prevents even the planning call',async()=>{
  const h=harness();h.state.onPrompt=()=>{h.task.input.allowedDepartments=['insights'];};
  await assert.rejects(h.run(),error=>error.code==='head_task_access');assert.equal(h.state.calls.length,0);assert.equal(h.task.state.headWorkflow.pendingCall,undefined);
});

test('provider failure leaves an uncertain-call marker and automatic recovery does not repeat the request',async()=>{
  const h=harness();h.state.fail=new Error('Provider connection ended');
  await assert.rejects(h.run(),/Provider connection/);assert.equal(h.state.calls.length,1);assert.ok(h.task.state.headWorkflow.pendingCall);
  h.state.fail=null;const result=await h.run();assert.equal(result.status,'blocked');assert.equal(h.state.calls.length,1);
  h.task.state.headWorkflow=core.resumeHeadWorkflow(h.task.state.headWorkflow);
  assert.equal((await h.run()).status,'queued');assert.equal(h.state.calls.length,2);
});

test('budget guard propagates while clearing no-call markers for normal budget resume',async()=>{
  const h=harness();const error=Object.assign(new Error('Budget exhausted'),{code:'ai_budget',retryAt:'2026-10-27'});h.state.fail=error;
  await assert.rejects(h.run(),e=>e===error);assert.equal(h.task.state.headWorkflow.pendingCall,undefined);assert.equal(h.task.state.headWorkflow.phase,'plan');
  h.state.fail=null;assert.equal((await h.run()).status,'queued');
});

test('pause and cancellation stop all model stages and leave completed checkpoints intact',async()=>{
  const h=harness();h.state.pause=true;await assert.rejects(h.run(),/paused/);assert.equal(h.state.calls.length,0);
  h.state.pause=false;await h.run();const saved=structuredClone(h.task.state.headWorkflow);
  h.controller.abort(new DOMException('Cancelled','AbortError'));await assert.rejects(h.run(),{name:'AbortError'});assert.equal(h.state.calls.length,1);assert.deepEqual(h.task.state.headWorkflow,saved);
});

test('each actual agent turn reloads current instructions and reads only relevant shared evidence',async()=>{
  const h=harness();await h.run();h.state.instructions='Respond in Malayalam.';await h.run();
  assert.match(h.state.calls[1].system,/Respond in Malayalam/);assert.doesNotMatch(h.state.calls[0].system,/Respond in Malayalam/);
  assert.equal(h.state.queries.filter(table=>table==='product_stock').length,1,'successful stage resumes reuse saved evidence snapshot');
  for(const privateTable of ['reports','agent_threads','agent_messages','automation_inquiries','customers'])assert.equal(h.state.queries.includes(privateTable),false);
  assert.equal(h.state.queries.includes('seo_keywords'),false);assert.equal(h.state.queries.includes('competitor_moves'),false);
  assert.match(h.state.calls[0].user.recordedEvidence.sources.products.coverage,/Empty rows do not prove zero stock/);
});

test('full allowed task and human feedback survive old truncation boundaries; prior delivery is labeled as an excerpt',async()=>{
  const h=harness();
  h.task.brief='A'.repeat(5900)+' Preserve this final required outcome.';
  h.task.state.headWorkflow={version:1,phase:'plan',humanFeedback:'B'.repeat(5900)+' Keep this final human correction.',previousDelivery:'Old '.repeat(2000)};
  await h.run();const request=h.state.calls[0].user.request;
  assert.equal(request.brief,h.task.brief);assert.equal(request.humanFeedback,h.task.state.headWorkflow.humanFeedback);
  assert.equal(Array.from(request.previousDelivery).length,2500);assert.match(request.previousDeliveryCoverage,/Excerpt.*2500/);
});

test('manual retry reruns only blocked worker, refreshes source snapshot, then requires head review',async()=>{
  const h=harness([plan(['copywriter','brandGuardian']),worker({blocked:true,missing:['Missing fact']}),worker(),approval,worker(),approval,qc]);
  await h.run();await h.run();await h.run();assert.equal((await h.run()).status,'blocked');
  h.task.state.headWorkflow=core.resumeHeadWorkflow(h.task.state.headWorkflow);
  assert.equal((await h.run()).status,'queued');assert.equal((await h.run()).status,'queued');assert.equal((await h.run()).status,'review');
  assert.equal(h.state.prompts.filter(id=>id==='brandGuardian').length,1);assert.equal(h.state.queries.filter(table=>table==='product_stock').length,2);
});


test('independent QC correction shares the single revision allowance and totals at most eight calls',async()=>{
  const fix={decision:'revise',note:'Remove an unsupported claim.',findings:['Unverified claim in candidate.'],revisionRequests:[{agentId:'copywriter',instruction:'Remove the unsupported statement.'}]};
  const h=harness([plan(['copywriter','brandGuardian']),worker(),worker(),approval,fix,worker({body:'Supported revised copy'}),approval,qc]);
  for(let i=0;i<8;i++){const n=h.state.calls.length;await h.run();assert.equal(h.state.calls.length,n+1);}
  assert.equal(h.task.state.headWorkflow.phase,'handoff');assert.equal(h.state.calls.length,8);
  assert.equal(h.state.prompts.filter(id=>id==='brandGuardian').length,1);assert.equal(h.state.prompts.filter(id=>id==='outputQc').length,2);
  assert.ok(core.headQualityCurrent(h.task.state.headWorkflow));assert.equal(h.task.state.headWorkflow.quality.decision,'pass');
  assert.equal(h.state.promptOptions.artifactOnly,true);assert.equal(h.task.input.allowedDepartments.includes('qa'),false);
  assert.equal(h.state.calls.at(-1).user.outputs,undefined,'QC gets candidate + bounded supporting summaries, not arbitrary private records');
  await h.run();assert.equal(h.state.calls.length,8);
});
test('negative QC after a head correction blocks without another worker or human handoff',async()=>{
  const revise={decision:'revise',note:'Correct copy.',revisionRequests:[{agentId:'copywriter',instruction:'Correct copy.'}]};
  const h=harness([plan(),worker(),revise,worker(),approval,{...revise,findings:['Still unsupported']}]);
  let result;for(let i=0;i<6;i++)result=await h.run();
  assert.equal(result.status,'blocked');assert.match(result.summary,/one automatic revision/);assert.equal(h.task.state.headWorkflow.reportId,undefined);
});
test('QC uncertainty never automatically repeats; explicit retry preserves the reviewed source snapshot',async()=>{
  const h=harness();for(let i=0;i<3;i++)await h.run();const evidence=structuredClone(h.task.state.headWorkflow.evidenceSnapshot);
  h.state.fail=new Error('Review connection ended');await assert.rejects(h.run(),/connection ended/);
  assert.equal((await h.run()).status,'blocked');assert.equal(h.state.calls.length,4);
  h.state.fail=null;h.task.state.headWorkflow=core.resumeHeadWorkflow(h.task.state.headWorkflow);
  assert.deepEqual(h.task.state.headWorkflow.evidenceSnapshot,evidence);assert.equal((await h.run()).status,'review');assert.equal(h.state.calls.length,5);
});
test('disabled QC and changed candidates fail closed without repeating approved work',async()=>{
  const h=harness();for(let i=0;i<3;i++)await h.run();h.tables.agents.find(a=>a.id==='outputQc').enabled=false;
  assert.equal((await h.run()).status,'blocked');assert.equal(h.state.calls.length,3);
  h.tables.agents.find(a=>a.id==='outputQc').enabled=true;h.task.state.headWorkflow=core.resumeHeadWorkflow(h.task.state.headWorkflow);await h.run();
  h.task.state.headWorkflow.review.finalMarkdown+=' Changed after review';
  assert.equal((await h.run()).status,'blocked');assert.equal(h.state.calls.length,4);
});

test('a confident Jev template replaces only planning while specialist, head and QC still execute',async()=>{
 const h=harness([worker(),approval,qc]);h.state.jevPlan=plan();
 await h.run();assert.equal(h.state.calls.length,0);assert.equal(h.task.state.headWorkflow.phase,'work');
 await h.run();await h.run();const result=await h.run();
 assert.equal(h.state.calls.length,3);assert.equal(result.status,'review');assert.equal(h.task.state.headWorkflow.quality.decision,'pass');
 assert.equal(h.state.calls[2].options.maxOutputTokens,1200);
});
test('failed Jev planning is not followed by a ChatGPT request or automatic uncertain retry',async()=>{
 const h=harness();h.state.jevError=Object.assign(new Error('Jev unavailable'),{code:'unavailable'});
 await assert.rejects(h.run(),/Jev unavailable/);assert.equal(h.state.calls.length,0);assert.ok(h.task.state.headWorkflow.pendingCall);
 const blocked=await h.run();assert.equal(blocked.status,'blocked');assert.equal(h.state.calls.length,0);
});
test('a completed general Jev decision survives later ChatGPT budget refusal without repeating classification',async()=>{
 const h=harness();h.state.jevGeneral=true;h.state.fail=Object.assign(new Error('Budget exhausted'),{code:'ai_budget'});
 await assert.rejects(h.run(),/Budget exhausted/);
 assert.equal(h.task.state.headWorkflow.jevRouting.plan,null);assert.equal(h.task.state.headWorkflow.pendingCall,undefined);
 h.state.fail=null;await h.run();assert.equal(h.state.jevAttempts,1);assert.equal(h.task.state.headWorkflow.phase,'work');
});
test('saved instruction changes invalidate a previously completed Jev route',async()=>{
 const h=harness();h.state.jevGeneral=true;h.state.fail=Object.assign(new Error('Budget exhausted'),{code:'ai_budget'});
 await assert.rejects(h.run(),/Budget exhausted/);h.state.instructions='Use full human brief and fresh instructions.';h.state.fail=null;
 await h.run();assert.equal(h.state.jevAttempts,2);
});
test('access revoked during Jev classification prevents a second provider request',async()=>{
 const h=harness();h.state.jevGeneral=true;h.state.onJev=()=>{h.tables.agents.find(a=>a.id==='creativeDirector').enabled=false;};
 await assert.rejects(h.run(),error=>error.code==='head_task_access');assert.equal(h.state.calls.length,0);
});
