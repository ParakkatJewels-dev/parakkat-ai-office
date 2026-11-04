import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { sourceFolder, outputName, safeWorkerText } from '../src/lib/video-edit/core.mjs';

const migration = readFileSync(new URL('../supabase/migrations/20261104000000_video_edit_jobs.sql', import.meta.url), 'utf8');
const users = { owner: '00000000-0000-4000-8000-000000000001', head: '00000000-0000-4000-8000-000000000002', outsider: '00000000-0000-4000-8000-000000000003' };
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create type app_role as enum('super_admin','creative_head','ecom_manager','perf_marketer','viewer');
    create table profiles(id uuid primary key references auth.users,role app_role not null);
    create table departments(id text primary key,human_head_role app_role not null);
    create table agents(id text primary key,role_desc text,model text);
    create function my_role() returns app_role language sql stable security definer set search_path=public as $$select coalesce((select role from profiles where id=auth.uid()),'viewer'::app_role)$$;
    create function is_admin() returns boolean language sql stable security definer set search_path=public as $$select my_role()='super_admin'$$;
    grant usage on schema public,auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated;
    grant select on profiles,departments to authenticated;
    insert into departments values('reels','creative_head'); insert into agents values('videoEditor','Old editor','Gemini');`);
  for (const [who, role] of [['owner', 'super_admin'], ['head', 'creative_head'], ['outsider', 'ecom_manager']]) {
    await db.query('insert into auth.users values($1)', [users[who]]);
    await db.query('insert into profiles values($1,$2)', [users[who], role]);
  }
  await db.exec(migration);
});
after(async () => db?.close());
beforeEach(async () => db.exec('delete from video_edit_jobs'));

async function as(who, sql, params = []) {
  await db.exec(`reset role; select set_config('test.uid','${users[who]}',false); set role authenticated`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role'); }
}

test('media folders and export names remain relative and cannot escape the Mac root', () => {
  assert.equal(sourceFolder('Launch/Raw clips'), 'Launch/Raw clips');
  assert.equal(sourceFolder('Launch\\Raw clips'), 'Launch/Raw clips');
  for (const path of ['../outside', '/absolute', 'folder/../outside', 'folder//child', 'C:\\Windows', '.']) assert.equal(sourceFolder(path), null);
  assert.equal(outputName('November reel.mp4'), 'November reel');
  for (const name of ['../evil', '/absolute', 'x/y', '']) assert.equal(outputName(name), null);
  assert.equal(safeWorkerText('Editing clip 1'), 'Editing clip 1');
  assert.equal(safeWorkerText('line\nbreak'), null);
});

test('only the service role can claim, and one queued job is claimed once', async () => {
  const id = (await db.query("insert into video_edit_jobs(created_by,client_id,brief,source_folder,output_name) values($1,gen_random_uuid(),'Make a reel','Launch','Launch reel') returning id", [users.owner])).rows[0].id;
  await assert.rejects(as('owner', "select * from claim_video_edit_job('spoof')"), /permission denied/);
  const claim = (await db.query("select * from claim_video_edit_job('editing-mac')")).rows[0];
  assert.equal(claim.id, id);
  assert.equal(claim.status, 'running');
  assert.ok(claim.claim_token);
  assert.equal((await db.query("select * from claim_video_edit_job('other')")).rows.length, 0);
  assert.equal((await as('head', 'select id from video_edit_jobs')).rows.length, 1);
  assert.equal((await as('outsider', 'select id from video_edit_jobs')).rows.length, 0);
  await assert.rejects(as('head', "update video_edit_jobs set status='review' where id=$1", [id]), /permission denied|row-level/);
});

test('an expired running edit is not automatically claimed again', async () => {
  await db.query("insert into video_edit_jobs(created_by,client_id,brief,source_folder,output_name) values($1,gen_random_uuid(),'Cut the sample','Sample','sample')", [users.owner]);
  const first = (await db.query("select * from claim_video_edit_job('editing-mac')")).rows[0];
  await db.query("update video_edit_jobs set lease_until=now()-interval '1 minute' where id=$1", [first.id]);
  assert.equal((await db.query("select * from claim_video_edit_job('other-mac')")).rows.length, 0);
  assert.equal((await db.query('select status,claim_token from video_edit_jobs where id=$1', [first.id])).rows[0].status, 'running');
});
