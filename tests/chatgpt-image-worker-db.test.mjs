import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let db;
const ids={owner:'10000000-0000-4000-8000-000000000001',other:'10000000-0000-4000-8000-000000000002',design:'20000000-0000-4000-8000-000000000001',creative:'20000000-0000-4000-8000-000000000002',campaign:'30000000-0000-4000-8000-000000000001',request:'40000000-0000-4000-8000-000000000001',newer:'40000000-0000-4000-8000-000000000002',holder:'50000000-0000-4000-8000-000000000001',otherHolder:'50000000-0000-4000-8000-000000000002'};
const hash='a'.repeat(64),outputHash='b'.repeat(64);
const value=async(sql,args=[]) => (await db.query(`select ${sql} as result`,args)).rows[0].result;
const reserve=(source='design',user=ids.owner)=>value('reserve_chatgpt_image_job($1,$2,$3,$4)',[source,ids[source],ids.request,user]);
const claim=(job,holder=ids.holder)=>value('claim_chatgpt_image_job($1,$2)',[job.id,holder]);
const dispatch=(job,holder=ids.holder)=>value('dispatch_chatgpt_image_job($1,$2,$3)',[job.id,holder,hash]);
const outputPath=job=>`chatgpt-imports/${job.source}/${job.item_id}/${job.request_id}/${job.id}.png`;
const complete=(job,holder=ids.holder,sha=outputHash,path=outputPath(job))=>value('complete_chatgpt_image_job($1,$2,$3,$4)',[job.id,holder,path,sha]);
const fail=(job,kind='preflight')=>value('fail_chatgpt_image_job($1,$2,$3)',[job.id,ids.holder,kind]);
const expire=job=>db.query("update chatgpt_image_jobs set lease_until=now()-interval '1 minute' where id=$1",[job.id]);

before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);
 create type app_role as enum('super_admin','creative_head','ecom_manager','perf_marketer','viewer');
 create table profiles(id uuid primary key references auth.users,role app_role not null);
 create table departments(id text primary key,human_head_role app_role);
 create table campaigns(id uuid primary key,name text,status text,channels text[]);
 create table approvals(id int primary key,campaign_id uuid,required_roles app_role[]);
 create table designs(id uuid primary key,requested_by uuid,format text,brief text,headline text,language text,image_path text,status text,review_note text,error text,created_at timestamptz default now(),concept text,ref_ids uuid[] default '{}',versions jsonb not null default '[]',redo_note text,queued_at timestamptz);
 create table creatives(id uuid primary key,campaign_id uuid references campaigns,kind text,headline text,body text,language text,image_path text,art_status text,review_note text,art_error text,created_at timestamptz default now(),concept text,ref_ids uuid[] default '{}',versions jsonb not null default '[]',redo_note text,queued_at timestamptz,product_ids bigint[]);
 create table image_reviews(source text,item_id uuid,verdict text,note text,reviewer uuid,reviewer_role app_role,updated_at timestamptz default now(),primary key(source,item_id));
 create table design_refs(id uuid primary key,status text,hidden boolean);
 create table carousel_sets(id uuid primary key,background_status text check(background_status in ('queued','making','ready','failed')),background_path text,started_at timestamptz);`);
 for(const file of ['20261027000400_carousel_cards.sql','20261026000500_campaign_artwork_freeze.sql','20261028000300_chatgpt_artwork_import.sql','20261028000400_higgsfield_artwork_import.sql','20261028000500_higgsfield_generation.sql','20261029000600_chatgpt_image_worker.sql'])
  await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate image_reviews,creatives,designs,campaigns,approvals,profiles,auth.users,departments,design_refs cascade;');
 for(const [id,role] of [[ids.owner,'ecom_manager'],[ids.other,'perf_marketer']]){
  await db.query('insert into auth.users values($1)',[id]);await db.query('insert into profiles values($1,$2)',[id,role]);
 }
 await db.query("insert into campaigns values($1,'Draft','draft',array['meta'])",[ids.campaign]);
 await db.query("insert into approvals values(1,$1,array['ecom_manager']::app_role[])",[ids.campaign]);
 const packet={packet:{requestId:ids.request},refs:[]};
 await db.query("insert into designs(id,requested_by,status,image_path,artwork_request_id,artwork_handoff,format) values($1,$2,'awaiting_import','old.png',$3,$4,'post')",[ids.design,ids.owner,ids.request,packet]);
 await db.query("insert into creatives(id,campaign_id,art_status,image_path,artwork_request_id,artwork_handoff) values($1,$2,'awaiting_import','old.png',$3,$4)",[ids.creative,ids.campaign,ids.request,packet]);
 await db.query("insert into image_reviews(source,item_id,verdict,reviewer,reviewer_role) values('design',$1,'good',$2,'ecom_manager')",[ids.design,ids.owner]);
});

test('reservation is explicit, authorized and unique for one request',async()=>{
 assert.equal((await db.query('select * from chatgpt_image_jobs')).rows.length,0);
 await assert.rejects(reserve('design',ids.other),/not available/);
 const first=await reserve(),second=await reserve();assert.equal(first.id,second.id);
 assert.equal((await db.query('select status from designs')).rows[0].status,'generating');
 assert.equal((await db.query('select * from chatgpt_image_jobs')).rows.length,1);
});
test('a held claim cannot overlap, but expired preparation can be reclaimed before dispatch',async()=>{
 let job=await reserve();job=await claim(job);assert.equal(job.state,'preparing');
 assert.equal(await claim(job,ids.otherHolder),null);await expire(job);
 const reclaimed=await claim(job,ids.otherHolder);assert.equal(reclaimed.lease_holder,ids.otherHolder);assert.equal(reclaimed.dispatched_at,null);
 await assert.rejects(dispatch(job),/lease changed/);
});
test('dispatch intent is irreversible and an expired dispatched job is never reissued',async()=>{
 let job=await claim(await reserve());job=await dispatch(job);assert.ok(job.dispatched_at);
 await assert.rejects(dispatch(job),/already dispatched/);await expire(job);
 const recovered=await claim(job,ids.otherHolder);assert.equal(recovered.state,'uncertain');assert.equal(recovered.lease_holder,ids.holder);
 assert.equal(await claim(job,ids.otherHolder),null);
 assert.equal((await reserve()).state,'uncertain');
 assert.equal((await db.query('select status from designs')).rows[0].status,'awaiting_import');
});
test('late original output can recover after expiry, preserving versions and requiring human review',async()=>{
 let job=await dispatch(await claim(await reserve()));await expire(job);await claim(job,ids.otherHolder);
 const first=await complete(job),again=await complete(job);assert.deepEqual(first,again);assert.equal(first.version,2);
 const row=(await db.query('select * from designs')).rows[0];assert.equal(row.artwork_origin,'chatgpt_import');assert.equal(row.status,'ready');assert.equal(row.image_path,outputPath(job));
 assert.equal(row.versions.length,1);assert.equal(row.versions[0].image_path,'old.png');assert.match(row.review_note,/Human review required/);
 assert.equal((await db.query('select * from image_reviews')).rows.length,0);
 await assert.rejects(complete(job,ids.holder,'c'.repeat(64)),/different image/);
});
test('fresh request, changed actor and conflicting manual import prevent stale completion',async()=>{
 const job=await dispatch(await claim(await reserve()));
 await db.query('update designs set artwork_request_id=$1 where id=$2',[ids.newer,ids.design]);
 await assert.rejects(complete(job),/request changed/);
 await db.query('update designs set artwork_request_id=$1 where id=$2',[ids.request,ids.design]);
 await db.query("update profiles set role='viewer' where id=$1",[ids.owner]);
 await assert.rejects(complete(job),/authorized department head/);
 await db.query("update profiles set role='ecom_manager' where id=$1",[ids.owner]);
 await fail(job,'uncertain');
 const manual=`chatgpt-imports/design/${ids.design}/${ids.request}/60000000-0000-4000-8000-000000000001.png`;
 await value('commit_external_artwork_import($1,$2,$3,$4,$5,$6)', ['design',ids.design,ids.request,manual,ids.owner,'chatgpt']);
 await assert.rejects(complete(job),/request changed/);
 assert.equal((await db.query('select image_path from designs')).rows[0].image_path,manual);
});
test('failure after dispatch is always uncertain; preflight alone can explicitly retry',async()=>{
 let job=await claim(await reserve());assert.equal((await fail(job)).state,'blocked');
 job=await reserve();assert.equal(job.state,'queued');job=await dispatch(await claim(job));
 assert.equal((await fail(job,'preflight')).state,'uncertain');assert.equal((await reserve()).state,'uncertain');
});
test('wrong paths and missing dispatch cannot commit, and all work remains private',async()=>{
 let job=await claim(await reserve());await assert.rejects(complete(job),/not dispatched/);
 job=await dispatch(job);await assert.rejects(complete(job,ids.holder,outputHash,'other.png'),/path does not belong/);
 for(const role of ['anon','authenticated','service_role']){
  const row=(await db.query("select has_function_privilege($1,'complete_chatgpt_image_job(uuid,uuid,text,text)','execute') as commit,has_table_privilege($1,'chatgpt_image_jobs','SELECT') as read,has_table_privilege($1,'chatgpt_image_jobs','UPDATE') as write,has_function_privilege($1,'owned_chatgpt_image_job(uuid,uuid,boolean)','execute') as helper",[role])).rows[0];
  assert.equal(row.commit,role==='service_role');assert.equal(row.read,role==='service_role');assert.equal(row.write,false);assert.equal(row.helper,false);
 }
});
test('Higgsfield and ChatGPT cannot dispatch the same request',async()=>{
 await db.query("insert into artwork_generation_jobs(source,item_id,request_id,requested_by,model,account_id,state) values('design',$1,$2,$3,'gpt_image_2_5','account','uncertain')",[ids.design,ids.request,ids.owner]);
 await assert.rejects(reserve(),/Higgsfield generation/);
 await db.exec('delete from artwork_generation_jobs');await reserve();
 await assert.rejects(db.query("insert into artwork_generation_jobs(source,item_id,request_id,requested_by,model,account_id,state) values('design',$1,$2,$3,'gpt_image_2_5','account','queued')",[ids.design,ids.request,ids.owner]),/belongs to the ChatGPT/);
});
test('worker claims recheck access and campaign approval waits for image plus review',async()=>{
 const job=await reserve();await db.query("update profiles set role='viewer' where id=$1",[ids.owner]);
 assert.equal((await claim(job)).state,'cancelled');
 await db.query("update profiles set role='ecom_manager' where id=$1",[ids.owner]);
 const creative=await dispatch(await claim(await reserve('creative')));
 await assert.rejects(db.exec("update campaigns set status='approved'"),/Wait for the banner/);
 await complete(creative);await assert.rejects(db.exec("update campaigns set status='approved'"),/human Good review/);
});
