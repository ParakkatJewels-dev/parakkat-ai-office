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
  for(const [name,id] of Object.entries(users)) {
    await db.query('insert into auth.users(id) values($1)',[id]);
    await db.query('update profiles set role=$1 where id=$2',[roles[name],id]);
  }
});
after(async()=>{await db.close();});
beforeEach(async()=>{
  await db.exec(`reset role;truncate reports,automation_tasks,agent_events,creatives,campaigns restart identity cascade;
    update departments set human_head_role='creative_head',ai_lead_agent='creativeDirector' where id='creative';
    update agents set enabled=true;`);
  for(const [name,id] of Object.entries(users)) await db.query('update profiles set role=$1 where id=$2',[roles[name],id]);
});


test('migration adds only the approved three roles, preserves configured state and does not enable schedules',async()=>{
  assert.equal((await db.query('select count(*)::int n from agents')).rows[0].n,70);
  assert.equal((await db.query('select count(*)::int n from automation_schedules where enabled')).rows[0].n,0);
  await db.exec("update agents set name='My Custom Reviewer',enabled=false where id='outputQc';update agent_instructions set instructions='My saved rules',revision=2 where agent_id='outputQc'");
  const sql=read('supabase/migrations/20261026001400_quality_review.sql');await db.exec(sql.slice(0,sql.indexOf('-- Retire only')));
  const row=(await db.query("select name,enabled,instructions,revision from agents a join agent_instructions i on i.agent_id=a.id where a.id='outputQc'")).rows[0];
  assert.deepEqual(row,{name:'My Custom Reviewer',enabled:false,instructions:'My saved rules',revision:2});
});
test('current independent QC hands off atomically and retry does not duplicate report or event',async()=>{
  const row=await task(),id=await handoff(row);assert.equal(await handoff(row),id);
  const r=await report(id);assert.equal(r.data.quality.decision,'pass');assert.equal(r.data.quality.reviewerId,'outputQc');
  assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from automation_events')).rows[0].n,1);
  assert.equal(await decide(id),'accepted');
});
test('missing, failed, stale and self-authored QC cannot create a human approval',async()=>{
  const cases=[h=>delete h.quality,h=>h.quality.decision='blocked',h=>h.quality.reviewerId='copywriter',h=>h.review.finalMarkdown+='changed',h=>h.outputs.copywriter.body+='changed',h=>h.plan.successCriteria.push('Changed criterion'),h=>h.evidenceSnapshot={changed:true},h=>h.humanRevision++];
  for(const edit of cases){const h=workflow();edit(h);const row=await task({state:{headWorkflow:h}});await assert.rejects(handoff(row,{outcome:{...result,markdown:h.review.finalMarkdown}}),code('22023'));}
  assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);
});
test('disabled QC and requester access revocation stop handoff',async()=>{
  const row=await task();await db.exec("update agents set enabled=false where id='outputQc'");await assert.rejects(handoff(row),code('22023'));
  await db.exec("update agents set enabled=true where id='outputQc'");await db.query("update profiles set role='viewer' where id=$1",[users.creative]);await assert.rejects(handoff(row),code('42501'));
});
test('a report altered after QC cannot be human accepted; sendback clears QC for a new version',async()=>{
  const row=await task(),id=await handoff(row);await db.query("update reports set body='Changed after QC' where id=$1",[id]);
  await assert.rejects(decide(id),code('22023'));assert.equal((await report(id)).status,'with_head');
  assert.equal(await decide(id,'send_back','Please correct it'),'sent_back');const saved=await current(row.id);assert.equal(saved.state.headWorkflow.quality,undefined);assert.equal(saved.state.headWorkflow.phase,'plan');
});
async function campaign(artStatus='ready') {
  const id=randomUUID(),asset=randomUUID(),plan={name:'Reviewed campaign',budget_daily:100,channels:['meta']};
  await db.query("insert into campaigns(id,name,budget_daily,channels,plan) values($1,$2,100,array['meta'],$3)",[id,plan.name,plan]);
  await db.query("insert into creatives(id,campaign_id,kind,headline,body,image_path,art_status) values($1,$2,'banner','Copy','Body','v1.png',$3)",[asset,id,artStatus]);
  const creatives=(await db.query('select id,headline,body,image_path,art_status from creatives where campaign_id=$1',[id])).rows;
  plan.quality={version:1,passed:true,claims:'clean',policy:'ok',cmoApproved:true,artifact:campaignArtifact(plan,creatives)};
  await db.query('update campaigns set plan=$2 where id=$1',[id,plan]);return {id,asset,plan};
}
test('old or negative campaigns cannot approve or publish without exact passing review',async()=>{
  const c=await campaign();await db.query("update campaigns set plan=plan-'quality' where id=$1",[c.id]);
  for(const status of ['in_approval','approved','publishing'])await assert.rejects(db.query('update campaigns set status=$2 where id=$1',[c.id,status]),code('22023'));
  await db.query('update campaigns set plan=$2 where id=$1',[c.id,c.plan]);await db.query("update campaigns set status='in_approval' where id=$1",[c.id]);
  await db.query("update creatives set headline='Unreviewed edit' where id=$1",[c.asset]);await assert.rejects(db.query("update campaigns set status='approved' where id=$1",[c.id]),code('22023'));
});
test('Meta final approval requires ready artwork; approved payload changes are frozen',async()=>{
  const bad=await campaign('needs_fix');await db.query("update campaigns set status='in_approval' where id=$1",[bad.id]);await assert.rejects(db.query("update campaigns set status='approved' where id=$1",[bad.id]),/finished image/);
  const c=await campaign();await db.query("update campaigns set status='approved' where id=$1",[c.id]);
  await assert.rejects(db.query('update campaigns set budget_daily=101 where id=$1',[c.id]),/frozen/);
  await db.query("update campaigns set status='publishing' where id=$1",[c.id]);assert.equal((await db.query('select status from campaigns where id=$1',[c.id])).rows[0].status,'publishing');
});

test('human votes are bound to the approval snapshot and cannot transfer after fresh QC of changed content',async()=>{
  const c=await campaign();await db.query("update campaigns set status='in_approval' where id=$1",[c.id]);
  const first=(await db.query("insert into approvals(campaign_id,required_roles) values($1,array['creative_head']::app_role[]) returning *",[c.id])).rows[0];
  assert.deepEqual(first.quality_snapshot,c.plan.quality);
  assert.equal((await as('creative',"select decide_approval($1,'approve',null) status",[first.id])).rows[0].status,'pending');
  await db.query("update creatives set headline='Version two' where id=$1",[c.asset]);
  await assert.rejects(as('admin',"select decide_approval($1,'approve',null)",[first.id]),/campaign changed/);
  const rows=(await db.query('select id,headline,body,image_path,art_status from creatives where campaign_id=$1',[c.id])).rows;
  c.plan.quality={...c.plan.quality,artifact:campaignArtifact(c.plan,rows)};
  await db.query('update campaigns set plan=$2 where id=$1',[c.id,c.plan]);
  await assert.rejects(as('admin',"select decide_approval($1,'approve',null)",[first.id]),/campaign changed/);
  await assert.rejects(db.query('update approvals set quality_snapshot=$2 where id=$1',[first.id,c.plan.quality]),/cannot move/);
  const second=(await db.query("insert into approvals(campaign_id,required_roles) values($1,array['creative_head']::app_role[]) returning *",[c.id])).rows[0];
  await assert.rejects(as('admin',"select decide_approval($1,'approve',null)",[second.id]),/Department heads/);
  await as('creative',"select decide_approval($1,'approve',null)",[second.id]);
  assert.equal((await as('admin',"select decide_approval($1,'approve',null) status",[second.id])).rows[0].status,'approved');
  assert.equal((await db.query('select status from approvals where id=$1',[first.id])).rows[0].status,'pending');
});
