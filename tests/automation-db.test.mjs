import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const users = {
  admin: '00000000-0000-4000-8000-000000000001',
  creative: '00000000-0000-4000-8000-000000000002',
  ecom: '00000000-0000-4000-8000-000000000003',
  perf: '00000000-0000-4000-8000-000000000004',
  viewer: '00000000-0000-4000-8000-000000000005',
};
const roles = { admin: 'super_admin', creative: 'creative_head', ecom: 'ecom_manager', perf: 'perf_marketer', viewer: 'viewer' };
const code = expected => error => error.code === expected;
let db;

async function as(user, sql, params = [], role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.uid', $1, false)", [users[user] || '']);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function task(fields = {}) {
  const row = { kind: 'campaign', department_id: 'creative', owner_agent: 'creativeDirector', title: 'Prepare the campaign', ...fields };
  const columns = Object.keys(row);
  return (await db.query(`insert into automation_tasks(${columns.join(',')}) values(${columns.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(row))).rows[0];
}
const claim = async (holder = randomUUID(), seconds = 240) =>
  (await as(null, 'select * from claim_automation_task($1,$2)', [holder, seconds], 'service_role')).rows;

before(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text); alter table storage.objects enable row level security;
    create publication supabase_realtime;
    create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;`);
  await db.exec(read('supabase/migrations/20261024000000_init.sql').replace('create extension if not exists pgcrypto;', ''));
  await db.exec(read('supabase/seed.sql'));
  await db.exec(`grant usage on schema public,auth to authenticated,anon,service_role;
    grant select on all tables in schema public to authenticated;
    grant execute on function auth.uid() to authenticated,anon,service_role;
    alter default privileges in schema public grant all on tables to authenticated,anon,service_role;
    alter default privileges in schema public grant all on sequences to authenticated,anon,service_role;`);
  await db.exec(read('supabase/migrations/20261026000700_business_automation.sql'));
  for (const [name, id] of Object.entries(users)) {
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [id, { full_name: name }]);
    await db.query('update profiles set role=$1 where id=$2', [roles[name], id]);
  }
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate automation_tasks,automation_events,automation_inquiries restart identity cascade;
    update departments set human_head_role='creative_head' where id='creative';
    update departments set human_head_role='ecom_manager' where id='crm';
    update automation_schedules set enabled=false,last_queued_at=null;
    update automation_settings set inventory_rules='{}',customer_channel='unconfigured';`);
  for (const [name, id] of Object.entries(users)) await db.query('update profiles set role=$1 where id=$2', [roles[name], id]);
});

test('tasks and their events are visible only to the current department head or Super Admin', async () => {
  const creative = await task(), performance = await task({ kind: 'advertising', department_id: 'perf', owner_agent: 'perfLead' });
  await db.query("insert into automation_events(task_id,kind,text) values($1,'progress','Creative output'),($2,'progress','Performance output')", [creative.id, performance.id]);
  for (const table of ['automation_tasks', 'automation_events']) {
    assert.equal((await as('admin', `select * from ${table}`)).rows.length, 2);
    assert.equal((await as('creative', `select * from ${table}`)).rows.length, 1);
    assert.equal((await as('perf', `select * from ${table}`)).rows.length, 1);
    assert.equal((await as('ecom', `select * from ${table}`)).rows.length, 0);
    assert.equal((await as('viewer', `select * from ${table}`)).rows.length, 0);
    assert.equal((await as(null, `select * from ${table}`)).rows.length, 0);
    await assert.rejects(as(null, `select * from ${table}`, [], 'anon'), code('42501'));
  }
  await db.exec("update departments set human_head_role='ecom_manager' where id='creative'");
  assert.equal((await as('creative', 'select * from automation_tasks')).rows.length, 0);
  assert.equal((await as('creative', 'select * from automation_events')).rows.length, 0);
  assert.equal((await as('ecom', 'select * from automation_tasks')).rows.length, 1);
  await db.exec("update departments set human_head_role='viewer' where id='creative'");
  assert.equal((await as('viewer', 'select * from automation_tasks')).rows.length, 0);
});

test('a former admin or department head loses access immediately when their profile role changes', async () => {
  const created = await task();
  await db.query("insert into automation_events(task_id,kind,text) values($1,'progress','Private output')", [created.id]);
  for (const user of ['creative', 'admin']) {
    await db.query("update profiles set role='viewer' where id=$1", [users[user]]);
    assert.equal((await as(user, 'select * from automation_tasks')).rows.length, 0);
    assert.equal((await as(user, 'select * from automation_events')).rows.length, 0);
  }
});

test('schedules and configuration stay admin-only; customer inquiries follow current CRM ownership', async () => {
  await db.exec("insert into automation_inquiries(channel,contact_name,body) values('manual','Customer','Please help me select a gift')");
  assert.equal((await as('admin', 'select * from automation_schedules')).rows.length, 5);
  assert.equal((await as('admin', 'select * from automation_settings')).rows.length, 1);
  for (const user of ['creative', 'ecom', 'perf', 'viewer', null]) {
    assert.equal((await as(user, 'select * from automation_schedules')).rows.length, 0);
    assert.equal((await as(user, 'select * from automation_settings')).rows.length, 0);
  }
  assert.equal((await as('admin', 'select * from automation_inquiries')).rows.length, 1);
  assert.equal((await as('ecom', 'select * from automation_inquiries')).rows.length, 1);
  assert.equal((await as('creative', 'select * from automation_inquiries')).rows.length, 0);
  assert.equal((await as('viewer', 'select * from automation_inquiries')).rows.length, 0);
  await db.exec("update departments set human_head_role='creative_head' where id='crm'");
  assert.equal((await as('ecom', 'select * from automation_inquiries')).rows.length, 0);
  assert.equal((await as('creative', 'select * from automation_inquiries')).rows.length, 1);
});

test('browser clients cannot forge writes, delete evidence or claim tasks even as Super Admin', async () => {
  const created = await task();
  const mutations = [
    "insert into automation_tasks(kind,department_id,owner_agent,title) values('campaign','creative','creativeDirector','Forged')",
    "update automation_tasks set status='completed'",
    'delete from automation_tasks',
    `insert into automation_events(task_id,kind,text) values('${created.id}','result','Forged')`,
    "update automation_events set text='Forged'",
    'delete from automation_events',
    'update automation_schedules set enabled=true',
    "update automation_settings set customer_channel='whatsapp'",
    "insert into automation_inquiries(channel,body,consent) values('whatsapp','Forged',true)",
    "update automation_inquiries set status='replied'",
    'delete from automation_inquiries',
  ];
  for (const sqlRole of ['authenticated', 'anon']) {
    for (const sql of mutations) await assert.rejects(as('admin', sql, [], sqlRole), code('42501'));
    await assert.rejects(as('admin', 'select * from claim_automation_task($1,240)', [randomUUID()], sqlRole), code('42501'));
  }
  assert.equal((await claim()).length, 1);
  await as(null, "insert into automation_events(task_id,kind,text) values($1,'progress','Saved by worker')", [created.id], 'service_role');
  assert.equal((await as(null, 'select * from automation_events', [], 'service_role')).rows.length, 1);
});

test('claim selects due queued work by priority then age and does not take waiting or terminal tasks', async () => {
  for (const status of ['blocked', 'review', 'completed', 'cancelled', 'failed']) await task({ status, priority: 1 });
  await task({ status: 'running', lease_until: new Date(Date.now() + 60000).toISOString(), claimed_by: randomUUID(), priority: 1 });
  await task({ next_run_at: new Date(Date.now() + 60000).toISOString(), priority: 1 });
  const low = await task({ priority: 3, created_at: '2026-01-01T00:00:00Z' });
  const recent = await task({ priority: 1, created_at: '2026-01-03T00:00:00Z' });
  const old = await task({ priority: 1, created_at: '2026-01-02T00:00:00Z' });
  assert.equal((await claim())[0].id, old.id);
  assert.equal((await claim())[0].id, recent.id);
  assert.equal((await claim())[0].id, low.id);
  assert.deepEqual(await claim(), []);
});

test('a claim records ownership, a bounded lease and exactly one revision increment', async () => {
  const created = await task(), holder = randomUUID(), claimed = (await claim(holder, 60))[0];
  assert.equal(claimed.id, created.id);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.claimed_by, holder);
  assert.equal(claimed.attempts, 1);
  assert.equal(claimed.revision, 2);
  assert.ok(claimed.started_at);
  const duration = new Date(claimed.lease_until) - new Date(claimed.updated_at);
  assert.equal(duration, 60000);
  assert.deepEqual(await claim(randomUUID()), []);
  for (const [id, seconds] of [[null, 240], [holder, null], [holder, 29], [holder, 271]]) {
    await assert.rejects(claim(id, seconds), code('22023'));
  }
});

test('two queued claim requests receive different tasks and cannot share the same lease', async () => {
  const one = await task(), two = await task();
  const first = randomUUID(), second = randomUUID();
  await db.exec('set role service_role');
  let results;
  try {
    results = await Promise.all([
      db.query('select * from claim_automation_task($1,240)', [first]),
      db.query('select * from claim_automation_task($1,240)', [second]),
    ]);
  } finally { await db.exec('reset role'); }
  assert.deepEqual(new Set(results.map(result => result.rows[0].id)), new Set([one.id, two.id]));
  assert.equal(results[0].rows[0].claimed_by, first);
  assert.equal(results[1].rows[0].claimed_by, second);
  assert.deepEqual(await claim(), []);
});

test('expired work is reclaimed and stale holder or revision checkpoints cannot replace the result', async () => {
  const created = await task(), first = randomUUID(), second = randomUUID();
  const initial = (await claim(first))[0];
  await db.query("update automation_tasks set lease_until=now()-interval '1 second' where id=$1", [created.id]);
  assert.equal((await db.query("update automation_tasks set result='{}' where id=$1 and claimed_by=$2 and status='running' and lease_until>now() returning id", [created.id, first])).rows.length, 0);
  const reclaimed = (await claim(second))[0];
  assert.equal(reclaimed.id, created.id); assert.equal(reclaimed.attempts, 2);
  assert.equal(reclaimed.claimed_by, second); assert.equal(reclaimed.revision, initial.revision + 2);
  assert.equal(new Date(reclaimed.started_at).getTime(), new Date(initial.started_at).getTime());
  assert.equal((await db.query("update automation_tasks set status='completed',result='{}' where id=$1 and claimed_by=$2 and status='running' and lease_until>now() returning id", [created.id, first])).rows.length, 0);
  assert.equal((await db.query("update automation_tasks set title='Old browser' where id=$1 and revision=$2 returning id", [created.id, initial.revision])).rows.length, 0);
  const saved = await db.query("update automation_tasks set status='review',result=$3,claimed_by=null,lease_until=null where id=$1 and claimed_by=$2 and status='running' and lease_until>now() returning *", [created.id, second, { summary: 'Real saved output' }]);
  assert.equal(saved.rows.length, 1); assert.equal(saved.rows[0].revision, reclaimed.revision + 1);
  assert.deepEqual(saved.rows[0].result, { summary: 'Real saved output' });
});

test('cancelled work cannot be completed by a still-running worker', async () => {
  const created = await task(), holder = randomUUID();
  const claimed = (await claim(holder))[0];
  await db.query("update automation_tasks set status='cancelled',claimed_by=null,lease_until=null where id=$1 and revision=$2", [created.id, claimed.revision]);
  const completion = await db.query("update automation_tasks set status='completed' where id=$1 and claimed_by=$2 and status='running' and lease_until>now() returning id", [created.id, holder]);
  assert.equal(completion.rows.length, 0);
  assert.deepEqual(await claim(), []);
});

test('all dependencies must exist and be completed, including after one is removed', async () => {
  const missing = randomUUID(), waiting = await task({ status: 'review' }), done = await task({ status: 'completed' });
  await task({ depends_on: [missing] });
  const pending = await task({ depends_on: [waiting.id, done.id], priority: 1 });
  assert.deepEqual(await claim(), []);
  await db.query("update automation_tasks set status='completed' where id=$1", [waiting.id]);
  assert.equal((await claim())[0].id, pending.id);
  await task({ depends_on: [done.id] });
  await db.query('delete from automation_tasks where id=$1', [done.id]);
  assert.deepEqual(await claim(), []);
});

test('source, customer message and campaign checkpoints prevent duplicate durable work', async () => {
  const created = await task({ source_key: 'briefing:2026-10-26' });
  await assert.rejects(task({ source_key: 'briefing:2026-10-26' }), code('23505'));
  await task(); await task(); // null source keys are deliberately allowed for distinct manual tasks.
  await db.query("insert into agent_runs(kind,automation_task_id) values('campaign',$1)", [created.id]);
  await assert.rejects(db.query("insert into agent_runs(kind,automation_task_id) values('campaign',$1)", [created.id]), code('23505'));
  await db.exec("insert into automation_inquiries(channel,external_id,body) values('whatsapp','provider-message-1','Hello')");
  await assert.rejects(db.exec("insert into automation_inquiries(channel,external_id,body) values('whatsapp','provider-message-1','Hello again')"), code('23505'));
  await db.exec("insert into automation_inquiries(channel,external_id,body) values('email','provider-message-1','Different provider')");
});

test('provider action claims are scoped, unique, immutable, and cannot be deleted for a retry', async () => {
  const created = await task();
  const payload = { productId: 123, title: 'Reviewed title' };
  const action = (await as(null, `insert into automation_actions(task_id,action_index,kind,requested_by,payload)
    values($1,0,'shopify_copy',$2,$3) returning *`, [created.id, users.creative, payload], 'service_role')).rows[0];
  assert.equal(action.status, 'executing'); assert.deepEqual(action.payload, payload);
  assert.equal((await as('creative', 'select * from automation_actions')).rows.length, 1);
  assert.equal((await as('admin', 'select * from automation_actions')).rows.length, 1);
  for (const user of ['perf', 'ecom', 'viewer', null]) assert.equal((await as(user, 'select * from automation_actions')).rows.length, 0);
  await assert.rejects(as('admin', 'update automation_actions set status=$1', ['completed']), code('42501'));
  await assert.rejects(as('admin', 'delete from automation_actions'), code('42501'));
  await assert.rejects(as(null, 'select * from automation_actions', [], 'anon'), code('42501'));
  await assert.rejects(as(null, `insert into automation_actions(task_id,action_index,kind,payload)
    values($1,0,'shopify_copy',$2)`, [created.id, payload], 'service_role'), code('23505'));
  for (const [column, value] of [['payload', { title: 'Unreviewed change' }], ['action_index', 1], ['kind', 'different_action'], ['created_at', '2025-01-01T00:00:00Z']]) {
    await assert.rejects(as(null, `update automation_actions set ${column}=$2 where id=$1`, [action.id, value], 'service_role'), code('22023'));
  }
  const review = (await as(null, "update automation_actions set status='review',error='Provider result uncertain' where id=$1 returning *", [action.id], 'service_role')).rows[0];
  assert.equal(review.status, 'review'); assert.deepEqual(review.payload, payload);
  await assert.rejects(as(null, 'delete from automation_actions where id=$1', [action.id], 'service_role'), code('42501'));
  await assert.rejects(as(null, `insert into automation_actions(task_id,action_index,kind,payload)
    values($1,0,'shopify_copy',$2)`, [created.id, payload], 'service_role'), code('23505'));
  const completed = (await as(null, "update automation_actions set status='completed',result=$2,finished_at=now() where id=$1 returning *", [action.id, { providerId: 'confirmed-provider-id' }], 'service_role')).rows[0];
  assert.equal(completed.status, 'completed'); assert.ok(completed.finished_at);
  await db.exec("update departments set human_head_role='ecom_manager' where id='creative'");
  assert.equal((await as('creative', 'select * from automation_actions')).rows.length, 0);
  assert.equal((await as('ecom', 'select * from automation_actions')).rows.length, 1);
});

test('invalid kinds, states, dependencies and oversized content cannot enter the queue', async () => {
  for (const fields of [
    { kind: 'arbitrary_tool' }, { status: 'published' }, { priority: 0 }, { priority: 4 },
    { title: ' ' }, { title: 'a'.repeat(181) }, { brief: '😀'.repeat(6001) },
    { revision: 0 }, { attempts: -1 }, { depends_on: [null] },
  ]) await assert.rejects(task(fields), code('23514'));
  const self = randomUUID();
  await assert.rejects(task({ id: self, depends_on: [self] }), code('23514'));
  await assert.rejects(task({ id: self, parent_id: self }), code('23514'));
  await assert.rejects(task({ owner_agent: 'missing-agent' }), code('23503'));
  await task({ brief: '😀'.repeat(6000), title: 'a'.repeat(180) });
  for (const sql of [
    "update automation_schedules set cadence_hours=5",
    "update automation_schedules set cadence_hours=169",
    'update automation_schedules set local_hour=24',
    "insert into automation_schedules(kind,cadence_hours) values('campaign',24)",
    'insert into automation_settings(id) values(2)',
    "update automation_settings set customer_channel='unknown'",
    "insert into automation_inquiries(channel,body) values('unknown','Hello')",
    "insert into automation_inquiries(channel,body,status) values('manual','Hello','sent')",
  ]) await assert.rejects(db.exec(sql), code('23514'));
});

test('seeding does not enable recurring work and updates cannot bypass revision history', async () => {
  const schedules = (await as('admin', 'select * from automation_schedules')).rows;
  assert.ok(schedules.every(row => row.enabled === false && row.last_queued_at === null));
  const created = await task();
  const updated = (await db.query('update automation_tasks set revision=999,title=$2 where id=$1 returning *', [created.id, 'Updated title'])).rows[0];
  assert.equal(updated.revision, 2);
  assert.ok(new Date(updated.updated_at) >= new Date(created.updated_at));
});
