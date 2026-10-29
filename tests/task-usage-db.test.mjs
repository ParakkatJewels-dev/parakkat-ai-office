import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
let db;
const C='00000000-0000-4000-8000-000000000001',T='00000000-0000-4000-8000-000000000002',H='00000000-0000-4000-8000-000000000003';
before(async()=>{
  db=new PGlite();await db.exec(`create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;
    create function public.is_admin() returns boolean language sql stable as $$select case when current_setting('test.admin',true)='missing' then null else coalesce(current_setting('test.admin',true),'false')='true' end$$;
    create table ai_usage_reservations(id uuid primary key default gen_random_uuid(),status text,actual_input_tokens bigint,actual_output_tokens bigint,accounted_tokens bigint);
    create table agent_runs(id uuid primary key,status text,occasion text);create table agent_tasks(id uuid primary key,status text,prompt text);create table automation_tasks(id uuid primary key,kind text,status text,title text,brief text);
    revoke all on agent_runs,agent_tasks,automation_tasks from authenticated,anon;`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261027000100_task_usage.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261027000200_task_usage_guard.sql',import.meta.url),'utf8'));
});
after(async()=>db.close());
beforeEach(async()=>{
  await db.exec(`reset role;truncate task_usage_events,ai_usage_reservations,agent_runs,agent_tasks,automation_tasks;set test.admin='false';set test.uid='';
    insert into agent_runs values('${C}','done','Private campaign title');insert into agent_tasks values('${T}','completed','Private customer task prompt');insert into automation_tasks values('${H}','head_task','review','Private title','Private brief');`);
});
async function event(kind,id,event='provider_attempt',extra={}) {
  const row={task_kind:kind,task_id:id,event_kind:event,status:event==='provider_attempt'?'complete':'complete',estimated_tokens:event==='provider_attempt'?1200:0,created_at:'2026-10-27T08:00:00Z',...extra};
  const keys=Object.keys(row);return (await db.query(`insert into task_usage_events(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')}) returning id`,Object.values(row))).rows[0].id;
}
const asAdmin=()=>db.exec(`set role authenticated;set test.admin='true';set test.uid='00000000-0000-4000-8000-000000000099'`);
const report=async(kind='all',status='all',page=1,size=20)=>(await db.query(`select task_usage_report('2026-10-01','2026-10-28',$1,$2,$3,$4) v`,[kind,status,page,size])).rows[0].v;
test('task metering distinguishes measured tokens, unknown estimates, failed attempts and every reuse kind',async()=>{
  await event('campaign',C,'provider_attempt',{input_tokens:100,output_tokens:20});
  await event('campaign',C,'provider_attempt',{status:'failed',input_tokens:30,output_tokens:10});
  await event('campaign',C,'provider_attempt',{status:'failed',estimated_tokens:1800});
  for(const kind of ['cache_reuse','inflight_reuse','deterministic_reuse','checkpoint_reuse'])await event('campaign',C,kind);
  await asAdmin();const value=await report();assert.equal(value.total,1);const row=value.rows[0];
  assert.equal(row.task_status,'completed');assert.equal(row.calls,3);assert.equal(row.failed_calls,2);assert.equal(row.input_tokens,130);assert.equal(row.output_tokens,30);assert.equal(row.unknown_calls,1);assert.equal(row.estimated_tokens,1800);assert.equal(row.reused,4);
  assert.equal(row.cache_reused,1);assert.equal(row.inflight_reused,1);assert.equal(row.deterministic_reused,1);assert.equal(row.checkpoint_reused,1);
});
test('settled reservation actuals repair pending telemetry and unknown usage remains conservative',async()=>{
  const a=(await db.query(`insert into ai_usage_reservations(status,actual_input_tokens,actual_output_tokens,accounted_tokens) values('failed',50,15,65) returning id`)).rows[0].id;
  await event('conversation',T,'provider_attempt',{status:'pending',reservation_id:a,estimated_tokens:2400});
  const b=(await db.query(`insert into ai_usage_reservations(status,accounted_tokens) values('failed',2200) returning id`)).rows[0].id;
  await event('head_task',H,'provider_attempt',{status:'pending',reservation_id:b});
  await asAdmin();const value=await report();assert.equal(value.totals.calls,2);assert.equal(value.totals.failed_calls,2);assert.equal(value.totals.input_tokens,50);assert.equal(value.totals.output_tokens,15);assert.equal(value.totals.unknown_calls,1);assert.equal(value.totals.estimated_tokens,2200);
  assert.doesNotMatch(JSON.stringify(value),/Private|prompt|occasion|brief|title/);
});
test('filters operate on actual task kind/status and SQL pagination clamps empty oversized pages',async()=>{
  await event('campaign',C);await event('conversation',T,'deterministic_reuse');await event('head_task',H,'checkpoint_reuse');
  await asAdmin();assert.equal((await report('all','completed')).total,2);assert.equal((await report('head_task','active')).total,1);assert.equal((await report('all','failed')).total,0);
  await db.exec('reset role');for(let i=10;i<35;i++){const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;await db.query('insert into agent_tasks values($1,\'completed\',\'PRIVATE\')',[id]);await event('conversation',id,'deterministic_reuse');}
  await asAdmin();const page=await report('conversation','completed',999);assert.equal(page.total,26);assert.equal(page.page,2);assert.equal(page.rows.length,6);assert.equal(page.totals.reused,26);
  assert.equal(new Set(page.rows.map(row=>row.task_id)).size,6);
});
test('anon/non-admin cannot read task metrics or private tasks; admin report contains metadata only; browsers cannot write',async()=>{
  await event('conversation',T,'deterministic_reuse');
  await db.exec('set role anon');await assert.rejects(db.query('select * from task_usage_events'),e=>e.code==='42501');await assert.rejects(report(),e=>e.code==='42501');
  await db.exec(`reset role;set role authenticated;set test.uid='00000000-0000-4000-8000-000000000099'`);assert.equal((await db.query('select * from task_usage_events')).rows.length,0);await assert.rejects(report(),e=>e.code==='42501');
  await asAdmin();assert.equal((await report()).total,1);await assert.rejects(db.query('select prompt from agent_tasks'),e=>e.code==='42501');
  for(const sql of [`insert into task_usage_events(task_kind,task_id,event_kind,status) values('conversation','${T}','deterministic_reuse','complete')`,`update task_usage_events set input_tokens=999`,`delete from task_usage_events`])await assert.rejects(db.query(sql),e=>e.code==='42501');
  await db.exec('reset role;set role service_role');await event('head_task',H,'checkpoint_reuse');
});
test('malformed filters, partial actuals and fake reuse token charges are rejected',async()=>{
  await assert.rejects(event('campaign',C,'provider_attempt',{input_tokens:1}),e=>e.code==='23514');
  await assert.rejects(event('conversation',T,'cache_reuse',{estimated_tokens:10}),e=>e.code==='23514');
  await asAdmin();for(const args of [['unknown','all',1,20],['all','bad',1,20],['all','all',0,20],['all','all',1,100]])await assert.rejects(report(...args),e=>e.code==='22023');
  await assert.rejects(db.query(`select task_usage_report('2025-01-01','2026-10-28')`),e=>e.code==='22023');
});
test('task namespaces remain separate and the selected period has an exclusive upper boundary',async()=>{
  await db.query('insert into agent_tasks values($1,\'completed\',\'PRIVATE\')',[C]);
  await event('campaign',C,'provider_attempt',{input_tokens:5,output_tokens:2,created_at:'2026-10-01T00:00:00Z'});
  await event('conversation',C,'deterministic_reuse');
  await event('campaign',C,'provider_attempt',{input_tokens:999,output_tokens:999,created_at:'2026-10-28T00:00:00Z'});
  await asAdmin();const value=await report();assert.equal(value.total,2);assert.equal(value.totals.calls,1);assert.equal(value.totals.input_tokens,5);assert.equal(value.totals.reused,1);
  assert.deepEqual(value.rows.map(row=>row.task_kind).sort(),['campaign','conversation']);
});

test('NULL authorization is denied even if a future role helper stops coalescing missing profiles',async()=>{
  await event('conversation',T,'deterministic_reuse');
  await db.exec("set role authenticated;set test.uid='00000000-0000-4000-8000-000000000099';set test.admin='missing'");
  assert.equal((await db.query('select * from task_usage_events')).rows.length,0);
  await assert.rejects(report(),error=>error.code==='42501');
});
