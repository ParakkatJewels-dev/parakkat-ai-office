import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as core from '../src/lib/agents/conversation-core.mjs';
import * as context from '../src/lib/agents/conversation-context.mjs';
import * as direct from '../src/lib/agents/conversation-deterministic.mjs';
import * as routing from '../src/lib/agents/conversation-routing.mjs';
import * as reuse from '../src/lib/agents/conversation-reuse.mjs';
import * as carousel from '../src/lib/agents/carousel-core.mjs';
import * as carouselUrl from '../src/lib/agents/carousel-url.mjs';
import * as artwork from '../src/lib/agents/conversation-artwork.mjs';
import * as providerRouting from '../src/lib/artwork/provider-routing.mjs';
import { createAgentWorkRuntime } from '../src/lib/agents/agent-work-core.mjs';

const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/agents/conversation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(options={}) {
  const agent={id:'sales',name:'Sales',role_desc:'Sales analyst',department_id:'insights',is_lead:false,enabled:true};
  const state={calls:0,callOptions:[],inputs:[],systems:[],fullEvidenceReads:0,historyReads:0,workStarts:0,liveReads:[],events:[],usage:[],reads:[],runtimeReads:0,
    agents:options.agents||[agent],profiles:options.profiles||[{id:'user',role:'insights_head'}],departments:options.departments||[{id:'insights',human_head_role:'insights_head'}],product_stock:options.productStock||[],designOrders:[],designRevisions:[],carouselOrders:[],carouselRevisions:[],generations:[],designs:options.designs||[],
    agent_tasks:[{id:'task',thread_id:'thread',requested_by:'user',agent_id:options.hostId||'sales',prompt:options.prompt||'What are you working on?',status:'queued',meeting_requested:!!options.meeting}],
    agent_threads:[{id:'thread',owner_id:'user',status:'queued'}],agent_messages:structuredClone(options.history||[]),agent_meetings:[],
    agent_events:[{at:'2026-10-26T10:00:00Z',from_agent:'sales',text:'Previous analysis'}],reports:[{author_agent:'sales',title:'Visible report',status:'with_head',updated_at:'2026-10-26T10:00:00Z'}],
  };
  const work=createAgentWorkRuntime({people:[agent]});
  function client(admin) {
    return {auth:{getUser:async()=>({data:{user:{id:options.userId||'user'}}})},rpc:(_name,args)=>{
      const response={then:(resolve,reject)=>Promise.resolve({data:options.metrics||{revenue:500,units:3,spend:20,ad_revenue:60,days:[[args.p_to,500]],platforms:[{platform:'meta'}]},error:options.metricsError||null}).then(resolve,reject),abortSignal:()=>response};
      state.reads.push({admin,table:'dashboard_report'});return response;
    },from:table=>{
      let filters=[],single=false,limit=Infinity,insert,update;const q={select:()=>q,eq:(key,value)=>{filters.push(row=>row[key]===value);return q;},in:(key,values)=>{filters.push(row=>values.includes(row[key]));return q;},or:()=>q,order:()=>q,limit:n=>{limit=n;return q;},maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},abortSignal:signal=>{signal.throwIfAborted();return q;},update:value=>{update=value;return q;},insert:value=>{insert=value;return q;},then:(resolve,reject)=>Promise.resolve().then(()=>{
        if (!admin && table==='agent_messages') state.historyReads++;
        state.reads.push({admin,table,mutation:!!insert||!!update});
        let rows=(state[table]||[]).filter(row=>filters.every(fn=>fn(row)));
        if(update)rows.forEach(row=>Object.assign(row,update));
        if(insert){const row={id:`saved-${state.agent_messages.length}`, ...insert};(state[table]||=[]).push(row);rows=[row];}
        const data=structuredClone(single?rows[0]||null:rows.slice(0,limit));
        if(!admin && table==='agent_events')options.afterActivityRead?.(state);
        return {data,error:null};
      }).then(resolve,reject)};return q;
    }};
  }
  const reader=client(false),admin=client(true);
  const modules={
    'server-only':{},'./conversation-core.mjs':{...core,conversationFailure:error=>{state.rawError=String(error?.stack||error);return core.conversationFailure(error);}},'./conversation-context.mjs':context,'./conversation-deterministic.mjs':direct,
    './conversation-routing.mjs':routing,'./conversation-reuse.mjs':reuse,'./conversation-artwork.mjs':artwork,'@/lib/artwork-mode.mjs':{isChatGPTHandoff:()=>options.handoff!==false},'./carousel-core.mjs':carousel,'./carousel-url.mjs':carouselUrl,
    './design':{queueDesign:async(_db,order)=>{state.designOrders.push(order);return '11111111-1111-4111-8111-111111111111';},queueRedesign:async(_db,source,id,note)=>state.designRevisions.push({source,id,note})},
    '@/lib/artwork/generation':{startAutomaticArtwork:async args=>{state.generations.push(args);return options.generation||{started:true,job:{id:'job',state:'queued'}};}},
    '@/lib/artwork/provider-routing.mjs':providerRouting,
    './carousel':{
      queueCarouselRedesign:async(_admin,_reader,options)=>{state.carouselRevisions.push(options);return {cards:state.designs.filter(row=>row.carousel_id===options.carouselId)};},
      queueSalesCarousel:async(_admin,_reader,options)=>{state.carouselOrders.push(options);return {carouselId:'22222222-2222-4222-8222-222222222222',cards:Array.from({length:5},(_,index)=>({id:`card-${index}`,carousel_index:index+1})),products:[],from:'2026-09-27',to:'2026-10-26',referenceName:'Chain reference'};},
    },
    '@/lib/pause':{checkPause:async()=>{}},'@/lib/llm/openai':{chatJSON:async(tier,system,input,config)=>{state.calls++;state.callOptions.push({tier,...config});state.inputs.push(JSON.parse(input));state.systems.push(system);return options.answer?options.answer(state.calls,JSON.parse(input)):{answer:'Model fallback answer',reply:'Model fallback answer',delegations:[]};}},
    '@/lib/llm/jev':{classify:async()=>{state.jevCalls=(state.jevCalls||0)+1;if(options.jevError)throw options.jevError;return options.jevAnswer||{route:{choice:'direct',confidence:0.5,probabilities:{direct:0.5,analyst:0.5}}};}},'@/lib/llm/jev-config':{getJevStatus:async()=>({status:options.jevStatus||'disconnected'})},
    '@/lib/usage':{withUsage:(scope,fn)=>{state.usage.push(scope);return fn();},recordTaskUsageEvent:async event=>state.usage.push(event)},
    './events':{emit:async(...args)=>state.events.push(args)},'./people':{byId:Object.fromEntries(state.agents.map(a=>[a.id,{human:false}]))},
    './agent-work':{withAgentWork:(scope,fn)=>{state.workStarts++;return work.run(scope,fn);},readAgentWork:ids=>{state.liveReads.push([...ids]);return work.read(ids);}},
    './agent-instructions':{agentPrompt:async(_db,id,instruction)=> `Agent identity: ${id}\nUse real evidence.\n${instruction}`,loadAgentRuntime:async()=>{
      state.runtimeReads++;
      return {agent:structuredClone(state.agents[0]),instructions:options.instructions|| (options.changeInstructions&&state.runtimeReads>1?'Reply in Malayalam.':''),context:{brand:{voice:'Warm'},lessons:[]}};
    }},
    './conversation-sales.mjs':{conversationSalesWindows:()=>({sevenDays:{from:'2026-10-21',to:'2026-10-27'},thirtyDays:{from:'2026-09-28',to:'2026-10-27'},completeThirtyDays:{from:'2026-09-27',to:'2026-10-26'},observedAt:'2026-10-27T10:00:00Z'}),requestedSalesCategory:()=>null,conversationProductCatalog:async()=>{state.fullEvidenceReads++;return {};},conversationProductSales:async()=>{state.fullEvidenceReads++;return options.posterSales||{};}},
  };
  const exports={};new Function('exports','require',compiled)(exports,id=>modules[id]||{});
  return {state,work,run:()=>exports.runConversationTask(admin,reader,'task')};
}

test('accepted status uses no model, no broad evidence and no own work lease; normal message/finalization paths remain',async()=>{
  const h=harness();await h.run();
  assert.equal(h.state.calls,0);assert.equal(h.state.workStarts,0);assert.equal(h.state.fullEvidenceReads,0);assert.equal(h.state.historyReads,0);
  assert.deepEqual(h.state.liveReads,[['sales']]);assert.equal(h.state.agent_tasks[0].status,'completed');assert.equal(h.state.agent_threads[0].status,'completed');
  assert.equal(h.state.agent_messages.length,1);assert.match(h.state.agent_messages[0].content,/No other live work/);assert.equal(h.state.agent_messages[0].metadata.response_mode,'deterministic');
  assert.ok(h.state.usage.some(row=>row.task?.id==='task'));assert.ok(h.state.usage.some(row=>row.event==='deterministic_reuse'));
  assert.ok(h.state.reads.filter(row=>['agent_events','reports'].includes(row.table)).every(row=>!row.admin));
});

test('status preserves a separate live job from the same agent while excluding only the status request',async()=>{
  const h=harness();await h.work.run({agentId:'sales',kind:'sales',timeoutMs:5000},async()=>{await h.run();});
  assert.equal(h.state.workStarts,0);assert.match(h.state.agent_messages[0].content,/Working now: Reviewing recorded sales/);
});

test('role revocation during a read blocks saved business data and never reaches a model',async()=>{
  const h=harness({afterActivityRead:state=>{state.profiles[0].role='creative_head';}});await h.run();
  assert.equal(h.state.calls,0);assert.equal(h.state.agent_tasks[0].status,'failed');assert.ok(h.state.agent_messages.every(row=>row.role==='error'));assert.doesNotMatch(h.state.agent_messages[0].content,/Previous analysis|Visible report/);assert.deepEqual(h.state.liveReads,[]);
});

test('disabled agents and cancelled tasks are rechecked before exposing deterministic results',async()=>{
  const disabled=harness({afterActivityRead:state=>{state.agents[0].enabled=false;}});await disabled.run();
  assert.equal(disabled.state.agent_tasks[0].status,'failed');assert.ok(disabled.state.agent_messages.every(row=>row.role==='error'));
  const cancelled=harness({afterActivityRead:state=>{state.agent_tasks[0].status='cancelled';}});await cancelled.run();
  assert.equal(cancelled.state.agent_tasks[0].status,'cancelled');assert.equal(cancelled.state.agent_messages.length,0);assert.equal(cancelled.state.calls,0);
});

test('saved preferences, changed preferences, ambiguous prompts and requested meetings keep the model workflow',async()=>{
  for(const options of [{instructions:'Reply in Malayalam.'},{changeInstructions:true},{prompt:'Explain why sales changed'},{meeting:true}]) {
    const h=harness(options);await h.run();assert.equal(h.state.calls,1,JSON.stringify({options,task:h.state.agent_tasks[0],rawError:h.state.rawError}));assert.equal(h.state.workStarts,1);assert.equal(h.state.fullEvidenceReads,options.prompt?2:0);assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);
    assert.ok(h.state.agent_messages.some(row=>row.content==='Model fallback answer'));
  }
});

test('numeric direct reads use only requester-scoped dashboard data and preserve missing-source coverage',async()=>{
  const h=harness({prompt:'Show performance totals for last 7 days',metricsError:{message:'Private query details'}});await h.run();
  assert.equal(h.state.calls,0);assert.equal(h.state.fullEvidenceReads,0);assert.equal(h.state.historyReads,0);assert.equal(h.state.workStarts,0);
  const answer=h.state.agent_messages[0].content;assert.match(answer,/unknown, not zero/);assert.match(answer,/UTC date buckets/);assert.doesNotMatch(answer,/Private query details|₹0/);
  assert.ok(h.state.reads.filter(row=>row.table==='dashboard_report').every(row=>!row.admin));
});

test('an explicit head handoff makes one reviewed specialist call and one ChatGPT final call',async()=>{
  const agents=[
    {id:'sales',name:'Sales Head',role_desc:'Sales leadership',department_id:'insights',is_lead:true,enabled:true},
    {id:'analyst',name:'Sales Analyst',role_desc:'Product sales specialist',department_id:'insights',is_lead:false,enabled:true},
  ];
  const h=harness({agents,prompt:'Ask Sales Analyst to review recorded stock and sales'});await h.run();
  assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);
  assert.equal(h.state.calls,2);
  assert.deepEqual(h.state.callOptions.map(x=>x.useCase),['reviewed_specialist','decision']);
  assert.deepEqual(h.state.callOptions.map(x=>x.tier),['worker','manager']);
  assert.equal(h.state.fullEvidenceReads,2,'only requested product catalogue and 7-day sales are read');
  assert.ok(h.state.agent_messages.some(m=>m.role==='handoff'&&m.recipient_agent_id==='analyst'));
});

test('a Creative head assigns a top-selling ad poster to Sales and Design across departments without a text-model call',async()=>{
  const agents=[
    {id:'creativeDirector',name:'Creative Director',role_desc:'Creative head',department_id:'creative',is_lead:true,enabled:true},
    {id:'sales',name:'Sales Analyst',role_desc:'Shopify sales',department_id:'insights',is_lead:false,enabled:true},
    {id:'designer',name:'Banner Designer',role_desc:'Ad images',department_id:'creative',is_lead:false,enabled:true},
  ];
  const photo='https://cdn.shopify.com/s/files/1/1234/files/ring.webp';
  const h=harness({agents,hostId:'creativeDirector',prompt:'Find the top-selling product from the latest complete 30 days of recorded Shopify sales, verify it is available and has an official photo, then ask the right design agent to generate an ad poster for human review. Do not publish it.',
    profiles:[{id:'user',role:'creative_head'}],departments:[{id:'creative',human_head_role:'creative_head'},{id:'insights',human_head_role:'ecom_manager'}],
    posterSales:{available:true,data:[{product_id:'1',units:24},{product_id:'2',units:21}]},
    productStock:[{id:'1',title:'Sold-out ring',status:'ACTIVE',stock:0,image_url:photo},{id:'2',title:'Available ring',status:'ACTIVE',stock:3,stock_source:'odoo',image_url:photo}]});
  await h.run();
  assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);
  assert.equal(h.state.calls,0);
  assert.deepEqual(h.state.designOrders.map(order=>({format:order.format,productIds:order.productIds})),[{format:'portrait',productIds:[2]}]);
  assert.deepEqual(h.state.agent_messages.filter(row=>row.role==='handoff').map(row=>row.recipient_agent_id),['sales','designer']);
  assert.match(h.state.agent_messages.at(-1).content,/studio\?made=11111111/);
  assert.match(h.state.agent_messages.at(-1).content,/Higgsfield generation is queued/);
  assert.doesNotMatch(h.state.agent_messages.at(-1).content,/Create the image in ChatGPT|image is complete/);
  assert.deepEqual(h.state.generations,[{source:'design',id:'11111111-1111-4111-8111-111111111111',userId:'user',role:'creative_head',projectScope:'thread:thread'}]);
  assert.equal(h.state.agent_messages.at(-1).metadata.outcome,'design_requested');
  assert.ok(h.state.reads.filter(row=>row.table==='product_stock').every(row=>!row.admin));
});

test('a head can request a cross-department specialist contribution while all business reads keep the requester client',async()=>{
  const agents=[
    {id:'creativeDirector',name:'Creative Director',role_desc:'Creative head',department_id:'creative',is_lead:true,enabled:true},
    {id:'sales',name:'Sales Analyst',role_desc:'Recorded Shopify sales',department_id:'insights',is_lead:false,enabled:true},
  ];
  const h=harness({agents,hostId:'creativeDirector',prompt:'Ask Sales Analyst to review sales for this campaign',
    profiles:[{id:'user',role:'creative_head'}],departments:[{id:'creative',human_head_role:'creative_head'},{id:'insights',human_head_role:'ecom_manager'}]});
  await h.run();
  assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);
  assert.ok(h.state.agent_messages.some(row=>row.role==='handoff'&&row.recipient_agent_id==='sales'));
  assert.ok(h.state.reads.filter(row=>['dashboard_report','product_stock','orders_daily','connections'].includes(row.table)).every(row=>!row.admin));
});

test('Jev only removes the head planning call after an accepted high-confidence route',async()=>{
  const agents=[
    {id:'sales',name:'Sales Head',role_desc:'Sales leadership',department_id:'insights',is_lead:true,enabled:true},
    {id:'analyst',name:'Sales Analyst',role_desc:'Product sales specialist',department_id:'insights',is_lead:false,enabled:true},
  ];
  const confident=harness({agents,prompt:'Prepare product sales analysis',jevStatus:'connected',jevAnswer:{route:{choice:'analyst',confidence:0.95,probabilities:{analyst:0.94,direct:0.06}}}});
  await confident.run();
  assert.equal(confident.state.jevCalls,1);assert.equal(confident.state.calls,2);
  assert.deepEqual(confident.state.callOptions.map(x=>x.useCase),['reviewed_specialist','decision']);
  const uncertain=harness({agents,prompt:'Prepare product sales analysis',jevStatus:'connected'});await uncertain.run();
  assert.equal(uncertain.state.jevCalls,1);assert.equal(uncertain.state.calls,1);
  assert.equal(uncertain.state.agent_tasks[0].status,'completed',uncertain.state.rawError);
  const failed=harness({agents,prompt:'Prepare product sales analysis',jevStatus:'connected',jevError:new Error('private provider detail')});await failed.run();
  assert.equal(failed.state.jevCalls,1);assert.equal(failed.state.calls,0);
  assert.equal(failed.state.agent_tasks[0].status,'failed');
  assert.match(failed.state.agent_messages[0].content,/Jev could not route/);
  assert.doesNotMatch(failed.state.agent_messages[0].content,/private provider detail/);
});

test('a different requester cannot claim or read this task',async()=>{
  const h=harness({userId:'another-user'});await h.run();assert.equal(h.state.calls,0);assert.equal(h.state.agent_tasks[0].status,'queued');assert.equal(h.state.agent_messages.length,0);assert.equal(h.state.runtimeReads,0);
});

test('a revision passes the original requirements to its specialist and the complete contribution to the final head',async()=>{
  const host={id:'creativeDirector',name:'Creative Director',role_desc:'Creative head',department_id:'creative',is_lead:true,enabled:true};
  const worker={id:'copywriter',name:'Copywriter',role_desc:'Campaign copy',department_id:'creative',is_lead:false,enabled:true};
  const brief='Ask Copywriter to write three Instagram captions for product Lotus 42 using recorded product sales. Keep the wording in Malayalam and do not invent a discount.';
  const draft='Prior opening. '+ 'Earlier campaign copy. '.repeat(140)+' Keep the verified-product qualification.';
  const contribution='Complete premium captions. '+ 'Specific caption and evidence. '.repeat(150)+' FINAL CAVEAT: stock is unknown; do not promise availability.';
  assert.ok(contribution.length>1800&&contribution.length<6000);
  const history=[{thread_id:'thread',task_id:'prior',role:'assistant',agent_id:host.id,content:draft},{thread_id:'thread',task_id:'prior',role:'user',content:brief}];
  const h=harness({agents:[host,worker],hostId:host.id,profiles:[{id:'user',role:'creative_head'}],departments:[{id:'creative',human_head_role:'creative_head'}],prompt:'Make it more premium.',history,
    answer:call=>({reply:call===1?contribution:'Final complete draft.'})});
  await h.run();
  assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);
  assert.equal(h.state.calls,2);
  assert.ok(h.state.fullEvidenceReads>=2,'the follow-up retains product and sales evidence reads');
  const specialist=h.state.inputs[0],final=h.state.inputs[1];
  assert.equal(specialist.privateConversation.find(m=>m.role==='user').content,brief);
  assert.equal(specialist.privateConversation.find(m=>m.role==='assistant').content,draft);
  assert.match(specialist.retryOf,/Malayalam/);
  assert.equal(final.discussion.find(m=>m.agentId===worker.id).content,contribution);
  assert.match(h.state.systems[0],/plainly and completely/);
  assert.match(h.state.systems[0],/earlier requirements/);
});

test('repeating an edit requests another revision instead of reusing the prior answer',async()=>{
  const original={thread_id:'thread',task_id:'original',role:'user',content:'Write a product description for Lotus 42. Keep the material claims verified.'};
  const draft={thread_id:'thread',task_id:'original',role:'assistant',agent_id:'sales',content:'Initial supported description.'};
  const prompt='Make it more premium.';
  const first=harness({prompt,history:[draft,original],answer:()=>({reply:'First premium revision.'})});
  await first.run();
  const answer=first.state.agent_messages.find(m=>m.metadata?.phase==='answer');
  assert.ok(answer);
  const history=[{...answer,task_id:'previous',created_at:new Date().toISOString()},{thread_id:'thread',task_id:'previous',role:'user',content:prompt},draft,original];
  const second=harness({prompt,history,answer:()=>({reply:'Further refined premium revision.'})});
  await second.run();
  assert.equal(second.state.agent_tasks[0].status,'completed',second.state.rawError);
  assert.equal(second.state.calls,1);
  assert.equal(second.state.usage.some(row=>row.event==='checkpoint_reuse'),false);
  assert.equal(second.state.agent_messages.at(-1).content,'Further refined premium revision.');
});

test('an explicit poster revision reuses the private-thread design and queues one generation without a text-model call',async()=>{
  const designId='11111111-1111-4111-8111-111111111111';
  const host={id:'creativeDirector',name:'Creative Director',role_desc:'Creative head',department_id:'creative',is_lead:true,enabled:true};
  const h=harness({agents:[host],hostId:host.id,profiles:[{id:'user',role:'creative_head'}],departments:[{id:'creative',human_head_role:'creative_head'}],prompt:'Redesign this poster with a blue background',
    history:[{thread_id:'thread',role:'assistant',metadata:{design_id:designId},content:'Prepared the poster handoff.'}],designs:[{id:designId,format:'portrait',requested_by:'user',status:'ready'}]});
  await h.run();assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);assert.equal(h.state.calls,0);
  assert.deepEqual(h.state.designRevisions,[{source:'design',id:designId,note:'Redesign this poster with a blue background'}]);
  assert.equal(h.state.designOrders.length,0);assert.match(h.state.agent_messages.at(-1).content,/same saved poster and product/);assert.match(h.state.agent_messages.at(-1).content,/Higgsfield generation is queued/);
  assert.equal(h.state.generations.length,1);assert.equal(h.state.generations[0].projectScope,'thread:thread');
  assert.ok(h.state.reads.filter(row=>row.table==='designs').every(row=>!row.admin));
});

test('unlinked, inaccessible and carousel designs cannot be mutated by single-image chat revisions',async()=>{
  const designId='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
  const host={id:'creativeDirector',name:'Creative Director',role_desc:'Creative head',department_id:'creative',is_lead:true,enabled:true};
  const common={agents:[host],hostId:host.id,profiles:[{id:'user',role:'creative_head'}],departments:[{id:'creative',human_head_role:'creative_head'}],prompt:'Redesign this poster with a blue background',history:[{thread_id:'thread',role:'assistant',metadata:{design_id:designId}}]};
  for(const options of [{prompt:`Redesign the poster /studio?made=${foreign}`},{designs:[]},{designs:[{id:designId,requested_by:'user',format:'carousel_card',carousel_id:foreign}]}]){
    const h=harness({...common,...options});await h.run();assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);assert.equal(h.state.calls,0);assert.equal(h.state.designRevisions.length,0);assert.equal(h.state.designOrders.length,0);assert.equal(h.state.generations.length,0);
  }
});

test('a disconnected or blocked image request reports its saved state and never claims completion',async()=>{
  const designId='11111111-1111-4111-8111-111111111111';
  const host={id:'creativeDirector',name:'Creative Director',department_id:'creative',is_lead:true,enabled:true};
  for(const generation of [{started:false,job:null,reason:'Connect Higgsfield in Settings to generate automatically.'},{started:false,job:{id:'job',state:'blocked'},reason:'Not enough Higgsfield credits.'}]){
    const h=harness({agents:[host],hostId:host.id,profiles:[{id:'user',role:'creative_head'}],departments:[{id:'creative',human_head_role:'creative_head'}],prompt:'Redesign this poster with a blue background',
      history:[{thread_id:'thread',role:'assistant',metadata:{design_id:designId}}],designs:[{id:designId,format:'portrait',requested_by:'user',status:'ready'}],generation});
    await h.run();const reply=h.state.agent_messages.at(-1).content;
    assert.equal(h.state.generations.length,1);assert.equal(h.state.designRevisions.length,1);
    assert.match(reply,/artwork request is saved/);assert.ok(reply.includes(generation.reason));assert.match(reply,/No image is complete yet/);
    assert.doesNotMatch(reply,/generation is queued|image is ready|Create the image in ChatGPT/);
  }
});

test('chat poster revisions keep ChatGPT imports manual, honor provider directions, and retain the saved design',async()=>{
  const designId='11111111-1111-4111-8111-111111111111';
  const host={id:'creativeDirector',name:'Creative Director',department_id:'creative',is_lead:true,enabled:true};
  const common={agents:[host],hostId:host.id,profiles:[{id:'user',role:'creative_head'}],departments:[{id:'creative',human_head_role:'creative_head'}],history:[{thread_id:'thread',role:'assistant',metadata:{design_id:designId}}]};
  for(const [origin,direction,count] of [['chatgpt_import','',0],['higgsfield_oauth',' using ChatGPT',0],['chatgpt_import',' using Higgsfield',1],['higgsfield_oauth',". Don't use Higgsfield",0]]){
    const h=harness({...common,prompt:`Redesign this poster with blue lighting${direction}`,designs:[{id:designId,format:'portrait',requested_by:'user',status:'ready',artwork_origin:origin}]});
    await h.run();assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);
    assert.equal(h.state.designRevisions.length,1);assert.equal(h.state.designRevisions[0].id,designId);assert.equal(h.state.designOrders.length,0);assert.equal(h.state.generations.length,count);
    assert.match(h.state.agent_messages.at(-1).content,count?/Higgsfield generation is queued/:/ChatGPT brief prepared/);
    if(!count)assert.match(h.state.agent_messages.at(-1).content,/does not generate ChatGPT images automatically/);
  }
});

test('chat carousel revisions keep per-card providers and explicit overrides apply to the whole set',async()=>{
  const setId='22222222-2222-4222-8222-222222222222';
  const host={id:'creativeDirector',name:'Creative Director',department_id:'creative',is_lead:true,enabled:true};
  const cards=Array.from({length:5},(_,index)=>({id:`card-${index}`,carousel_id:setId,carousel_index:index+1,artwork_origin:index<3?'chatgpt_import':'higgsfield_oauth'}));
  for(const [direction,count] of [['',2],[' using ChatGPT',0],[' using Higgsfield',5]]){
    const h=harness({agents:[host],hostId:host.id,profiles:[{id:'user',role:'creative_head'}],departments:[{id:'creative',human_head_role:'creative_head'}],designs:cards,prompt:`Redesign all five carousel cards${direction} /studio?carousel=${setId}`});
    await h.run();assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);
    assert.equal(h.state.carouselRevisions.length,1);assert.equal(h.state.generations.length,count);assert.equal(h.state.designOrders.length,0);
    if(!direction){assert.deepEqual(h.state.generations.map(row=>row.id),['card-3','card-4']);assert.match(h.state.agent_messages.at(-1).content,/ChatGPT briefs prepared for 3 images/);}
    if(!count)assert.match(h.state.agent_messages.at(-1).content,/ChatGPT briefs prepared for 5 images/);
  }
});

test('new chat posters and carousels honor explicit providers while unspecified requests keep Higgsfield',async()=>{
  const agents=[{id:'creativeDirector',name:'Creative Director',department_id:'creative',is_lead:true,enabled:true},{id:'sales',name:'Sales Analyst',department_id:'insights',is_lead:false,enabled:true},{id:'designer',name:'Banner Designer',department_id:'creative',is_lead:false,enabled:true}];
  const common={agents,hostId:'creativeDirector',profiles:[{id:'user',role:'creative_head'}],departments:[{id:'creative',human_head_role:'creative_head'},{id:'insights',human_head_role:'ecom_manager'}],posterSales:{available:true,data:[{product_id:'1',units:24}]},productStock:[{id:'1',title:'Fine chain',status:'ACTIVE',stock:3,stock_source:'odoo',image_url:'https://cdn.shopify.com/s/files/1/1234/files/chain.webp'}]};
  for(const carousel of [false,true])for(const provider of ['', ' using ChatGPT', ' using Higgsfield']){
    const h=harness({...common,prompt:`Create ${carousel?'a five-card carousel of top selling chains':'an ad poster for the top selling product'}${provider}. Do not publish it.`});
    await h.run();assert.equal(h.state.agent_tasks[0].status,'completed',h.state.rawError);
    const count=carousel?5:1,manual=provider===' using ChatGPT';
    assert.equal(h.state.generations.length,manual?0:count);
    assert.equal(h.state.carouselOrders.length,carousel?1:0);assert.equal(h.state.designOrders.length,carousel?0:1);
    assert.match(h.state.agent_messages.at(-1).content,manual?/ChatGPT briefs? prepared/:/Higgsfield generation is queued/);
    if(manual)assert.match(h.state.agent_messages.at(-1).content,/does not generate ChatGPT images automatically/);
  }
});
