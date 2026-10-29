import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import {headQualityArtifact} from '../src/lib/automation/head-task-core.mjs';
import {campaignArtifact} from '../src/lib/agents/quality-core.mjs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const users = Object.fromEntries(['admin','creative','ecom','viewer'].map((name,i) => [name, `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const roles = { admin:'super_admin', creative:'creative_head', ecom:'ecom_manager', viewer:'viewer' };
const code = expected => error => error.code === expected;
const result = { status:'review', summary:'The head approved the launch copy.', markdown:'Approved campaign copy with an evidence-backed offer.', evidence:[], warnings:[] };
let db;

function workflow(overrides={}) {
  const value = { version:1, phase:'handoff', headAgentId:'creativeDirector', humanRevision:0, revisionRound:0,
    plan:{ understanding:'Prepare launch copy', successCriteria:['Use approved facts'], assignments:[{agentId:'copywriter', task:'Draft launch copy', deliverable:'Launch copy'}] },
    outputs:{ copywriter:{body:'Completed specialist copy',summary:'Copy prepared',evidence:[],warnings:[],revision:0,blocked:false,missing:[]} },
    review:{decision:'approve',note:'The draft meets the brief and the facts supplied.',finalMarkdown:result.markdown,revisionRequests:[]}, ...overrides };
  value.quality={reviewerId:'outputQc',decision:'pass',note:'Independent check passed',findings:[],checkedAt:new Date().toISOString(),artifact:headQualityArtifact(value)};
  return value;
}
async function as(user, sql, params=[], role='authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.uid',$1,false)",[users[user]||'']);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql,params); } finally { await db.exec('reset role'); }
}
async function task(overrides={}) {
  const row={kind:'head_task',department_id:'creative',owner_agent:'creativeDirector',created_by:users.creative,title:'Prepare launch copy',
    status:'running',claimed_by:randomUUID(),lease_until:new Date(Date.now()+120000).toISOString(),
    input:{allowedDepartments:['creative']},state:{headWorkflow:workflow()},...overrides};
  const keys=Object.keys(row);
  return (await db.query(`insert into automation_tasks(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')}) returning *`,Object.values(row))).rows[0];
}
const handoff = async (row, { holder=row.claimed_by, outcome=result, role='service_role' }={}) =>
  (await as(null,'select handoff_head_task($1,$2,$3) id',[row.id,holder,outcome],role)).rows[0].id;
const current = async id => (await db.query('select * from automation_tasks where id=$1',[id])).rows[0];
const report = async id => (await db.query('select * from reports where id=$1',[id])).rows[0];
const decide = async (id, decision='accept', note=null, user='creative', revision=undefined) =>
  (await as(user,'select decide_report($1,$2,$3,$4) status',[id,decision,note,revision===undefined?(await report(id))?.revision:revision])).rows[0].status;
const cancel = async (row,{user='creative',revision=row.revision,role='service_role'}={}) =>
  (await as(null,'select cancel_head_task($1,$2,$3) id',[row.id,revision,users[user]],role)).rows[0].id;

before(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text);alter table storage.objects enable row level security;
    create publication supabase_realtime;create role authenticated nologin;create role anon nologin;create role service_role nologin bypassrls;`);
  await db.exec(read('supabase/migrations/20261024000000_init.sql').replace('create extension if not exists pgcrypto;',''));
  await db.exec(read('supabase/seed.sql'));
  await db.exec(`grant usage on schema public,auth to authenticated,anon,service_role;
    grant select on all tables in schema public to authenticated;
    alter default privileges in schema public grant all on tables to authenticated,anon,service_role;
    alter default privileges in schema public grant all on sequences to authenticated,anon,service_role;`);
  await db.exec(read('supabase/migrations/20261024000100_lock_functions.sql'));
  await db.exec('grant execute on function my_role(),my_depts(),is_admin() to authenticated;');
  await db.exec(read('supabase/migrations/20261026000700_business_automation.sql'));
  await db.exec(read('supabase/migrations/20261026001100_head_task_handoff.sql'));
  await db.exec(read('supabase/migrations/20261024000300_memory.sql'));
  await db.exec(read('supabase/migrations/20261026000600_agent_instructions.sql'));
  await db.exec('alter table creatives add column art_status text;');
  await db.exec(read('supabase/migrations/20261026001400_quality_review.sql'));
  await db.exec(read('supabase/migrations/20261024000700_sync_lock.sql'));
  await db.exec(read('supabase/migrations/20261026001500_campaign_rereview.sql'));
  for(const [name,id] of Object.entries(users)) {
    await db.query('insert into auth.users(id) values($1)',[id]);
    await db.query('update profiles set role=$1 where id=$2',[roles[name],id]);
  }
});
after(async()=>{await db.close();});
beforeEach(async()=>{
  await db.exec(`reset role;truncate reports,automation_tasks,agent_events,creatives,campaigns,agent_runs,job_locks restart identity cascade;
    update departments set human_head_role='creative_head',ai_lead_agent='creativeDirector' where id='creative';
    update agents set enabled=true;`);
  for(const [name,id] of Object.entries(users)) await db.query('update profiles set role=$1 where id=$2',[roles[name],id]);
});



async function pending({linked=false,nullSnapshot=false}={}) {
  const run=randomUUID(),campaign=randomUUID(),asset=randomUUID();const plan={name:'Fixture campaign',budget_daily:0,channels:['google'],days:7};
  const taskId=linked?(await task({kind:'campaign',status:'review',claimed_by:null,lease_until:null})).id:null;
  await db.query("insert into agent_runs(id,kind,stage,status,state,automation_task_id) values($1,'campaign','done','waiting',$2,$3)",[run,{campaign_id:campaign,plan,review:'Old review',quality:{old:true},insights:['Saved analysis'],retry:{n:2},stageFailures:{n:2}},taskId]);
  await db.query("insert into campaigns(id,run_id,name,budget_daily,channels,plan) values($1,$2,$3,0,array['google'],$4)",[campaign,run,plan.name,plan]);
  await db.query("insert into creatives(id,campaign_id,kind,headline,body,image_path,art_status) values($1,$2,'banner','Existing copy','Body','existing.png','ready')",[asset,campaign]);
  const assets=(await db.query('select id,headline,body,image_path,art_status from creatives where campaign_id=$1',[campaign])).rows;
  const quality={version:1,passed:true,claims:'clean',policy:'ok',cmoApproved:true,artifact:campaignArtifact(plan,assets)};
  await db.query("update campaigns set status='in_approval',plan=$2 where id=$1",[campaign,{...plan,quality}]);
  const approval=(await db.query("insert into approvals(campaign_id,required_roles) values($1,array['creative_head']::app_role[]) returning *",[campaign])).rows[0];
  await as('creative',"select decide_approval($1,'approve',null)",[approval.id]);
  await db.query("update campaigns set plan=plan-'quality' where id=$1",[campaign]);
  // Local PGlite-only construction of a pre-migration row; production never disables guards.
  if(nullSnapshot){await db.exec('alter table approvals disable trigger campaign_approval_version');await db.query('update approvals set quality_snapshot=null where id=$1',[approval.id]);await db.exec('alter table approvals enable trigger campaign_approval_version');}
  return {run,campaign,asset,approval:approval.id,taskId,plan,quality};
}
const request=async(c,user='creative')=>(await as(user,'select request_campaign_rereview($1) id',[c.approval])).rows[0].id;
const getRun=async c=>(await db.query('select * from agent_runs where id=$1',[c.run])).rows[0];
async function reviewed(c){await db.query("update agent_runs set stage='approval',state=(state-'review')||$2 where id=$1",[c.run,{plan:c.plan,quality:c.quality,review:'Fresh review passed'}]);}
const open=async c=>(await as(null,'select open_campaign_review($1,$2,$3,$4) id',[c.run,c.plan,'Fresh review passed',c.quality],'service_role')).rows[0].id;

test('legacy null-snapshot review queues only the saved review and preserves copy, image, votes and analysis',async()=>{
  const c=await pending({nullSnapshot:true});const old=(await db.query('select * from creatives where id=$1',[c.asset])).rows[0];
  assert.equal(await request(c),c.run);const r=await getRun(c);assert.equal(r.stage,'review');assert.equal(r.status,'running');assert.deepEqual(r.state.insights,['Saved analysis']);assert.deepEqual(r.state.plan,c.plan);
  assert.equal(r.state.quality,undefined);assert.equal(r.state.review,undefined);assert.equal(r.state.retry,undefined);assert.equal(r.state.stageFailures,undefined);
  assert.equal((await db.query('select status from approvals where id=$1',[c.approval])).rows[0].status,'changes');assert.equal((await db.query('select count(*)::int n from approval_steps where approval_id=$1',[c.approval])).rows[0].n,1);
  assert.deepEqual((await db.query('select * from creatives where id=$1',[c.asset])).rows[0],old);assert.equal((await db.query('select count(*)::int n from agent_runs')).rows[0].n,1);
  assert.equal(await request(c),c.run);assert.equal((await db.query("select count(*)::int n from agent_events where text like 'A human requested fresh%'")).rows[0].n,1);
});
test('review request respects role, current approval, active campaign lease and publication boundaries',async()=>{
  const c=await pending();for(const user of ['viewer','ecom'])await assert.rejects(request(c,user),code('42501'));
  await db.query("insert into job_locks(name,holder,until) values($1,'other',now()+interval '1 minute')",['campaign:'+c.run]);await assert.rejects(request(c),code('40001'));await db.exec('delete from job_locks');
  for(const status of ['approved','publishing','publish_review','live']){await db.query('update campaigns set status=$2 where id=$1',[c.campaign,status==='approved'||status==='publishing'?'live':status]);await assert.rejects(request(c),code('22023'));}
});
test('linked task returns to queued but cancelled or actively leased work cannot be reopened',async()=>{
  const c=await pending({linked:true});await db.query("update automation_tasks set status='cancelled' where id=$1",[c.taskId]);await assert.rejects(request(c),code('40001'));
  await db.query("update automation_tasks set status='running',claimed_by=$2,lease_until=now()+interval '1 minute' where id=$1",[c.taskId,randomUUID()]);await assert.rejects(request(c),code('40001'));
  await db.query("update automation_tasks set status='review',claimed_by=null,lease_until=null where id=$1",[c.taskId]);await request(c);const task=await current(c.taskId);assert.equal(task.status,'queued');assert.equal(task.claimed_by,null);assert.equal(task.result,null);
});
test('fresh review creates version two once and requires fresh human votes instead of old approvals',async()=>{
  const c=await pending();await request(c);await reviewed(c);const id=await open(c);assert.equal(await open(c),id);
  const row=(await db.query('select * from approvals where id=$1',[id])).rows[0];assert.equal(row.version,2);assert.deepEqual(row.quality_snapshot,c.quality);
  assert.equal((await db.query('select count(*)::int n from approvals where campaign_id=$1',[c.campaign])).rows[0].n,2);
  await assert.rejects(as('admin',"select decide_approval($1,'approve',null)",[id]),/Department heads/);
  await as('creative',"select decide_approval($1,'approve',null)",[id]);await as('ecom',"select decide_approval($1,'approve',null)",[id]);
  assert.equal((await as('admin',"select decide_approval($1,'approve',null) status",[id])).rows[0].status,'approved');
});
test('humans can decline missing-QC legacy work while positive approval remains blocked',async()=>{
  for(const decision of ['changes','reject']){const c=await pending({nullSnapshot:true});await assert.rejects(as('admin',"select decide_approval($1,'approve',null)",[c.approval]),code('22023'));
    const value=(await as('admin','select decide_approval($1,$2,$3) status',[c.approval,decision,'Needs correction'])).rows[0].status;assert.equal(value,decision==='reject'?'rejected':'changes');}
});
test('forged changed review or cancelled task cannot create an approval, and browser roles cannot call the service handoff',async()=>{
  const c=await pending();await request(c);await reviewed(c);
  await assert.rejects(as('creative','select open_campaign_review($1,$2,$3,$4)',[c.run,c.plan,'Fresh review passed',c.quality]),code('42501'));
  await db.query("update creatives set body='Changed after QC' where id=$1",[c.asset]);await assert.rejects(open(c),code('22023'));assert.equal((await db.query('select count(*)::int n from approvals where campaign_id=$1',[c.campaign])).rows[0].n,1);
});

test('optional deployment fixture verifies the lifecycle and rolls back every fake campaign and event',async()=>{
  await db.query("select set_config('test.uid',$1,false)",[users.admin]);
  const before=(await db.query('select (select count(*) from campaigns)::int campaigns,(select count(*) from agent_events)::int events')).rows[0];
  try{await db.exec(read('scripts/verify-campaign-rereview-rollback.sql'));}catch(error){await db.exec('rollback');throw error;}
  assert.deepEqual((await db.query('select (select count(*) from campaigns)::int campaigns,(select count(*) from agent_events)::int events')).rows[0],before);
});
