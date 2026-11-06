import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let db;
const ids = { admin:'10000000-0000-4000-8000-000000000001', owner:'10000000-0000-4000-8000-000000000002', other:'10000000-0000-4000-8000-000000000003', viewer:'10000000-0000-4000-8000-000000000004', creativeHead:'10000000-0000-4000-8000-000000000005',
  design:'20000000-0000-4000-8000-000000000001', blank:'20000000-0000-4000-8000-000000000002', creative:'30000000-0000-4000-8000-000000000001', campaign:'40000000-0000-4000-8000-000000000001' };

/** Run one statement as a signed-in person, through row-level security. */
async function as(user, sql, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('test.uid',$1,false)", [user ? ids[user] : '']);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
const request = (user, source = 'design', item = ids.design, note = null) => as(user, 'select request_design_approval($1,$2,$3) as id', [source, item, note]).then(r => r.rows[0].id);
const decide = (user, id, decision, note = null) => as(user, 'select decide_design_approval($1,$2,$3) as status', [id, decision, note]).then(r => r.rows[0].status);

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create type app_role as enum ('super_admin','creative_head','ecom_manager','perf_marketer','viewer');
    create table profiles(id uuid primary key references auth.users,role app_role not null);
    create function is_admin() returns boolean language sql stable security definer as $$ select exists(select 1 from profiles where id=auth.uid() and role='super_admin') $$;
    create table departments(id text primary key,human_head_role app_role);
    create table campaigns(id uuid primary key,name text,status text,channels text[]);
    create table approvals(id int primary key,campaign_id uuid,required_roles app_role[]);
    create table designs(id uuid primary key,requested_by uuid,format text,brief text,headline text,language text,image_path text,status text,review_note text,error text,created_at timestamptz default now(),concept text,ref_ids uuid[] default '{}',versions jsonb not null default '[]',redo_note text,queued_at timestamptz);
    create table creatives(id uuid primary key,campaign_id uuid references campaigns,kind text,headline text,body text,language text,image_path text,art_status text,review_note text,art_error text,created_at timestamptz default now(),concept text,ref_ids uuid[] default '{}',versions jsonb not null default '[]',redo_note text,queued_at timestamptz,product_ids bigint[]);
    create table image_reviews(source text,item_id uuid,verdict text,note text,reviewer uuid,reviewer_role app_role,updated_at timestamptz default now(),primary key(source,item_id));
    create table design_refs(id uuid primary key,status text,hidden boolean);
    create table carousel_sets(id uuid primary key,background_status text check(background_status in ('queued','making','ready','failed')),background_path text,started_at timestamptz);
    grant usage on schema public, auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated;
    alter default privileges in schema public grant all on tables to authenticated, anon, service_role;`);
  for (const file of ['20261027000400_carousel_cards.sql', '20261026000500_campaign_artwork_freeze.sql', '20261028000300_chatgpt_artwork_import.sql', '20261106000000_design_approvals.sql'])
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  await db.exec('grant select on profiles, designs, creatives, departments, approvals to authenticated; grant execute on function is_admin() to authenticated;');
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('reset role; truncate design_approvals, image_reviews, creatives, designs, campaigns, approvals, profiles, auth.users, departments cascade;');
  for (const [key, role] of [['admin', 'super_admin'], ['owner', 'ecom_manager'], ['other', 'perf_marketer'], ['viewer', 'viewer'], ['creativeHead', 'creative_head']]) {
    await db.query('insert into auth.users values($1)', [ids[key]]); await db.query('insert into profiles values($1,$2)', [ids[key], role]);
  }
  await db.exec("insert into departments values('creative','creative_head')");
  await db.query("insert into campaigns values($1,'Wedding','draft',array['meta'])", [ids.campaign]);
  await db.query("insert into approvals values(1,$1,array['ecom_manager']::app_role[])", [ids.campaign]);
  await db.query("insert into designs(id,requested_by,format,brief,headline,language,status,image_path) values($1,$2,'post','Diwali idol poster','Ganesha Coin Seated','en','ready','designs/ganesha.png')", [ids.design, ids.owner]);
  await db.query("insert into designs(id,requested_by,format,brief,headline,language,status,image_path) values($1,$2,'post','Not drawn yet','','en','queued',null)", [ids.blank, ids.owner]);
  await db.query("insert into creatives(id,campaign_id,kind,language,headline,art_status,image_path) values($1,$2,'banner','en','Gold for your big day','ready','creatives/wedding.png')", [ids.creative, ids.campaign]);
});

test('the person who ordered a design can send it, once, and the request keeps the exact image', async () => {
  const id = await request('owner', 'design', ids.design, 'For the Diwali sale ads');
  assert.equal(await request('owner'), id, 'sending again returns the open request instead of a duplicate');
  const row = (await db.query('select * from design_approvals where id=$1', [id])).rows[0];
  assert.equal(row.status, 'pending'); assert.equal(row.image_path, 'designs/ganesha.png'); assert.equal(row.title, 'Ganesha Coin Seated');
  assert.equal(row.requested_role, 'ecom_manager'); assert.equal(row.request_note, 'For the Diwali sale ads');
  assert.equal((await db.query('select count(*)::int n from design_approvals')).rows[0].n, 1);
});

test('only people who can work on the artwork may send it, and only finished images', async () => {
  await assert.rejects(request('viewer'), /authorized department head/);
  await assert.rejects(request('other'), /not available to this account/);
  await assert.rejects(request('owner', 'design', ids.blank), /no finished image/);
  assert.ok(await request('creativeHead'), 'the creative head can send any studio design');
  assert.ok(await request('owner', 'creative', ids.creative), 'a head who signs the campaign can send its banner');
});

test('only the Super Admin decides, a note is needed to send back or reject, and a decision is final', async () => {
  const id = await request('owner');
  await assert.rejects(decide('owner', id, 'approved'), /Only the Super Admin/);
  await assert.rejects(decide('admin', id, 'changes'), /Add a note/);
  await assert.rejects(decide('admin', id, 'maybe'), /Unknown decision/);
  assert.equal(await decide('admin', id, 'approved'), 'approved');
  const row = (await db.query('select * from design_approvals where id=$1', [id])).rows[0];
  assert.equal(row.decided_by, ids.admin); assert.equal(row.decided_role, 'super_admin'); assert.ok(row.decided_at);
  await assert.rejects(decide('admin', id, 'rejected', 'Too late'), /not waiting on anyone/);
  const again = await request('owner');
  assert.notEqual(again, id, 'after a decision the image can be sent again as a new request');
});

test('row-level security: the Super Admin sees every request, a head only their own, and nobody writes directly', async () => {
  await request('owner'); await request('admin', 'creative', ids.creative);
  assert.equal((await as('admin', 'select count(*)::int n from design_approvals')).rows[0].n, 2);
  assert.equal((await as('owner', 'select count(*)::int n from design_approvals')).rows[0].n, 1);
  assert.equal((await as('other', 'select count(*)::int n from design_approvals')).rows[0].n, 0);
  await assert.rejects(as('owner', "update design_approvals set status='approved'"), /permission denied/);
  await assert.rejects(as('admin', "insert into design_approvals(source,item_id,image_path,requested_by,requested_role) values('design',$1,'x.png',$2,'super_admin')", [ids.design, ids.admin]), /permission denied/);
});
