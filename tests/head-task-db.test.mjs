import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const users = Object.fromEntries(['admin','creative','ecom','viewer'].map((name,i) => [name, `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const roles = { admin:'super_admin', creative:'creative_head', ecom:'ecom_manager', viewer:'viewer' };
const code = expected => error => error.code === expected;
const result = { status:'review', summary:'The head approved the launch copy.', markdown:'Approved campaign copy with an evidence-backed offer.', evidence:[], warnings:[] };
let db;

function workflow(overrides={}) {
  return { version:1, phase:'handoff', headAgentId:'creativeDirector', humanRevision:0, revisionRound:0,
    plan:{ understanding:'Prepare launch copy', successCriteria:['Use approved facts'], assignments:[{agentId:'copywriter', task:'Draft launch copy', deliverable:'Launch copy'}] },
    outputs:{ copywriter:{body:'Completed specialist copy',summary:'Copy prepared',evidence:[],warnings:[],revision:0,blocked:false,missing:[]} },
    review:{decision:'approve',note:'The draft meets the brief and the facts supplied.',finalMarkdown:result.markdown,revisionRequests:[]}, ...overrides };
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
  for(const [name,id] of Object.entries(users)) {
    await db.query('insert into auth.users(id) values($1)',[id]);
    await db.query('update profiles set role=$1 where id=$2',[roles[name],id]);
  }
});
after(async()=>{await db.close();});
beforeEach(async()=>{
  await db.exec(`reset role;truncate reports,automation_tasks,agent_events restart identity cascade;
    update departments set human_head_role='creative_head',ai_lead_agent='creativeDirector' where id='creative';
    update agents set enabled=true;`);
  for(const [name,id] of Object.entries(users)) await db.query('update profiles set role=$1 where id=$2',[roles[name],id]);
});

test('head task is an additive kind and does not create or enable recurring schedules',async()=>{
  assert.equal((await task()).kind,'head_task');
  assert.equal((await db.query('select count(*)::int n from automation_schedules')).rows[0].n,5);
  assert.equal((await db.query('select count(*)::int n from automation_schedules where enabled')).rows[0].n,0);
  await assert.rejects(task({kind:'unbounded_agent'}),code('23514'));
});

test('handoff atomically creates one human report and a durable final state, and replay is harmless',async()=>{
  const row=await task(), id=await handoff(row), saved=await current(row.id), r=await report(id);
  assert.equal(r.automation_task_id,row.id); assert.equal(r.status,'with_head');
  assert.equal(r.author_agent,'creativeDirector');assert.equal(r.lead_agent,'creativeDirector');
  assert.equal(r.body,result.markdown);assert.equal(r.lead_note,workflow().review.note);
  assert.deepEqual(r.data.workerAgentIds,['copywriter']);
  assert.equal(saved.status,'review');assert.equal(saved.state.headWorkflow.phase,'human_review');
  assert.equal(saved.state.headWorkflow.reportId,id);assert.equal(saved.claimed_by,null);assert.equal(saved.lease_until,null);
  assert.ok(saved.finished_at);assert.deepEqual(saved.result,result);
  assert.equal(await handoff(row),id);
  assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from automation_events')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from agent_events')).rows[0].n,1);
  assert.equal((await current(row.id)).revision,saved.revision);
});

test('browser roles cannot forge handoff, cancellation or a saved workflow result',async()=>{
  const row=await task();
  for(const role of ['anon','authenticated']) {
    await assert.rejects(handoff(row,{role}),code('42501'));
    await assert.rejects(cancel(row,{role}),code('42501'));
  }
  await assert.rejects(as('admin',"update automation_tasks set status='review',state='{}' where id=$1",[row.id]),code('42501'));
  assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);
});

test('handoff rejects stale, expired, cancelled and non-head task claims without reports',async()=>{
  const row=await task();await assert.rejects(handoff(row,{holder:randomUUID()}),code('40001'));
  await assert.rejects(handoff(await task({lease_until:new Date(Date.now()-1000).toISOString()})),code('40001'));
  for(const status of ['queued','cancelled','failed','blocked','review','completed']) await assert.rejects(handoff(await task({status})),code('40001'));
  await assert.rejects(handoff(await task({kind:'campaign'})),code('22023'));
  assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);
});

test('human handoff requires the exact saved head approval and every real specialist output',async()=>{
  const base=workflow();
  const invalid=[
    {...base,phase:'review'}, {...base,headAgentId:'cmo'}, {...base,review:{...base.review,decision:'revise'}},
    {...base,review:{...base.review,note:''}},
    {...base,review:{...base.review,finalMarkdown:''}}, {...base,plan:{assignments:[]}},
    {...base,plan:{assignments:[...base.plan.assignments,...base.plan.assignments]}},
    {...base,outputs:{}}, {...base,outputs:{copywriter:{...base.outputs.copywriter,body:' '}}},
    {...base,outputs:{copywriter:{...base.outputs.copywriter,blocked:true}}},
    {...base,outputs:{copywriter:{...base.outputs.copywriter,missing:['Product quantities']}}},
    {...base,outputs:{copywriter:{...base.outputs.copywriter,missing:'invalid'}}},
    {...base,humanRevision:'invalid'},
  ];
  for(const h of invalid) await assert.rejects(handoff(await task({state:{headWorkflow:h}})),code('22023'));
  const row=await task();
  for(const outcome of [{...result,markdown:'Unreviewed replacement'}, {...result,status:'completed'}, {...result,actions:[{kind:'publish'}]}])
    await assert.rejects(handoff(row,{outcome}),code('22023'));
  assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);
});

test('head, worker and requester authorization are rechecked at handoff',async()=>{
  const row=await task();
  await db.exec("update agents set enabled=false where id='copywriter'");
  await assert.rejects(handoff(row),code('42501'));
  await db.exec("update agents set enabled=true where id='copywriter';update agents set enabled=false where id='creativeDirector'");
  await assert.rejects(handoff(row),code('42501'));
  await db.exec("update agents set enabled=true where id='creativeDirector';update departments set ai_lead_agent='brandGuardian' where id='creative'");
  await assert.rejects(handoff(row),code('42501'));
  await db.exec("update departments set ai_lead_agent='creativeDirector',human_head_role='ecom_manager' where id='creative'");
  await assert.rejects(handoff(row),code('42501'));
  await db.exec("update departments set human_head_role='creative_head' where id='creative'");
  await db.query("update profiles set role='viewer' where id=$1",[users.creative]);
  await assert.rejects(handoff(row),code('42501'));
  const admin=await task({created_by:users.admin,input:{allowedDepartments:['creative','datahub']},state:{headWorkflow:workflow({
    plan:{assignments:[{agentId:'shopifySync',task:'Draft',deliverable:'Draft'}]},outputs:{shopifySync:workflow().outputs.copywriter}
  })}});
  await assert.rejects(handoff(admin),code('42501'));
});

test('a head can delegate to another lead when the requester has both departments',async()=>{
  const row=await task({created_by:users.admin,input:{allowedDepartments:['creative','insights']},state:{headWorkflow:workflow({
    plan:{assignments:[{agentId:'analyticsLead',task:'Analyse the launch',deliverable:'Analysis'}]},outputs:{analyticsLead:workflow().outputs.copywriter}
  })}});
  assert.ok(await handoff(row));
  const restricted=await task({created_by:users.admin,input:{allowedDepartments:['creative']},state:row.state});
  await assert.rejects(handoff(restricted),code('42501'));
});

test('report and task visibility follows the current non-viewer department role',async()=>{
  const row=await task(), id=await handoff(row);
  for(const table of ['reports','automation_tasks']) {
    assert.equal((await as('creative',`select * from ${table}`)).rows.length,1);
    assert.equal((await as('admin',`select * from ${table}`)).rows.length,1);
    for(const who of ['ecom','viewer',null])assert.equal((await as(who,`select * from ${table}`)).rows.length,0);
  }
  await db.exec("update departments set human_head_role='ecom_manager' where id='creative'");
  assert.equal((await as('creative','select * from reports')).rows.length,0);
  assert.equal((await as('ecom','select * from reports')).rows.length,1);
  await assert.rejects(decide(id,'accept',null,'creative'),code('42501'));
  await db.exec("update departments set human_head_role='viewer' where id='creative'");
  assert.equal((await as('viewer','select * from reports')).rows.length,0);
  await assert.rejects(decide(id,'accept',null,'viewer'),code('42501'));
});

test('human acceptance completes only the linked current task and remains idempotent at handoff',async()=>{
  const row=await task(), id=await handoff(row);
  assert.equal(await decide(id),'accepted');
  assert.equal((await current(row.id)).status,'completed');
  assert.equal((await current(row.id)).state.headWorkflow.phase,'completed');
  assert.equal((await report(id)).decided_by,users.creative);
  assert.equal(await handoff(row),id);
  await assert.rejects(decide(id),/not waiting on a head/);
});

test('human feedback resets exactly one new work round and reuses the report after fresh approval',async()=>{
  const row=await task({state:{blockedReason:'old',retryAt:'old',headWorkflow:workflow({resumePhase:'review',blockReason:'old',evidenceSnapshot:{old:true}})}});
  const id=await handoff(row);
  assert.equal(await decide(id,'send_back','Use a shorter headline'),'sent_back');
  const queued=await current(row.id), h=queued.state.headWorkflow;
  assert.equal(queued.status,'queued');assert.equal(queued.result,null);assert.equal(queued.finished_at,null);
  assert.deepEqual(h,{version:1,phase:'plan',headAgentId:'creativeDirector',revisionRound:0,humanRevision:1,humanFeedback:'Use a shorter headline',reportId:id,previousDelivery:result.markdown});
  assert.equal(queued.state.blockedReason,undefined);assert.equal(queued.state.retryAt,undefined);
  await assert.rejects(handoff(row),code('40001'));
  const next=workflow({humanRevision:1,reportId:id,humanFeedback:h.humanFeedback});
  const holder=randomUUID();
  await db.query("update automation_tasks set status='running',claimed_by=$2,lease_until=now()+interval '2 minutes',state=$3 where id=$1",[row.id,holder,{headWorkflow:next}]);
  const claimed=await current(row.id);
  assert.equal(await handoff(claimed),id);
  const r=await report(id);assert.equal(r.status,'with_head');assert.equal(r.revision,2);assert.equal(r.head_note,null);assert.equal(r.decided_by,null);
  assert.equal(r.data.humanRevision,1);assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,1);
  await assert.rejects(decide(id,'accept',null,'creative',1),code('40001'));
  assert.equal((await current(row.id)).status,'review');
  assert.equal((await report(id)).status,'with_head');
  assert.equal(await decide(id,'accept',null,'creative',2),'accepted');
});

test('human rejection cancels linked work and stale round decisions cannot complete it',async()=>{
  const row=await task(), id=await handoff(row);
  await db.query("update automation_tasks set state=jsonb_set(state,'{headWorkflow,humanRevision}','1') where id=$1",[row.id]);
  await assert.rejects(decide(id),code('40001'));
  await db.query("update automation_tasks set state=jsonb_set(state,'{headWorkflow,humanRevision}','0') where id=$1",[row.id]);
  assert.equal(await decide(id,'reject','Do not use this approach'),'rejected');
  assert.equal((await current(row.id)).status,'cancelled');assert.equal((await current(row.id)).state.headWorkflow.phase,'rejected');
  await assert.rejects(handoff(row),code('40001'));
});

test('cancellation checks actor and revision, closes human inbox, and prevents stale worker completion',async()=>{
  const row=await task(), id=await handoff(row), saved=await current(row.id);
  await assert.rejects(cancel(row),code('40001'));
  await assert.rejects(cancel(saved,{user:'ecom'}),code('42501'));
  assert.equal(await cancel(saved),row.id);
  assert.equal((await current(row.id)).status,'cancelled');assert.equal((await report(id)).status,'rejected');
  await assert.rejects(decide(id),/not waiting on a head/);await assert.rejects(handoff(row),code('40001'));
  const running=await task();await cancel(running);await assert.rejects(handoff(running),code('40001'));
});

test('task checkpoint failure rolls back report creation and events',async()=>{
  const row=await task();
  await db.exec(`create function fail_head_handoff() returns trigger language plpgsql as $$ begin
    if new.state->'headWorkflow'->>'phase'='human_review' then raise exception 'Simulated checkpoint failure'; end if;return new;end $$;
    create trigger fail_head_handoff before update on automation_tasks for each row execute function fail_head_handoff();`);
  try{await assert.rejects(handoff(row),/Simulated checkpoint failure/);}
  finally{await db.exec('drop trigger fail_head_handoff on automation_tasks;drop function fail_head_handoff();');}
  assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from automation_events')).rows[0].n,0);
  assert.equal((await current(row.id)).status,'running');assert.ok(await handoff(row));
});

test('ordinary reports retain their existing approval flow and do not touch tasks',async()=>{
  const row=await task();
  const r=(await db.query("insert into reports(department_id,author_agent,lead_agent,title,body,status) values('creative','copywriter','creativeDirector','Legacy report','Ordinary report','with_head') returning *")).rows[0];
  assert.equal((await as('creative','select decide_report($1,$2,$3) status',[r.id,'accept',null])).rows[0].status,'accepted');
  assert.equal((await current(row.id)).status,'running');
});

test('linked decisions require the exact report revision read by the human',async()=>{
  const row=await task(),id=await handoff(row);
  await assert.rejects(as('creative','select decide_report($1,$2,$3)',[id,'accept',null]),code('40001'));
  await assert.rejects(decide(id,'accept',null,'creative',null),code('40001'));
  await assert.rejects(decide(id,'accept',null,'creative',0),code('40001'));
  assert.equal((await current(row.id)).status,'review');assert.equal((await report(id)).status,'with_head');
  assert.equal(await decide(id,'accept',null,'creative',1),'accepted');
});

test('handoff rejects a viewer-owned department and a head outside the original scope even for an admin',async()=>{
  const admin=await task({created_by:users.admin});
  await db.exec("update departments set human_head_role='viewer' where id='creative'");
  await assert.rejects(handoff(admin),code('42501'));
  await db.exec("update departments set human_head_role='creative_head' where id='creative'");
  const outside=await task({created_by:users.admin,input:{allowedDepartments:['insights']}});
  await assert.rejects(handoff(outside),code('42501'));
  assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);
});
