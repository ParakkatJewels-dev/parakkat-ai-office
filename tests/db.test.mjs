// Runs the real migration and seed in an embedded Postgres, with small stand-ins for Supabase's auth and storage,
// then checks the visibility rules and sign-off functions as each head would hit them.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const U = { admin: '00000000-0000-0000-0000-00000000000a', creative: '00000000-0000-0000-0000-00000000000c', ecom: '00000000-0000-0000-0000-00000000000e', perf: '00000000-0000-0000-0000-00000000000f' };
let db;

// run a query as a signed-in person, through row-level security
async function as(who, sql, params) {
  await db.exec(`reset role; select set_config('test.uid', '${U[who]}', false); set role authenticated;`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth; create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean); create table storage.objects (id uuid default gen_random_uuid(), bucket_id text);
    alter table storage.objects enable row level security;
    create publication supabase_realtime;
    create role authenticated nologin; create role anon nologin;`);
  await db.exec(read('supabase/migrations/20261024000000_init.sql').replace('create extension if not exists pgcrypto;', ''));
  await db.exec(read('supabase/seed.sql'));
  await db.exec(read('supabase/migrations/20261024000200_seo_studio.sql'));
  await db.exec(read('supabase/migrations/20261024000300_memory.sql'));
  // what Supabase grants signed-in users by default
  await db.exec(`grant usage on schema public, auth to authenticated; grant all on all tables in schema public to authenticated; grant execute on function auth.uid() to authenticated;`);
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [id, { full_name: k }]);
  await db.exec(`update profiles set role = case full_name when 'admin' then 'super_admin' when 'creative' then 'creative_head' when 'ecom' then 'ecom_manager' when 'perf' then 'perf_marketer' end::app_role`);
  await db.exec(`insert into agent_events (kind, from_agent, to_agent, from_dept, to_dept, text) values
    ('say', 'analyticsLead', 'strategist', 'insights', 'strategy', 'A: e-com team talking to itself'),
    ('say', 'warLead', 'creativeDirector', 'warroom', 'creative', 'B: War Room talks to Creative Studio'),
    ('say', 'studioLead', 'creativeDirector', 'photo', 'creative', 'C: inside the creative departments'),
    ('say', 'intelLead', 'perfLead', 'intel', 'perf', 'D: inside the performance departments')`);
});

const letters = rows => rows.map(r => r.text[0]).sort().join('');

test('each head sees only their departments and conversations that involve them', async () => {
  const q = 'select text from agent_events';
  assert.equal(letters((await as('creative', q)).rows), 'BC');
  assert.equal(letters((await as('ecom', q)).rows), 'A');
  assert.equal(letters((await as('perf', q)).rows), 'BD');
  assert.equal(letters((await as('admin', q)).rows), 'ABCD');
});

test('reports reach a head only after the AI team lead forwards them', async () => {
  await db.exec(`insert into reports (id, department_id, author_agent, lead_agent, title, body, status) values
    ('10000000-0000-0000-0000-000000000001', 'photo', 'photoEditor', 'studioLead', 'still with the lead', 'x', 'lead_review'),
    ('10000000-0000-0000-0000-000000000002', 'photo', 'photoEditor', 'studioLead', 'forwarded creative', 'x', 'with_head'),
    ('10000000-0000-0000-0000-000000000003', 'perf', 'metaSpec', 'perfLead', 'forwarded performance', 'x', 'with_head')`);
  assert.deepEqual((await as('creative', 'select title from reports order by title')).rows.map(r => r.title), ['forwarded creative']);
  assert.equal((await as('admin', 'select title from reports')).rows.length, 3);
});

test('a head decides only on their own department, with a note to send back', async () => {
  await assert.rejects(as('creative', `select decide_report('10000000-0000-0000-0000-000000000003', 'accept')`), /Not your department/);
  await assert.rejects(as('creative', `select decide_report('10000000-0000-0000-0000-000000000002', 'send_back')`), /Add a note/);
  const r = await as('creative', `select decide_report('10000000-0000-0000-0000-000000000002', 'accept') as s`);
  assert.equal(r.rows[0].s, 'accepted');
  // the decision shows up for the creative head as a conversation with their department
  assert.ok((await as('creative', 'select text from agent_events')).rows.some(e => /forwarded creative/.test(e.text)));
});

test('plans go to the heads they touch, then the Super Admin, who alone approves to publish', async () => {
  await db.exec(`insert into campaigns (id, name, plan) values ('20000000-0000-0000-0000-000000000001', 'Kids', '{}');
    insert into approvals (id, campaign_id, required_roles) values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '{creative_head,ecom_manager}')`);
  const A = `'30000000-0000-0000-0000-000000000001'`;
  assert.equal((await as('perf', 'select id from approvals')).rows.length, 0, 'plan does not touch the performance marketer');
  assert.equal((await as('perf', 'select id from campaigns')).rows.length, 0);
  await assert.rejects(as('admin', `select decide_approval(${A}, 'approve')`), /heads have not all approved/);
  await assert.rejects(as('perf', `select decide_approval(${A}, 'approve')`), /does not need your approval/);
  assert.equal((await as('creative', `select decide_approval(${A}, 'approve') as s`)).rows[0].s, 'pending');
  await assert.rejects(as('creative', `select decide_approval(${A}, 'approve')`), /already decided/);
  assert.equal((await as('ecom', `select decide_approval(${A}, 'approve') as s`)).rows[0].s, 'pending');
  assert.equal((await as('admin', `select decide_approval(${A}, 'approve') as s`)).rows[0].s, 'approved');
  assert.equal((await db.query(`select status from campaigns where id = '20000000-0000-0000-0000-000000000001'`)).rows[0].status, 'approved');
});

test('a head cannot change roles or write agent data directly', async () => {
  await as('creative', `update profiles set role = 'super_admin' where id = '${U.creative}'`);
  assert.equal((await db.query(`select role from profiles where id = $1`, [U.creative])).rows[0].role, 'creative_head');
  await assert.rejects(as('creative', `insert into agent_events (kind, text) values ('say', 'spoof')`), /permission denied|row-level security/);
});

test('designs are visible to the creative head and the Super Admin only', async () => {
  await db.exec(`insert into designs (format, brief, status) values ('poster', 'Onam poster', 'ready')`);
  assert.equal((await as('creative', 'select brief from designs')).rows.length, 1);
  assert.equal((await as('admin', 'select brief from designs')).rows.length, 1);
  assert.equal((await as('perf', 'select brief from designs')).rows.length, 0);
});

test('the SEO Desk reports to the e-com manager', async () => {
  const { rows } = await as('ecom', `select id from departments where id in (select my_depts()) and id = 'seo'`);
  assert.equal(rows.length, 1);
});

test("a head's notes become lessons for that department only", async () => {
  await db.exec(`insert into reports (id, department_id, author_agent, lead_agent, title, body, status) values
    ('10000000-0000-0000-0000-000000000009', 'photo', 'photoEditor', 'studioLead', 'Studio shots', 'x', 'with_head')`);
  await as('creative', `select decide_report('10000000-0000-0000-0000-000000000009', 'send_back', 'Use daylight, not yellow light')`);
  const mine = (await as('creative', 'select department_id, decision, lesson from lessons')).rows;
  assert.ok(mine.some(l => l.department_id === 'photo' && l.decision === 'sent_back' && /daylight/.test(l.lesson)));
  assert.equal((await as('perf', 'select id from lessons')).rows.length, 0);

  await db.exec(`insert into campaigns (id, name, plan) values ('20000000-0000-0000-0000-000000000002', 'Onam', '{}');
    insert into approvals (id, campaign_id, required_roles) values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '{perf_marketer}')`);
  await as('perf', `select decide_approval('30000000-0000-0000-0000-000000000002', 'changes', 'Cap the daily budget at 15000')`);
  const perf = (await as('perf', 'select department_id, lesson from lessons')).rows;
  assert.ok(perf.some(l => l.department_id === 'perf' && /Onam/.test(l.lesson) && /15000/.test(l.lesson)));
});
