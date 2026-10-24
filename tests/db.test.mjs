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
    create role authenticated nologin; create role anon nologin; create role service_role nologin;`);
  await db.exec(read('supabase/migrations/20261024000000_init.sql').replace('create extension if not exists pgcrypto;', ''));
  await db.exec(read('supabase/seed.sql'));
  await db.exec(read('supabase/migrations/20261024000200_seo_studio.sql'));
  await db.exec(read('supabase/migrations/20261024000300_memory.sql'));
  await db.exec(read('supabase/migrations/20261024000400_scale.sql'));
  await db.exec(read('supabase/migrations/20261024000500_learn_from_leads.sql'));
  await db.exec(read('supabase/migrations/20261024000600_platform_credentials.sql'));
  await db.exec(read('supabase/migrations/20261024000700_sync_lock.sql'));
  await db.exec(read('supabase/migrations/20261024000800_ad_account_column.sql'));
  await db.exec(read('supabase/migrations/20261024000900_dashboard_filters.sql'));
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

test('dashboard totals are summed in the database, past the 1000-row page limit', async () => {
  await db.exec(`insert into products (id, title) values (1, 'Temple necklace'), (2, 'Gold bangle');
    insert into orders_daily (day, product_id, units, revenue)
      select current_date - (g % 25), 1 + (g % 2), 1, 100 from generate_series(0, 1499) g on conflict do nothing;
    insert into ad_insights_daily (day, platform, campaign_id, ad_id, spend, revenue)
      select current_date - (g % 20), case when g % 3 = 0 then 'google' else 'meta' end, 'c1', 'ad' || g, 10, 40 from generate_series(0, 1199) g`);
  const s = (await as('perf', 'select dashboard_summary(30) s')).rows[0].s;
  const orders = (await db.query('select count(*)::int n, sum(revenue)::numeric r from orders_daily where day >= current_date - 30')).rows[0];
  assert.equal(Number(s.revenue), Number(orders.r));
  assert.equal(Number(s.spend), 12000);
  assert.equal(s.platforms[0].platform, 'meta');
  assert.equal(s.top[0].title.length > 0, true);
  const sold = (await as('perf', `select * from sales_by_product(current_date - 30, 5)`)).rows;
  assert.equal(sold.length, 2);
});

test("agent scorecards count each head's own agents only", async () => {
  await db.exec(`insert into agent_events (kind, from_agent, from_dept, to_dept, text) values
    ('think', 'photoEditor', 'photo', 'photo', 'retouching'), ('think', 'photoEditor', 'photo', 'photo', 'cropping'), ('think', 'metaSpec', 'perf', 'perf', 'bids')`);
  const q = `select agent_id, actions::int, last_text from agent_activity(array['photoEditor', 'metaSpec'], now() - interval '30 days') order by agent_id`;
  const creative = (await as('creative', q)).rows, admin = (await as('admin', q)).rows;
  assert.equal(creative.find(r => r.agent_id === 'photoEditor').actions, 2);
  assert.equal(creative.find(r => r.agent_id === 'metaSpec').actions, 0); // hidden by row-level security
  assert.equal(admin.find(r => r.agent_id === 'metaSpec').actions, 1);
});

test("an AI team lead's rejection becomes a lesson for that department", async () => {
  await db.exec(`insert into reports (id, department_id, author_agent, lead_agent, title, body, status) values
    ('10000000-0000-0000-0000-0000000000a1', 'photo', 'photoEditor', 'studioLead', 'yellow cast shots', 'x', 'lead_review')`);
  await db.exec(`update reports set status = 'rejected_by_lead', lead_note = 'Gold looks brassy; correct the white balance' where id = '10000000-0000-0000-0000-0000000000a1'`);
  const l = (await as('creative', `select lesson, source from lessons where source = 'lead'`)).rows;
  assert.ok(l.some(x => /brassy/.test(x.lesson)));
  assert.equal((await as('perf', `select 1 from lessons where source = 'lead'`)).rows.length, 0);
});

test('saved platform access is out of reach for everyone signed in, the Super Admin included', async () => {
  await db.exec(`insert into platform_credentials (provider, secret) values ('meta', 'sealed')`);
  // the migration revokes access and turns on row-level security with no policies; either one alone keeps it hidden
  // (this harness grants every table to signed-in users after the migrations, so here it is row-level security that holds)
  for (const who of ['admin', 'creative']) {
    const rows = await as(who, 'select secret from platform_credentials').then(r => r.rows, () => []);
    assert.equal(rows.length, 0);
  }
});

test('only one sync holds the lock until it lets go', async () => {
  const take = async who => (await db.query(`select acquire_job_lock('sync', $1, 300) ok`, [who])).rows[0].ok;
  assert.equal(await take('first'), true);
  assert.equal(await take('second'), false);
  await db.query(`select release_job_lock('sync', 'second')`); // someone else's release does nothing
  assert.equal(await take('second'), false);
  await db.query(`select release_job_lock('sync', 'first')`);
  assert.equal(await take('second'), true);
  await db.exec(`update job_locks set until = now() - interval '1 second'`); // an expired lease can be taken over
  assert.equal(await take('third'), true);
});

test('dashboard filters by dates, platform and ad account, and compares with the days just before', async () => {
  await db.exec(`insert into ad_insights_daily (day, platform, account_id, ad_id, spend, revenue) values
    ('2031-10-10', 'meta', '111', 'f1', 100, 400), ('2031-10-11', 'meta', '222', 'f2', 50, 100),
    ('2031-10-12', 'google', '9319022443', 'g1', 30, 90), ('2031-10-05', 'meta', '111', 'f0', 70, 70);`);
  const r = async (...args) => (await as('admin', 'select dashboard_report($1, $2, $3, $4) r', args)).rows[0].r;
  const all = await r('2031-10-08', '2031-10-14', null, null);
  assert.equal(Number(all.spend), 180); assert.equal(Number(all.prev_spend), 70);
  assert.equal(Number((await r('2031-10-08', '2031-10-14', 'meta', null)).spend), 150);
  const one = await r('2031-10-08', '2031-10-14', 'meta', '111');
  assert.equal(Number(one.spend), 100); assert.equal(Number(one.ad_revenue), 400);
  const accts = (await as('admin', 'select * from ad_accounts()')).rows.map(x => `${x.platform}:${x.account_id}`);
  assert.deepEqual(accts, ['google:9319022443', 'meta:111', 'meta:222']);
  await db.exec(`delete from ad_insights_daily where ad_id in ('f0', 'f1', 'f2', 'g1')`);
});
