import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ids = { creative:'00000000-0000-4000-8000-000000000001', ecom:'00000000-0000-4000-8000-000000000002', perf:'00000000-0000-4000-8000-000000000003', viewer:'00000000-0000-4000-8000-000000000004' };

test('cross-department Studio requests expose only their own designs, set and reviews',async()=>{
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text); alter table storage.objects enable row level security;
    create publication supabase_realtime; create role authenticated nologin; create role anon nologin; create role service_role nologin;`);
  for(const migration of ['20261024000000_init','20261024000200_seo_studio','20261024001100_reviews_usage','20261026000000_design_library','20261027000400_carousel_cards','20261027000500_carousel_reference_background','20261027000700_studio_requester_read'])
    await db.exec(read(`supabase/migrations/${migration}.sql`).replace('create extension if not exists pgcrypto;',''));
  await db.exec(read('supabase/seed.sql'));
  await db.exec(`grant usage on schema public,auth to authenticated; grant select on all tables in schema public to authenticated; grant execute on function auth.uid() to authenticated;`);
  for(const [role,id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id,{full_name:role}]);
    await db.query('update profiles set role=$1 where id=$2',[role==='creative'?'creative_head':role==='ecom'?'ecom_manager':role==='perf'?'perf_marketer':'viewer',id]);
  }
  const image='10000000-0000-4000-8000-000000000001',set='20000000-0000-4000-8000-000000000001';
  await db.query("insert into designs(id,requested_by,format,brief,status) values($1,$2,'portrait','Owner-only ad poster','queued')",[image,ids.ecom]);
  await db.query("insert into carousel_sets(id,requested_by,category,window_from,window_to) values($1,$2,'Ring','2026-09-27','2026-10-26')",[set,ids.ecom]);
  await db.query("insert into image_reviews(source,item_id,verdict,note) values('design',$1,'good','Approved')",[image]);
  const as = async (who,sql) => {
    await db.exec(`reset role; select set_config('test.uid','${ids[who]}',false); set role authenticated;`);
    try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
  };
  for(const table of ['designs','carousel_sets','image_reviews']) {
    assert.equal((await as('ecom',`select * from ${table}`)).length,1,`${table}: requester`);
    assert.equal((await as('creative',`select * from ${table}`)).length,1,`${table}: Creative head`);
    assert.equal((await as('perf',`select * from ${table}`)).length,0,`${table}: unrelated head`);
    assert.equal((await as('viewer',`select * from ${table}`)).length,0,`${table}: viewer`);
  }
  assert.equal((await as('ecom','select * from ai_images')).length,1);
  await db.close();
});
