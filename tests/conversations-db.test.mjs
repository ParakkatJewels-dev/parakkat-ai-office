import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const users = { admin:'00000000-0000-4000-8000-000000000001', other:'00000000-0000-4000-8000-000000000002', creative:'00000000-0000-4000-8000-000000000003', viewer:'00000000-0000-4000-8000-000000000004' };
let db, seq = 0;
const nonce = () => `10000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`;
async function as(user, sql, params=[]) {
  await db.exec(`reset role; select set_config('test.uid','${users[user]}',false); set role authenticated;`);
  try { return await db.query(sql,params); } finally { await db.exec('reset role'); }
}
const enqueue = async (user='admin', agent='creativeDirector', thread=null, client=nonce(), prompt='Review a launch plan', meeting=true) =>
  (await as(user,'select enqueue_agent_task($1,$2,$3,$4,$5) as job',[agent,prompt,client,thread,meeting])).rows[0].job;
before(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text); alter table storage.objects enable row level security;
    create publication supabase_realtime; create role authenticated nologin; create role anon nologin; create role service_role nologin;`);
  await db.exec(read('supabase/migrations/20261024000000_init.sql').replace('create extension if not exists pgcrypto;',''));
  await db.exec(read('supabase/seed.sql'));
  await db.exec(`grant usage on schema public,auth to authenticated; grant select on all tables in schema public to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(read('supabase/migrations/20261026000200_agent_conversations.sql'));
  for (const [name,id] of Object.entries(users)) {
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id,{full_name:name}]);
    await db.query('update profiles set role=$1 where id=$2',[name==='creative'?'creative_head':name==='viewer'?'viewer':'super_admin',id]);
  }
});
beforeEach(async () => { await db.exec('delete from agent_threads; update agents set enabled=true;'); });

test('conversation enqueue is atomic and idempotent',async () => {
  const client=nonce(), first=await enqueue('admin','creativeDirector',null,client), second=await enqueue('admin','creativeDirector',null,client);
  assert.equal(first.threadId,second.threadId); assert.equal(first.taskId,second.taskId); assert.equal(second.created,false);
  assert.equal((await db.query('select count(*)::int n from agent_messages')).rows[0].n,1);
  await assert.rejects(enqueue('admin','creativeDirector',null,client,'Different request'),/already used/);
});
test('one active task per thread, follow-up after completion',async () => {
  const first=await enqueue();
  await assert.rejects(enqueue('admin','creativeDirector',first.threadId),/still working/);
  await db.query("update agent_tasks set status='completed',finished_at=now() where id=$1",[first.taskId]);
  const follow=await enqueue('admin','creativeDirector',first.threadId);
  assert.equal(first.threadId,follow.threadId); assert.notEqual(first.taskId,follow.taskId);
});
test('heads can task their own enabled agents, viewers cannot task agents',async () => {
  await enqueue('creative');
  await assert.rejects(enqueue('creative','metaSpec'),/cannot assign/);
  await assert.rejects(enqueue('viewer'),/cannot assign/);
  await db.exec("update agents set enabled=false where id='creativeDirector'");
  await assert.rejects(enqueue(),/cannot assign/);
});
test('conversations and meeting contents stay private to the requester',async () => {
  const job=await enqueue();
  await db.query("insert into agent_meetings(thread_id,task_id,title,participants) values($1,$2,'Private discussion',array['creativeDirector','designer'])",[job.threadId,job.taskId]);
  for (const table of ['agent_threads','agent_tasks','agent_messages','agent_meetings']) {
    assert.equal((await as('other',`select * from ${table}`)).rows.length,0);
    assert.equal((await as('creative',`select * from ${table}`)).rows.length,0);
    assert.equal((await as('admin',`select * from ${table}`)).rows.length,1);
  }
  await assert.rejects(enqueue('other','creativeDirector',job.threadId),/not found/);
});
test('a signed-in person cannot spoof agent answers or task completion',async () => {
  const job=await enqueue();
  await assert.rejects(as('admin',"insert into agent_messages(thread_id,role,content) values($1,'assistant','fake')",[job.threadId]),/permission denied|row-level/);
  await assert.rejects(as('admin',"update agent_tasks set status='completed' where id=$1",[job.taskId]),/permission denied|row-level/);
});
test('stale recovery fails only the requester jobs and meetings, then permits follow-up',async () => {
  const mine=await enqueue(), other=await enqueue('other');
  await db.exec("update agent_tasks set status='running',started_at=now()-interval '11 minutes'");
  await db.query("insert into agent_meetings(thread_id,task_id,title,participants,status) values($1,$2,'Interrupted',array['creativeDirector','designer'],'running')",[mine.threadId,mine.taskId]);
  await as('admin','select recover_agent_conversations()');
  assert.equal((await db.query('select status from agent_tasks where id=$1',[mine.taskId])).rows[0].status,'failed');
  assert.equal((await db.query('select status from agent_tasks where id=$1',[other.taskId])).rows[0].status,'running');
  assert.equal((await db.query('select status from agent_meetings')).rows[0].status,'failed');
  assert.equal((await as('admin',"select * from agent_messages where role='error'")).rows.length,1);
  assert.ok((await enqueue('admin','creativeDirector',mine.threadId)).taskId);
});
test('concurrent task and hourly limits bound per-user provider usage',async () => {
  await enqueue(); await enqueue(); await enqueue();
  await assert.rejects(enqueue(),/Three tasks/);
  await db.exec("update agent_tasks set status='completed'");
  for (let i=3;i<30;i++) { const job=await enqueue(); await db.query("update agent_tasks set status='completed' where id=$1",[job.taskId]); }
  await assert.rejects(enqueue(),/wait before/);
});
test('moving a department away removes a former head access to their thread',async () => {
  const job=await enqueue('creative');
  await db.exec("update departments set human_head_role='ecom_manager' where id='creative'");
  assert.equal((await as('creative','select * from agent_threads where id=$1',[job.threadId])).rows.length,0);
  assert.equal((await as('creative','select * from agent_messages where thread_id=$1',[job.threadId])).rows.length,0);
  await db.exec("update departments set human_head_role='creative_head' where id='creative'");
});
