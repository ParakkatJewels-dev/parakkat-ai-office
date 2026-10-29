import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {observeOutcome} from '../src/lib/outcomes/core.mjs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const users={admin:'00000000-0000-4000-8000-000000000001',creative:'00000000-0000-4000-8000-000000000002',perf:'00000000-0000-4000-8000-000000000003',ecom:'00000000-0000-4000-8000-000000000004',viewer:'00000000-0000-4000-8000-000000000005'};
const roles={admin:'super_admin',creative:'creative_head',perf:'perf_marketer',ecom:'ecom_manager',viewer:'viewer'};
const code=n=>e=>e.code===n;
let db;
async function as(user,sql,args=[],role='authenticated'){await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[users[user]||'']);await db.exec(`set role ${role}`);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
const service=(sql,args=[])=>as(null,sql,args,'service_role');
const row=async(id)=>(await db.query('select * from outcome_initiatives where id=$1',[id])).rows[0];
async function task(fields={}){const r={kind:'head_task',department_id:'creative',owner_agent:'creativeDirector',created_by:users.creative,title:'Prepare internal copy',...fields};return(await db.query(`insert into automation_tasks(${Object.keys(r).join(',')}) values(${Object.keys(r).map((_,i)=>`$${i+1}`).join(',')}) returning *`,Object.values(r))).rows[0];}
async function materialize(){return(await service('select materialize_outcome_sources() n')).rows[0].n;}
async function manual(user='creative',extra={}){const payload={requestId:randomUUID(),departmentId:'creative',ownerAgent:'creativeDirector',title:'Track outcome',...extra};return {payload,id:(await as(user,'select mutate_outcome($1,null,null,$2) id',['create_manual',payload])).rows[0].id};}
const mutate=(id,revision,action,payload,user='creative')=>as(user,'select mutate_outcome($1,$2,$3,$4) id',[action,id,revision,payload]);
const campaign=(id='c1',extra={})=>({campaign_id:id,name:'Repeated campaign name',configured_status:'ACTIVE',effective_status:'ACTIVE',currency:'INR',account_timezone:'Asia/Kolkata',budget_scope:'campaign',details:{metrics_supported:true},...extra});
const metric=(ad='ad1',extra={})=>({day:'2026-10-20',ad_id:ad,campaign_id:'c1',campaign_name:'Repeated campaign name',spend:100,impressions:1000,clicks:10,purchases:1,revenue:200,currency:'INR',account_timezone:'Asia/Kolkata',conversion_definition:'purchase',...extra});
const coverage=(extra={})=>({selected:true,status:'complete',inventory_complete:true,metrics_complete:true,window_from:'2026-10-01',window_to:'2026-10-25',last_attempt_at:new Date().toISOString(),conversion_definition:'purchase',coverage:{purchase_tracking_verified:true},...extra});
const snapshot=(provider='meta',account='a1',campaigns=[campaign()],metrics=[metric()],c=coverage(),role='service_role')=>as(null,'select store_campaign_account_snapshot($1,$2,$3,$4,$5) result',[provider,account,campaigns,metrics,c],role);
before(async()=>{
 db=new PGlite();await db.exec(`create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text);alter table storage.objects enable row level security;create publication supabase_realtime;
 create role authenticated nologin;create role anon nologin;create role service_role nologin bypassrls;`);
 await db.exec(read('supabase/migrations/20261024000000_init.sql').replace('create extension if not exists pgcrypto;',''));await db.exec(read('supabase/seed.sql'));
 await db.exec('grant usage on schema public,auth to authenticated,anon,service_role;grant select on all tables in schema public to authenticated;alter default privileges in schema public grant all on tables to authenticated,anon,service_role;');
 for(const file of ['20261024000800_ad_account_column.sql','20261026000700_business_automation.sql','20261026001100_head_task_handoff.sql','20261026001200_outcome_monitoring.sql'])await db.exec(read(`supabase/migrations/${file}`));
 for(const [who,id] of Object.entries(users)){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('update profiles set role=$1 where id=$2',[roles[who],id]);}
});
after(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec("reset role;truncate outcome_initiatives,campaign_registry,campaign_sync_coverage,automation_tasks,reports,campaigns,ad_insights_daily restart identity cascade;update outcome_scan_state set materialize_cursors='{}',materialize_limited=false,monitor_after=null,monitor_limited=false;update departments set human_head_role='creative_head' where id='creative';update agents set enabled=true;");
 for(const [who,id] of Object.entries(users))await db.query('update profiles set role=$1 where id=$2',[roles[who],id]);
});
test('initial materialization copies all department work while acceptance remains distinct from execution and results',async()=>{
 const t=await task({status:'completed'});await db.exec("insert into reports(department_id,author_agent,lead_agent,title,body,status) values('creative','copywriter','creativeDirector','Accepted report','Private report body','accepted')");
 assert.equal((await materialize()).processed,2);const rows=(await db.query('select * from outcome_initiatives order by source_kind')).rows;
 assert.ok(rows.every(r=>r.approval_state==='approved'&&r.execution_state==='not_started'&&r.outcome_state==='awaiting_data'));
 assert.ok(rows.every(r=>!r.summary.includes('Private report body')));const rev=rows.find(r=>r.source_task_id===t.id).revision;
 await materialize();assert.equal((await db.query('select revision from outcome_initiatives where source_task_id=$1',[t.id])).rows[0].revision,rev);
});
test('RLS follows current department ownership, profile role and original report visibility',async()=>{
 await task();await db.exec("insert into reports(department_id,author_agent,title,body,status) values('creative','copywriter','Unforwarded report','Secret draft','lead_review')");await materialize();
 assert.equal((await as('creative','select * from outcome_initiatives')).rows.length,1);assert.equal((await as('admin','select * from outcome_initiatives')).rows.length,2);
 for(const who of ['perf','ecom','viewer',null])assert.equal((await as(who,'select * from outcome_initiatives')).rows.length,0);
 await db.exec("update departments set human_head_role='ecom_manager' where id='creative'");assert.equal((await as('creative','select * from outcome_initiatives')).rows.length,0);assert.equal((await as('ecom','select * from outcome_initiatives')).rows.length,1);
 await db.query("update profiles set role='viewer' where id=$1",[users.admin]);assert.equal((await as('admin','select * from outcome_initiatives')).rows.length,0);
});
test('campaign outcome copies remain gated by current campaign approval readership',async()=>{
 const c=(await db.query("insert into campaigns(name,plan,status) values('Private campaign','{}','draft') returning id")).rows[0];await materialize();assert.equal((await as('perf','select * from outcome_initiatives')).rows.length,0);
 await db.query("insert into approvals(campaign_id,required_roles) values($1,array['perf_marketer']::app_role[])",[c.id]);assert.equal((await as('perf','select * from outcome_initiatives')).rows.length,1);
 await db.query("update approvals set required_roles=array['creative_head']::app_role[] where campaign_id=$1",[c.id]);assert.equal((await as('perf','select * from outcome_initiatives')).rows.length,0);
});
test('browser roles cannot forge source states, snapshots, observations or private records',async()=>{
 const {id}=await manual();
 for(const table of ['outcome_initiatives','outcome_incidents','outcome_experiments','campaign_registry','campaign_sync_coverage','outcome_scan_state'])await assert.rejects(as('admin',`delete from ${table}`),code('42501'));
 for(const role of ['authenticated','anon']){await assert.rejects(snapshot('meta','a1',[],[],coverage(),role),code('42501'));await assert.rejects(as(null,'select materialize_outcome_sources()',[],role),code('42501'));await assert.rejects(as(null,'select save_outcome_observation($1,1,$2)',[id,{}],role),code('42501'));}
 await assert.rejects(mutate(id,1,'approve',{status:'provider_confirmed'}),code('22023'));
});
test('manual initiatives and revision-safe configuration preserve unknown targets and reject cross-department owners',async()=>{
 const {id,payload}=await manual();assert.equal((await as('creative','select mutate_outcome($1,null,null,$2) id',['create_manual',payload])).rows[0].id,id);
 const cfg={metric:'roas',direction:'higher',target:null,minSample:null,sampleMetric:'purchases',windowDays:7,maturityHours:48,maxDataAgeHours:24};
 await mutate(id,1,'configure',{metricConfig:cfg,baseline:{value:0,at:null,source:'Verified baseline'},dueAt:null});assert.equal((await row(id)).metric_config.target,null);assert.equal((await row(id)).baseline.value,0);
 await assert.rejects(mutate(id,1,'configure',{dueAt:null}),code('40001'));await assert.rejects(mutate(id,2,'configure',{ownerAgent:'perfLead'}),code('22023'));await assert.rejects(mutate(id,2,'configure',{dueAt:null},'perf'),code('42501'));
 await assert.rejects(mutate(id,2,'configure',{metricConfig:{...cfg,minSample:0}}),code('22023'));
 await mutate(id,2,'configure',{metricConfig:null,nextReviewAt:null});assert.equal((await row(id)).metric_config,null);
});
test('manual request identifiers cannot silently be reused for different initiatives',async()=>{
 const {payload}=await manual();await assert.rejects(as('creative','select mutate_outcome($1,null,null,$2)',['create_manual',{...payload,title:'Different work'}]),code('40001'));
 await assert.rejects(manual('viewer'),code('42501'));await assert.rejects(manual('perf'),code('42501'));
});
test('notes are bounded and do not approve work or claim execution',async()=>{
 const {id}=await manual();for(let i=0;i<23;i++){const r=await row(id);await mutate(id,r.revision,'note',{note:`Note ${i}`});}
 const r=await row(id);assert.equal(r.notes.length,20);assert.equal(r.notes[0].text,'Note 3');assert.equal(r.approval_state,'proposed');assert.equal(r.execution_state,'not_started');
 await assert.rejects(mutate(id,r.revision,'note',{note:'x'.repeat(3001)}),code('22023'));
});
test('experiments record plans and human evidence with maturity and version gates, never external actions',async()=>{
 const {id}=await manual(),payload={requestId:randomUUID(),hypothesis:'A shorter headline improves qualified clicks',primaryMetric:'qualified_click_rate',guardrails:['No budget increase'],baseline:{value:1,at:null,source:'Recorded sample'},plannedChange:'Draft one shorter headline',evaluationAt:'2026-01-01T00:00:00Z'};
 const e=(await mutate(id,1,'experiment_create',payload)).rows[0].id;
 assert.equal((await row(id)).execution_state,'not_started');assert.equal((await mutate(id,1,'experiment_create',payload)).rows[0].id,e);
 await assert.rejects(mutate(e,1,'experiment_evaluate',{verdict:'improved',summary:'Improved',evidence:[]}),code('22023'));
 await mutate(e,1,'experiment_evaluate',{verdict:'improved',summary:'Human reviewed observed improvement; causality unknown.',evidence:[{source:'Manual review',detail:'Actual recorded comparison'}]});
 assert.equal((await row(id)).outcome_state,'improving');assert.equal((await row(id)).observation.manualEvaluation.verdict,'improved');assert.equal((await row(id)).execution_state,'not_started');
 await assert.rejects(mutate(e,1,'experiment_evaluate',{verdict:'harmful',summary:'Stale overwrite',evidence:[]}),code('40001'));
});
test('future evaluations can record inconclusive evidence but not a premature win',async()=>{
 const {id}=await manual();const e=(await mutate(id,1,'experiment_create',{requestId:randomUUID(),hypothesis:'Test',primaryMetric:'purchases',guardrails:[],baseline:null,plannedChange:'Draft proposal',evaluationAt:'2099-01-01T00:00:00Z'})).rows[0].id;
 await assert.rejects(mutate(e,1,'experiment_evaluate',{verdict:'improved',summary:'Too early',evidence:[{source:'x',detail:'x'}]}),code('22023'));
 await mutate(e,1,'experiment_evaluate',{verdict:'inconclusive',summary:'Awaiting mature data',evidence:[]});
});
test('atomic snapshots preserve same-name campaigns and same ad IDs across separate accounts and zero-activity campaigns',async()=>{
 await snapshot('meta','a1',[campaign(),campaign('zero')],[metric()]);await snapshot('meta','a2',[campaign()],[metric()]);
 assert.equal((await db.query('select count(*)::int n from campaign_registry')).rows[0].n,3);assert.equal((await db.query('select count(*)::int n from ad_insights_daily')).rows[0].n,2);
 await materialize();assert.equal((await as('perf','select * from outcome_initiatives')).rows.length,3);assert.equal((await as('creative','select * from campaign_registry')).rows.length,0);
});
test('empty complete windows remove stale metrics while partial and failed snapshots retain history and signal gaps',async()=>{
 await snapshot();await snapshot('meta','a1',[],[],coverage({status:'partial',inventory_complete:false,metrics_complete:false}));
 assert.equal((await db.query('select count(*)::int n from ad_insights_daily')).rows[0].n,1);assert.equal((await db.query('select selected from campaign_registry')).rows[0].selected,true);assert.equal((await db.query('select complete from campaign_sync_coverage')).rows[0].complete,false);
 await snapshot('meta','a1',[],[],coverage({status:'failed',inventory_complete:false,metrics_complete:false,window_from:null,window_to:null}));
 assert.equal((await db.query('select count(*)::int n from ad_insights_daily')).rows[0].n,1);
 await snapshot('meta','a1',[],[],coverage());assert.equal((await db.query('select count(*)::int n from ad_insights_daily')).rows[0].n,0);assert.equal((await db.query('select selected from campaign_registry')).rows[0].selected,false);
});
test('unknown conversion definitions stay null and partial conversion reads cannot claim complete coverage',async()=>{
 await snapshot('google','g1',[campaign()],[metric('a',{purchases:99,revenue:999,conversion_definition:'unknown'})],coverage({status:'partial',complete:false,conversion_definition:'unknown'}));
 const m=(await db.query('select purchases,revenue,conversion_definition from ad_insights_daily')).rows[0];assert.equal(m.purchases,null);assert.equal(m.revenue,null);assert.equal(m.conversion_definition,'unknown');
 assert.equal((await db.query('select complete from campaign_sync_coverage')).rows[0].complete,false);
 const id=(await db.query('select id from campaign_registry')).rows[0].id;const facts=(await service('select read_outcome_campaign_metrics($1,$2,$3) facts',[id,'2026-10-01','2026-10-25'])).rows[0].facts;
 assert.equal(facts.purchase_known,false);assert.equal(facts.purchases,null);assert.equal(facts.spend,100);
});
test('stale snapshots and invalid metric identities cannot overwrite fresher inventory or delete valid data',async()=>{
 await snapshot('meta','a1',[campaign()], [metric()],coverage({last_attempt_at:'2026-01-10T00:00:00Z'}));
 const old=await snapshot('meta','a1',[],[],coverage({last_attempt_at:'2026-01-09T00:00:00Z'}));assert.equal(old.rows[0].result.saved,false);assert.equal((await db.query('select count(*)::int n from ad_insights_daily')).rows[0].n,1);
 await assert.rejects(snapshot('meta','a1',[campaign('other')],[metric('bad',{account_id:'foreign'})]),code('22023'));
 assert.equal((await db.query('select count(*)::int n from campaign_registry')).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from ad_insights_daily')).rows[0].n,1);
});
test('observation writes deduplicate unchanged incidents and resolve them without extra rows or revision churn',async()=>{
 const {id}=await manual();const observation={fingerprint:'same',outcome_state:'inconclusive',warnings:['Incomplete coverage'],evidence:[],incidents:[{problem_key:'coverage',severity:'warning',title:'Coverage missing',detail:'Read is incomplete',evidence:[]}]};
 await service('select save_outcome_observation($1,1,$2)',[id,observation]);const first=await row(id);assert.equal(first.revision,2);
 await service('select save_outcome_observation($1,2,$2)',[id,observation]);assert.equal((await row(id)).revision,2);assert.equal((await db.query('select count(*)::int n from outcome_incidents')).rows[0].n,1);
 assert.equal((await service('select save_outcome_observation($1,1,$2) ok',[id,{...observation,fingerprint:'stale'}])).rows[0].ok,false);
 await service('select save_outcome_observation($1,2,$2)',[id,{...observation,fingerprint:'resolved',outcome_state:'healthy',incidents:[]}]);assert.equal((await db.query('select status from outcome_incidents')).rows[0].status,'resolved');
 assert.equal((await as('perf','select * from outcome_incidents')).rows.length,0);
});
test('quality projection marks changed artifacts stale rather than showing a historical pass as current',async()=>{
 const h={humanRevision:0,revisionRound:0,headAgentId:'creativeDirector',plan:{assignments:[{agentId:'copywriter'}]},outputs:{copywriter:{body:'Final'}},review:{decision:'approve',finalMarkdown:'Final'},evidenceSnapshot:null,evidence:[]};
 h.quality={reviewerId:'outputQc',decision:'pass',note:'Checked',findings:[],checkedAt:new Date().toISOString(),artifact:{humanRevision:0,revisionRound:0,finalMarkdown:'Final',outputs:h.outputs,plan:h.plan,evidenceSnapshot:null,evidence:[]}};
 const t=await task({status:'running',state:{headWorkflow:h}});await materialize();let o=(await db.query('select * from outcome_initiatives where source_task_id=$1',[t.id])).rows[0];assert.equal(o.qa_review.current,true);assert.equal(o.approval_state,'qc_passed');
 await db.query("update automation_tasks set state=jsonb_set(jsonb_set(state,'{headWorkflow,revisionRound}','1'),'{headWorkflow,review,finalMarkdown}',to_jsonb('Changed'::text)) where id=$1",[t.id]);await materialize();o=await row(o.id);assert.equal(o.qa_review.current,false);assert.equal(o.qa_review.revisionRound,0);assert.equal(o.approval_state,'producing');
});

test('direct authenticated RPC rejects malformed evidence and guardrails before recording an outcome',async()=>{
 const {id}=await manual(),p={requestId:randomUUID(),hypothesis:'Test',primaryMetric:'purchases',guardrails:[],baseline:null,plannedChange:'Draft',evaluationAt:'2026-01-01T00:00:00Z'};
 for(const guardrails of [[{}],[null],[' '],['x'.repeat(501)],Array(9).fill('Guardrail')])await assert.rejects(mutate(id,1,'experiment_create',{...p,guardrails}),code('22023'));
 const e=(await mutate(id,1,'experiment_create',p)).rows[0].id;
 for(const evidence of [[{}],[null],[{source:3,detail:'x'}],[{source:' ',detail:'x'}],[{source:'x',detail:'x'.repeat(1501)}],Array(13).fill({source:'x',detail:'y'})])await assert.rejects(mutate(e,1,'experiment_evaluate',{verdict:'improved',summary:'Observed',evidence}),code('22023'));
 await assert.rejects(mutate(e,1,'experiment_evaluate',{summary:'Missing verdict',evidence:[]}),code('22023'));
 await assert.rejects(mutate(id,1,'experiment_create',{...p,primaryMetric:'different'}),code('40001'));
 assert.equal((await row(id)).outcome_state,'awaiting_data');assert.equal((await db.query('select status from outcome_experiments where id=$1',[e])).rows[0].status,'planned');
});
test('source materialization is bounded and subsequent refreshes continue beyond the cap',async()=>{
 await db.exec("insert into automation_tasks(kind,department_id,owner_agent,title) select 'head_task','creative','creativeDirector','Task '||n from generate_series(1,5001) n");
 const first=await materialize();assert.equal(first.processed,5000);assert.equal(first.limited,true);assert.equal(first.counts.task,5000);
 assert.equal((await db.query('select count(*)::int n from outcome_initiatives')).rows[0].n,5000);
 assert.equal((await as('creative','select read_outcome_monitoring_status() s')).rows[0].s.limited,true);
 assert.equal((await as('viewer','select read_outcome_monitoring_status() s')).rows[0].s,null);
 const next=await materialize();assert.equal(next.processed,1);assert.equal(next.limited,false);assert.equal((await db.query('select count(*)::int n from outcome_initiatives')).rows[0].n,5001);
});

test('legacy ad rollup separates identical display names by stable account campaign ad and currency identities',async()=>{
 await snapshot('meta','a1',[campaign()],[metric('ad1',{ad_name:'Same ad'})]);
 await snapshot('meta','a2',[campaign()],[metric('ad1',{ad_name:'Same ad',purchases:99,conversion_definition:'unknown'})]);
 const rows=(await db.query("select * from ad_rollup('2026-10-01',15)")).rows;
 assert.equal(rows.length,2);assert.ok(rows.every(r=>Number(r.spend)===100));assert.equal(rows.filter(r=>r.purchases===null).length,1);assert.equal(rows.filter(r=>Number(r.purchases)===1).length,1);
 await db.exec("insert into ad_insights_daily(day,platform,account_id,campaign_id,campaign_name,ad_id,ad_name,spend,clicks,purchases,revenue,conversion_definition,currency) values('2026-10-21','meta','a1','c1','Same campaign','ad1','Same ad',20,2,1,50,'purchase','USD')");
 assert.equal((await db.query("select * from ad_rollup('2026-10-01',15)")).rows.length,3);
});

test('lifecycle correction resolves only obsolete generated incidents while retaining their stable history',async()=>{
 await snapshot('meta','a1',[campaign('c1',{configured_status:'PAUSED',effective_status:'PAUSED'})],[]);await materialize();
 let o=(await db.query('select * from outcome_initiatives')).rows[0];const old={fingerprint:'old-rule',outcome_state:'awaiting_data',warnings:[],evidence:[],incidents:[{problem_key:'measurement_requirements',severity:'info',title:'Missing plan',detail:'Old historical inventory alert',evidence:[]}]};
 await service('select save_outcome_observation($1,$2,$3)',[o.id,o.revision,old]);const incident=(await db.query('select * from outcome_incidents')).rows[0];o=await row(o.id);
 const c=(await db.query('select * from campaign_registry')).rows[0],observation=observeOutcome(o,{campaign:c,recentActivity:{complete:true,window:{from:'2026-09-26',to:'2026-10-25',timezone:'Asia/Kolkata'},lastDeliveryAt:null},now:new Date('2026-10-26T12:00:00Z')});
 await service('select save_outcome_observation($1,$2,$3)',[o.id,o.revision,observation]);const after=(await db.query('select * from outcome_incidents')).rows;
 assert.equal(after.length,1);assert.equal(after[0].id,incident.id);assert.equal(after[0].status,'resolved');assert.equal((await row(o.id)).outcome_state,'inconclusive');assert.equal((await row(o.id)).execution_state,'not_started');
});
