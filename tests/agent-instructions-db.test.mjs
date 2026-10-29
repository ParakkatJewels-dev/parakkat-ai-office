import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
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
let db;
async function as(user, sql, params = [], role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.uid', $1, false)", [users[user] || '']);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
const save = async (user, agent = 'creativeDirector', text = 'Use recorded evidence.', expected = 0) =>
  (await as(user, 'select * from public.save_agent_instructions($1,$2,$3)', [agent, text, expected])).rows[0];
const code = expected => error => error.code === expected;

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
  await db.exec(read('supabase/migrations/20261026000600_agent_instructions.sql'));
  for (const [name, id] of Object.entries(users)) {
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [id, { full_name: name }]);
    await db.query('update profiles set role=$1 where id=$2', [roles[name], id]);
  }
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("truncate agent_instructions,agent_instruction_history restart identity; update departments set human_head_role='creative_head' where id='creative';");
  await db.query("update profiles set role='creative_head' where id=$1", [users.creative]);
});

test('unauthenticated callers, viewers, and another department head cannot save', async () => {
  await assert.rejects(save(null), code('42501'));
  await assert.rejects(as(null, 'select save_agent_instructions($1,$2,$3)', ['creativeDirector', 'x', 0], 'anon'), code('42501'));
  await assert.rejects(save('viewer'), code('42501'));
  await assert.rejects(save('perf'), code('42501'));
  await assert.rejects(save('ecom'), code('42501'));
  assert.equal((await db.query('select count(*)::int n from agent_instructions')).rows[0].n, 0);
});

test('the assigned head saves trimmed instructions and matching immutable audit metadata', async () => {
  const first = await save('creative', 'creativeDirector', ' \n\tUse real product photos.\n\t ');
  assert.equal(first.instructions, 'Use real product photos.');
  assert.equal(first.revision, 1); assert.equal(first.updated_by, users.creative);
  const second = await save('creative', 'creativeDirector', 'Prioritize Kerala audiences.', 1);
  assert.equal(second.revision, 2);
  const history = (await as('creative', 'select * from agent_instruction_history order by revision')).rows;
  assert.deepEqual(history.map(row => [row.old_revision, row.revision, row.instructions]), [[0, 1, first.instructions], [1, 2, second.instructions]]);
  assert.ok(history.every(row => row.updated_by === users.creative));
  assert.equal(new Date(history[1].updated_at).getTime(), new Date(second.updated_at).getTime());
});

test('Super Admin can edit every department and blank text clears with a new revision', async () => {
  await save('admin', 'creativeDirector'); await save('admin', 'metaSpec');
  const cleared = await save('admin', 'metaSpec', '\t \n', 1);
  assert.equal(cleared.instructions, ''); assert.equal(cleared.revision, 2);
  assert.equal((await as('admin', 'select * from agent_instruction_history')).rows.length, 3);
});

test('first-insert and later stale revisions fail without replacing text or adding history', async () => {
  await assert.rejects(save('creative', 'creativeDirector', 'Wrong first revision', 1), code('40001'));
  const first = await save('creative', 'creativeDirector', 'First browser tab', 0);
  await assert.rejects(save('creative', 'creativeDirector', 'Second tab stale initial save', 0), code('40001'));
  await save('creative', 'creativeDirector', 'Latest revision', first.revision);
  await assert.rejects(save('admin', 'creativeDirector', 'Stale update', 1), code('40001'));
  assert.equal((await db.query('select instructions from agent_instructions')).rows[0].instructions, 'Latest revision');
  assert.equal((await db.query('select count(*)::int n from agent_instruction_history')).rows[0].n, 2);
});

test('unknown agents, null inputs, invalid revisions, and overlong Unicode text are rejected', async () => {
  await assert.rejects(save('admin', 'not-an-agent'), code('P0002'));
  await assert.rejects(save('admin', null), code('P0002'));
  for (const expected of [null, -1]) await assert.rejects(save('creative', 'creativeDirector', 'x', expected), code('22023'));
  await assert.rejects(save('creative', 'creativeDirector', null), code('22023'));
  await assert.rejects(save('creative', 'creativeDirector', '😀'.repeat(6001)), code('22023'));
  const row = await save('creative', 'creativeDirector', '😀'.repeat(6000));
  assert.equal([...row.instructions].length, 6000);
});

test('current instructions and history are visible only to the assigned head or Super Admin', async () => {
  await save('admin', 'creativeDirector'); await save('admin', 'metaSpec');
  for (const table of ['agent_instructions', 'agent_instruction_history']) {
    assert.deepEqual((await as('creative', `select agent_id from ${table}`)).rows.map(row => row.agent_id), ['creativeDirector']);
    assert.deepEqual((await as('perf', `select agent_id from ${table}`)).rows.map(row => row.agent_id), ['metaSpec']);
    assert.equal((await as('ecom', `select * from ${table}`)).rows.length, 0);
    assert.equal((await as('viewer', `select * from ${table}`)).rows.length, 0);
    assert.equal((await as(null, `select * from ${table}`)).rows.length, 0);
    assert.equal((await as('admin', `select * from ${table}`)).rows.length, 2);
    await assert.rejects(as(null, `select * from ${table}`, [], 'anon'), code('42501'));
  }
});

test('department reassignment immediately changes read and save authority; viewers remain denied', async () => {
  await save('creative');
  await db.exec("update departments set human_head_role='ecom_manager' where id='creative'");
  assert.equal((await as('creative', 'select * from agent_instructions')).rows.length, 0);
  assert.equal((await as('creative', 'select * from agent_instruction_history')).rows.length, 0);
  await assert.rejects(save('creative', 'creativeDirector', 'Former head', 1), code('42501'));
  await save('ecom', 'creativeDirector', 'New head', 1);
  await db.exec("update departments set human_head_role='viewer' where id='creative'");
  assert.equal((await as('viewer', 'select * from agent_instructions')).rows.length, 0);
  await assert.rejects(save('viewer', 'creativeDirector', 'Viewer head', 2), code('42501'));
});

test('even Super Admin and runtime roles cannot bypass the RPC or alter audit history', async () => {
  await save('admin');
  for (const sqlRole of ['authenticated', 'service_role']) {
    for (const table of ['agent_instructions', 'agent_instruction_history']) {
      await assert.rejects(as('admin', `update ${table} set instructions='bypass'`, [], sqlRole), code('42501'));
      await assert.rejects(as('admin', `delete from ${table}`, [], sqlRole), code('42501'));
    }
    await assert.rejects(as('admin', "insert into agent_instructions(agent_id,instructions,revision) values('metaSpec','bypass',1)", [], sqlRole), code('42501'));
    await assert.rejects(as('admin', "insert into agent_instruction_history(agent_id,instructions,old_revision,revision) values('metaSpec','bypass',0,1)", [], sqlRole), code('42501'));
  }
  assert.equal((await as(null, 'select * from agent_instructions', [], 'service_role')).rows.length, 1);
  assert.equal((await as(null, 'select * from agent_instruction_history', [], 'service_role')).rows.length, 1);
  await assert.rejects(as('admin', "select save_agent_instructions('metaSpec','runtime bypass',0)", [], 'service_role'), code('42501'));
});

test('revoking a former editor role removes both saved-instruction access and edit authority', async () => {
  await save('creative');
  await db.query("update profiles set role='viewer' where id=$1", [users.creative]);
  assert.equal((await as('creative', 'select * from agent_instructions')).rows.length, 0);
  assert.equal((await as('creative', 'select * from agent_instruction_history')).rows.length, 0);
  await assert.rejects(save('creative', 'creativeDirector', 'Former editor', 1), code('42501'));
});

test('an audit insert failure rolls back the current instructions and revision', async () => {
  await save('creative', 'creativeDirector', 'Keep this');
  await db.exec("create function test_reject_history() returns trigger language plpgsql as $$ begin raise exception 'history unavailable'; end $$; create trigger test_reject_history before insert on agent_instruction_history for each row execute function test_reject_history();");
  try { await assert.rejects(save('creative', 'creativeDirector', 'Must roll back', 1), /history unavailable/); }
  finally { await db.exec('drop trigger test_reject_history on agent_instruction_history; drop function test_reject_history();'); }
  const row = (await db.query('select instructions,revision from agent_instructions')).rows[0];
  assert.deepEqual(row, { instructions: 'Keep this', revision: 1 });
  assert.equal((await db.query('select count(*)::int n from agent_instruction_history')).rows[0].n, 1);
});
