import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const userId = '00000000-0000-4000-8000-000000000001';
const code = expected => error => error.code === expected;
const proposals = [
  { kind: 'catalogue_copy', label: 'Review first product', payload: { productId: '101', title: 'Reviewed first title' } },
  { kind: 'catalogue_copy', label: 'Review second product', payload: { productId: '102', title: 'Reviewed second title' } },
];
let db;

before(async () => {
  db = new PGlite();
  await db.exec(`create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text);alter table storage.objects enable row level security;
    create publication supabase_realtime;create role authenticated nologin;create role anon nologin;create role service_role nologin bypassrls;`);
  await db.exec(read('supabase/migrations/20261024000000_init.sql').replace('create extension if not exists pgcrypto;', ''));
  await db.exec(read('supabase/seed.sql'));
  await db.exec('grant usage on schema public,auth to authenticated,anon,service_role;');
  await db.exec(read('supabase/migrations/20261026000700_business_automation.sql'));
  await db.exec(read('supabase/migrations/20261026000900_automation_action_claim.sql'));
  await db.query('insert into auth.users(id) values($1)', [userId]);
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec('reset role;truncate automation_tasks restart identity cascade;'); });

async function task(status = 'review') {
  return (await db.query(`insert into automation_tasks(kind,department_id,owner_agent,title,status,result)
    values('catalogue','catalog','catalogLead','Review product copy',$1,$2) returning *`, [status, { actions: proposals }])).rows[0];
}
async function claim(row, { index = 0, kind = proposals[index]?.kind, payload = proposals[index]?.payload, revision = row.revision, actor = userId, role = 'service_role' } = {}) {
  await db.exec(`set role ${role}`);
  try { return (await db.query('select claim_automation_action($1,$2,$3,$4,$5,$6) as id', [row.id, revision, index, kind, payload, actor])).rows[0].id; }
  finally { await db.exec('reset role'); }
}
async function release(row, actionId) {
  await db.query("update automation_actions set status='completed',result='{}' where id=$1", [actionId]);
  return (await db.query("update automation_tasks set status='review',state='{}' where id=$1 returning *", [row.id])).rows[0];
}

test('browser roles cannot invoke the action claim even for a visible task', async () => {
  const row = await task();
  for (const role of ['anon', 'authenticated']) await assert.rejects(claim(row, { role }), code('42501'));
  assert.equal((await db.query('select count(*)::int n from automation_actions')).rows[0].n, 0);
});

test('a valid claim atomically preserves the approved payload and locks the task', async () => {
  const row = await task(), actionId = await claim(row);
  const action = (await db.query('select * from automation_actions')).rows[0];
  const current = (await db.query('select * from automation_tasks where id=$1', [row.id])).rows[0];
  assert.equal(action.id, actionId);
  assert.equal(action.requested_by, userId);
  assert.equal(action.status, 'executing');
  assert.deepEqual(action.payload, proposals[0].payload);
  assert.equal(current.status, 'blocked');
  assert.equal(current.state.executionPending, actionId);
  assert.equal(current.revision, row.revision + 1);
});

test('a stale competing proposal leaves no orphan claim and can be approved on the next revision', async () => {
  const row = await task(), first = await claim(row);
  await assert.rejects(claim(row, { index: 1 }), code('40001'));
  assert.equal((await db.query('select count(*)::int n from automation_actions where action_index=1')).rows[0].n, 0);
  const fresh = await release(row, first);
  const second = await claim(fresh, { index: 1 });
  assert.notEqual(second, first);
  assert.equal((await db.query('select count(*)::int n from automation_actions')).rows[0].n, 2);
});

test('forged payloads, mismatched tools and invalid indices cannot claim a saved proposal', async () => {
  const row = await task();
  await assert.rejects(claim(row, { payload: { ...proposals[0].payload, title: 'Unreviewed title' } }), code('22023'));
  await assert.rejects(claim(row, { kind: 'follow_up' }), code('22023'));
  await assert.rejects(claim(row, { index: 8, kind: 'catalogue_copy', payload: proposals[0].payload }), code('22023'));
  await assert.rejects(claim(row, { index: -1 }), code('22023'));
  await assert.rejects(claim(row, { actor: null }), code('22023'));
  assert.equal((await db.query('select count(*)::int n from automation_actions')).rows[0].n, 0);
  assert.equal((await db.query('select revision from automation_tasks where id=$1', [row.id])).rows[0].revision, row.revision);
});

test('a previously executed proposal cannot be re-claimed and the failed duplicate leaves task state intact', async () => {
  const row = await task(), first = await claim(row), fresh = await release(row, first);
  await assert.rejects(claim(fresh), code('23505'));
  const current = (await db.query('select * from automation_tasks where id=$1', [row.id])).rows[0];
  assert.equal(current.status, 'review');
  assert.deepEqual(current.state, {});
  assert.equal(current.revision, fresh.revision);
  assert.equal((await db.query('select count(*)::int n from automation_actions')).rows[0].n, 1);
});

test('a failure locking the task rolls back the action insert so an explicit retry remains possible', async () => {
  const row = await task();
  await db.exec(`create function fail_test_action_lock() returns trigger language plpgsql as $$ begin
    if new.state ? 'executionPending' then raise exception 'simulated lock checkpoint failure'; end if;return new;end $$;
    create trigger fail_test_action_lock before update on automation_tasks for each row execute function fail_test_action_lock();`);
  try { await assert.rejects(claim(row), /simulated lock checkpoint failure/); }
  finally { await db.exec('drop trigger fail_test_action_lock on automation_tasks;drop function fail_test_action_lock();'); }
  assert.equal((await db.query('select count(*)::int n from automation_actions')).rows[0].n, 0);
  const current = (await db.query('select * from automation_tasks where id=$1', [row.id])).rows[0];
  assert.equal(current.status, 'review');
  assert.equal(current.revision, row.revision);
  assert.ok(await claim(current));
});

test('cancelled, queued and already executing tasks reject new action claims', async () => {
  for (const status of ['cancelled', 'queued', 'running', 'failed', 'blocked']) await assert.rejects(claim(await task(status)), code('40001'));
  const row = await task();
  const pending = (await db.query("update automation_tasks set state='{" + '"executionPending":"already-claimed"' + "}' where id=$1 returning *", [row.id])).rows[0];
  await assert.rejects(claim(pending), code('40001'));
});

test('Instagram send has its reserved claim index and regular proposals cannot execute after acceptance', async () => {
  const accepted = await task('completed');
  await assert.rejects(claim(accepted), code('22023'));
  await assert.rejects(claim(accepted, { kind: 'instagram_reply', index: 0, payload: { inquiryId: 'saved' } }), code('22023'));
  const actionId = await claim(accepted, { kind: 'instagram_reply', index: 10000, payload: { inquiryId: 'saved', recipientId: 'provider-sender', text: 'Approved reply' } });
  const action = (await db.query('select * from automation_actions where id=$1', [actionId])).rows[0];
  assert.equal(action.action_index, 10000);
  assert.equal(action.kind, 'instagram_reply');
});
