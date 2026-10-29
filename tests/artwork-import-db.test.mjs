import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let db, migrated;
const ids = { admin:'10000000-0000-4000-8000-000000000001', owner:'10000000-0000-4000-8000-000000000002', other:'10000000-0000-4000-8000-000000000003', viewer:'10000000-0000-4000-8000-000000000004', creativeHead:'10000000-0000-4000-8000-000000000005',
  design:'20000000-0000-4000-8000-000000000001', creative:'20000000-0000-4000-8000-000000000002', campaign:'30000000-0000-4000-8000-000000000001', request:'40000000-0000-4000-8000-000000000001', newer:'40000000-0000-4000-8000-000000000002', ref:'50000000-0000-4000-8000-000000000001' };
const path = (source='design',request=ids.request) => `chatgpt-imports/${source}/${ids[source]}/${request}/60000000-0000-4000-8000-000000000001.png`;
const commit = (source='design',user=ids.owner,request=ids.request,refs=[]) => db.query('select commit_chatgpt_artwork_import($1,$2,$3,$4,$5,$6) as result',[source,ids[source],request,path(source,request),user,refs]);
const review = ({source='design',image=path(source),request=ids.request,user=ids.owner,role='ecom_manager',verdict='good'}={}) => db.query('select review_artwork($1,$2,$3,$4,$5,$6,$7,$8) as result',[source,ids[source],image,request,verdict,verdict==='bad'?'Wrong product':null,user,role]);
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create type app_role as enum ('super_admin','creative_head','ecom_manager','perf_marketer','viewer');
    create table profiles(id uuid primary key references auth.users,role app_role not null);
    create table departments(id text primary key,human_head_role app_role);
    create table campaigns(id uuid primary key,name text,status text,channels text[]);
    create table approvals(id int primary key,campaign_id uuid,required_roles app_role[]);
    create table designs(id uuid primary key,requested_by uuid,format text,brief text,headline text,language text,image_path text,status text,review_note text,error text,created_at timestamptz default now(),concept text,ref_ids uuid[] default '{}',versions jsonb not null default '[]',redo_note text,queued_at timestamptz);
    create table creatives(id uuid primary key,campaign_id uuid references campaigns,kind text,headline text,body text,language text,image_path text,art_status text,review_note text,art_error text,created_at timestamptz default now(),concept text,ref_ids uuid[] default '{}',versions jsonb not null default '[]',redo_note text,queued_at timestamptz,product_ids bigint[]);
    create table image_reviews(source text,item_id uuid,verdict text,note text,reviewer uuid,reviewer_role app_role,updated_at timestamptz default now(),primary key(source,item_id));
    create table design_refs(id uuid primary key,status text,hidden boolean);
    create table carousel_sets(id uuid primary key,background_status text check(background_status in ('queued','making','ready','failed')),background_path text,started_at timestamptz);
    insert into designs(id,format,status,image_path) values('${ids.design}','post','queued','preserved.png'),('${ids.creative}','post','making','uncertain.png');
    insert into carousel_sets values('${ids.campaign}','queued','private-background.png',null);`);
  for(const file of ['20261027000400_carousel_cards.sql','20261026000500_campaign_artwork_freeze.sql','20261028000300_chatgpt_artwork_import.sql','20261028000400_higgsfield_artwork_import.sql','20261028000500_higgsfield_generation.sql'])
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  migrated={designs:(await db.query('select id,status,image_path,artwork_request_id,queued_at from designs order by id')).rows,set:(await db.query('select * from carousel_sets')).rows[0]};
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('truncate image_reviews,creatives,designs,campaigns,approvals,profiles,auth.users,departments,design_refs cascade;');
  for(const [key,role] of [['admin','super_admin'],['owner','ecom_manager'],['other','perf_marketer'],['viewer','viewer'],['creativeHead','creative_head']]){
    await db.query('insert into auth.users values($1)',[ids[key]]);await db.query('insert into profiles values($1,$2)',[ids[key],role]);
  }
  await db.exec("insert into departments values('creative','creative_head')");
  await db.query("insert into campaigns values($1,'Private campaign','draft',array['meta'])",[ids.campaign]);
  await db.query("insert into approvals values(1,$1,array['ecom_manager']::app_role[])",[ids.campaign]);
  await db.query("insert into designs(id,requested_by,format,brief,headline,language,status,image_path,concept,redo_note,artwork_request_id) values($1,$2,'post','Private brief','Exact headline','en','awaiting_import','old.png','Old direction','New lighting',$3)",[ids.design,ids.owner,ids.request]);
  await db.query("insert into creatives(id,campaign_id,kind,language,headline,art_status,image_path,artwork_request_id) values($1,$2,'banner','en','Exact headline','awaiting_import','old-campaign.png',$3)",[ids.creative,ids.campaign,ids.request]);
  await db.query("insert into design_refs values($1,'ready',false)",[ids.ref]);
  await db.query("insert into image_reviews(source,item_id,verdict,reviewer,reviewer_role) values('design',$1,'good',$2,'ecom_manager')",[ids.design,ids.owner]);
});

test('migration converts only unstarted work and preserves image history and private backgrounds',()=>{
  assert.equal(migrated.designs[0].status,'awaiting_import');assert.ok(migrated.designs[0].artwork_request_id);assert.equal(migrated.designs[0].image_path,'preserved.png');
  assert.equal(migrated.designs[1].status,'making');assert.equal(migrated.designs[1].artwork_request_id,null);
  assert.equal(migrated.set.background_status,'unused');assert.equal(migrated.set.background_path,'private-background.png');
});
test('import atomically appends the old image, clears its review and records a human-review draft',async()=>{
  const value=(await commit()).rows[0].result;assert.equal(value.version,2);assert.equal(value.status,'ready');
  const row=(await db.query('select * from designs where id=$1',[ids.design])).rows[0];
  assert.equal(row.image_path,path());assert.equal(row.artwork_origin,'chatgpt_import');assert.equal(row.imported_by,ids.owner);assert.ok(row.imported_at);
  assert.equal(row.versions.length,1);assert.equal(row.versions[0].image_path,'old.png');assert.equal(row.versions[0].concept,'Old direction');assert.equal(row.headline,'Exact headline');
  assert.match(row.review_note,/Human review required; no automated image check/);assert.equal((await db.query('select * from image_reviews')).rows.length,0);
  await assert.rejects(commit(),/request changed/);assert.equal((await db.query('select versions from designs where id=$1',[ids.design])).rows[0].versions.length,1);
});
test('stale request nonce and cross-item storage paths cannot replace the saved artwork',async()=>{
  await assert.rejects(commit('design',ids.owner,ids.newer),/request changed/);
  await assert.rejects(db.query('select commit_chatgpt_artwork_import($1,$2,$3,$4,$5)', ['design',ids.design,ids.request,path('creative'),ids.owner]),/path does not belong/);
  const row=(await db.query('select image_path,versions from designs where id=$1',[ids.design])).rows[0];assert.equal(row.image_path,'old.png');assert.deepEqual(row.versions,[]);
});
test('requester, department and campaign scopes are checked inside the service RPC',async()=>{
  await assert.rejects(commit('design',ids.other),/not available/);await assert.rejects(commit('design',ids.viewer),/authorized department head/);
  await assert.rejects(commit('creative',ids.other),/not available/);
  assert.equal((await commit('design',ids.creativeHead)).rows[0].result.status,'ready');
  assert.equal((await commit('creative',ids.owner)).rows[0].result.status,'ready');
});
test('frozen handoff metadata binds import reference order to the exact request',async()=>{
  await db.query('update designs set artwork_handoff=$1 where id=$2',[{packet:{requestId:ids.request},refs:[{id:ids.ref}]},ids.design]);
  await assert.rejects(commit(),/references do not match/);await commit('design',ids.owner,ids.request,[ids.ref]);
  assert.deepEqual((await db.query('select ref_ids from designs where id=$1',[ids.design])).rows[0].ref_ids,[ids.ref]);
});
test('review/import interleavings cannot carry an old Good verdict onto a new image',async()=>{
  await assert.rejects(review({image:'old.png'}),/Import the finished artwork/);
  await commit();await assert.rejects(review({image:'old.png'}),/artwork changed/);await assert.rejects(review({request:ids.newer}),/artwork changed/);
  await review();assert.equal((await db.query('select verdict from image_reviews')).rows[0].verdict,'good');
  await db.query("update designs set status='awaiting_import',artwork_request_id=$1 where id=$2",[ids.newer,ids.design]);
  await commit('design',ids.owner,ids.newer);assert.equal((await db.query('select * from image_reviews')).rows.length,0);
  await assert.rejects(review(),/artwork changed/);
});
test('reviews derive the actual role and cannot be submitted for another account or unfinished card',async()=>{
  await commit();await assert.rejects(review({role:'super_admin'}),/reviewer role changed/);await assert.rejects(review({user:ids.other,role:'perf_marketer'}),/not available/);
  await db.query("update designs set format='carousel_card',status='needs_fix' where id=$1",[ids.design]);
  await assert.rejects(review(),/finished carousel card/);await review({verdict:'bad'});
});
test('campaign final approval waits for import and human Good review, then freezes replacements',async()=>{
  await assert.rejects(db.exec("update campaigns set status='approved'"),/Wait for the banner import/);
  await commit('creative');await assert.rejects(db.exec("update campaigns set status='approved'"),/human Good review/);
  await review({source:'creative'});await db.exec("update campaigns set status='approved'");
  await assert.rejects(db.exec("update creatives set art_status='awaiting_import'"),/frozen/);
  await assert.rejects(commit('creative'),/frozen/);
});
test('view retains its original columns and appends audit fields without exposing cached briefs',async()=>{
  const fields=(await db.query("select column_name from information_schema.columns where table_name='ai_images' order by ordinal_position")).rows.map(r=>r.column_name);
  assert.deepEqual(fields.slice(-4),['artwork_request_id','artwork_origin','imported_at','imported_by']);assert.equal(fields.includes('artwork_handoff'),false);
});
test('import and review functions are service-only; helper privileges remain private',async()=>{
  for(const role of ['anon','authenticated','service_role']){
    const row=(await db.query("select has_function_privilege($1,'commit_chatgpt_artwork_import(text,uuid,uuid,text,uuid,uuid[])','execute') as commit,has_function_privilege($1,'review_artwork(text,uuid,text,uuid,text,text,uuid,text)','execute') as review,has_function_privilege($1,'artwork_actor_role(text,uuid,uuid)','execute') as helper",[role])).rows[0];
    assert.equal(row.commit,role==='service_role');assert.equal(row.review,role==='service_role');assert.equal(row.helper,false);
  }
});

const externalPath = (source='design') => path(source).replace('chatgpt-imports/','higgsfield-imports/');
const externalCommit = (source='design',provider='higgsfield',storage=externalPath(source),user=ids.owner) => db.query('select commit_external_artwork_import($1,$2,$3,$4,$5,$6) as result',[source,ids[source],ids.request,storage,user,provider]);
test('Higgsfield imports record distinct provenance and retain prior image audit in history',async()=>{
  await db.query("update designs set artwork_origin='chatgpt_import',imported_at=now(),imported_by=$1 where id=$2",[ids.owner,ids.design]);
  const value=(await externalCommit()).rows[0].result;assert.equal(value.provider,'higgsfield');
  const row=(await db.query('select * from designs where id=$1',[ids.design])).rows[0];
  assert.equal(row.artwork_origin,'higgsfield_import');assert.equal(row.image_path,externalPath());assert.match(row.review_note,/Imported from Higgsfield/);
  assert.equal(row.versions[0].artwork_origin,'chatgpt_import');assert.equal(row.versions[0].imported_by,ids.owner);assert.equal((await db.query('select * from image_reviews')).rows.length,0);
});
test('external provider, path and actor checks cannot be bypassed through the service RPC',async()=>{
  for(const provider of ['gemini','',null])await assert.rejects(externalCommit('design',provider),/Unknown artwork provider/);
  await assert.rejects(externalCommit('design','chatgpt'),/path does not belong/);
  await assert.rejects(externalCommit('design','higgsfield',externalPath(),ids.other),/not available/);
  for(const role of ['anon','authenticated','service_role']){
    const row=(await db.query("select has_function_privilege($1,'commit_external_artwork_import(text,uuid,uuid,text,uuid,text,uuid[])','execute') as allowed",[role])).rows[0];assert.equal(row.allowed,role==='service_role');
  }
});
test('Higgsfield campaign imports require a fresh human Good review before approval',async()=>{
  await externalCommit('creative');await assert.rejects(db.exec("update campaigns set status='approved'"),/human Good review/);
  await review({source:'creative',image:externalPath('creative')});await db.exec("update campaigns set status='approved'");
  await assert.rejects(externalCommit('creative'),/frozen/);
});

const holder='70000000-0000-4000-8000-000000000001',otherHolder='70000000-0000-4000-8000-000000000002';
const generationPath=(source='design')=>`higgsfield-generations/${source}/${ids[source]}/${ids.request}/60000000-0000-4000-8000-000000000001.png`;
async function reserveJob(source='design',user=ids.owner){
 await db.query(`update ${source==='design'?'designs':'creatives'} set artwork_handoff=$1 where id=$2`,[{packet:{requestId:ids.request},refs:[]},ids[source]]);
 return (await db.query('select reserve_higgsfield_generation($1,$2,$3,$4,$5,$6) as result',[source,ids[source],ids.request,user,'image-model','account-one'])).rows[0].result;
}
const claimJob=async(job,owner=holder)=>(await db.query('select claim_higgsfield_generation($1,$2,$3) as result',[job.id,owner,job.state])).rows[0].result;
const updateJob=async(job,state,options={})=>(await db.query('select update_higgsfield_generation($1,$2,$3,$4,$5,$6,$7,$8) as result',[job.id,holder,job.state,state,options.providerId??null,new Date(Date.now()-1000).toISOString(),options.code??null,options.error??null])).rows[0].result;
const completeJob=async(job,source='design')=>(await db.query('select complete_higgsfield_generation($1,$2,$3) as result',[job.id,holder,generationPath(source)])).rows[0].result;
async function collectingJob(source='design'){
 let job=await claimJob(await reserveJob(source));job=await updateJob(job,'submitted',{providerId:'provider-'+source});job=await claimJob(job);return updateJob(job,'collecting');
}
test('automatic generation reserves one job per explicit revision and preserves old artwork',async()=>{
 const first=await reserveJob(),again=await reserveJob();assert.equal(first.id,again.id);assert.equal(again.state,'queued');
 const row=(await db.query('select status,image_path,versions from designs')).rows[0];assert.equal(row.status,'generating');assert.equal(row.image_path,'old.png');assert.deepEqual(row.versions,[]);
 await assert.rejects(reserveJob('design',ids.other),/not available/);
 await assert.rejects(db.query('select reserve_higgsfield_generation($1,$2,$3,$4,$5,$6)',['design',ids.design,ids.request,ids.owner,'another-model','account-one']),/saved generation model/);
 await assert.rejects(review({image:'old.png'}),/finished artwork/);
});
test('generation leases exclude duplicate workers and require the expected state',async()=>{
 const reserved=await reserveJob(),job=await claimJob(reserved);assert.equal(job.state,'submitting');assert.equal(job.lease_holder,holder);
 assert.equal(await claimJob(reserved,otherHolder),null);assert.equal(await claimJob(job,otherHolder),null);
 await assert.rejects(db.query('select update_higgsfield_generation($1,$2,$3,$4)',[job.id,otherHolder,'submitting','submitted']),/lease changed/);
 await assert.rejects(updateJob(job,'collecting',{providerId:'request-one'}),/Invalid generation transition/);
});
test('only known pre-submission blocks can be explicitly retried without another revision',async()=>{
 let job=await claimJob(await reserveJob());job=await updateJob(job,'blocked',{code:'credits',error:'Subscription credits required.'});
 assert.equal((await db.query('select status from designs')).rows[0].status,'awaiting_import');
 assert.equal(await claimJob(job),null);const reset=await reserveJob();assert.equal(reset.id,job.id);assert.equal(reset.state,'queued');assert.equal(reset.error,null);
 let failed=await claimJob(reset);failed=await updateJob(failed,'failed',{code:'provider_rejected',error:'Generation rejected.'});
 assert.equal((await reserveJob()).state,'failed');
});
test('expired submission intent becomes uncertain and is never automatically replayed',async()=>{
 let job=await claimJob(await reserveJob());await db.query("update artwork_generation_jobs set lease_until=now()-interval '1 second' where id=$1",[job.id]);
 job=await claimJob(job,otherHolder);assert.equal(job.state,'uncertain');assert.equal(job.error_code,'submission_unknown');assert.equal(job.lease_holder,null);
 assert.equal((await reserveJob()).state,'uncertain');assert.equal((await db.query('select status,image_path from designs')).rows[0].image_path,'old.png');
});
test('provider request identity is immutable and submitted work cannot be reset as a credit block',async()=>{
 let job=await claimJob(await reserveJob());job=await updateJob(job,'submitted',{providerId:'provider-one'});job=await claimJob(job);
 await assert.rejects(updateJob(job,'submitted',{providerId:'provider-two'}),/provider request cannot change/);
 await assert.rejects(updateJob(job,'blocked',{code:'credits'}),/Invalid generation transition/);
 job=await updateJob(job,'submitted');assert.equal(job.provider_request_id,'provider-one');assert.equal(job.lease_holder,null);
});
test('automatic completion atomically saves provenance, history and a fresh human-review requirement',async()=>{
 const job=await collectingJob();assert.equal(job.lease_holder,holder);
 const value=await completeJob(job);assert.equal(value.version,2);assert.equal(value.image_path,generationPath());
 const row=(await db.query('select * from designs')).rows[0];assert.equal(row.artwork_origin,'higgsfield_oauth');assert.equal(row.status,'ready');assert.equal(row.versions[0].image_path,'old.png');assert.ok(row.imported_at);assert.equal(row.imported_by,ids.owner);
 assert.match(row.review_note,/Human review required; no automated image check/);assert.equal((await db.query('select * from image_reviews')).rows.length,0);
 assert.equal((await db.query('select state from artwork_generation_jobs')).rows[0].state,'succeeded');await assert.rejects(completeJob(job),/lease changed/);
});
test('stale automatic completions and wrong result paths cannot replace the visible image',async()=>{
 const job=await collectingJob();await assert.rejects(db.query('select complete_higgsfield_generation($1,$2,$3)',[job.id,holder,path()]),/path does not belong/);
 await db.query('update designs set artwork_request_id=$1 where id=$2',[ids.newer,ids.design]);await assert.rejects(completeJob(job),/request changed/);
 assert.equal((await db.query('select image_path from designs')).rows[0].image_path,'old.png');
});
test('automatic campaign artwork waits for its exact human review and then freezes',async()=>{
 const job=await collectingJob('creative');await assert.rejects(db.exec("update campaigns set status='approved'"),/Wait for the banner/);
 await completeJob(job,'creative');await assert.rejects(db.exec("update campaigns set status='approved'"),/human Good review/);
 await review({source:'creative',image:generationPath('creative')});await db.exec("update campaigns set status='approved'");
 await assert.rejects(reserveJob('creative'),/frozen/);
});
test('generation storage and RPCs are private and application roles cannot mutate job rows',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  const row=(await db.query("select has_table_privilege($1,'artwork_generation_jobs','select') as read,has_table_privilege($1,'artwork_generation_jobs','update') as write,has_function_privilege($1,'reserve_higgsfield_generation(text,uuid,uuid,uuid,text,text,jsonb)','execute') as reserve,has_function_privilege($1,'lock_generation_artwork(text,uuid)','execute') as helper",[role])).rows[0];
  assert.equal(row.read,role==='service_role');assert.equal(row.write,false);assert.equal(row.reserve,role==='service_role');assert.equal(row.helper,false);
 }
});

test('generated result uses the frozen reference order and a lost download can resume the same job',async()=>{
 let job=await collectingJob();
 await db.query('update designs set artwork_handoff=$1 where id=$2',[{packet:{requestId:ids.request},refs:[{id:ids.ref}]},ids.design]);
 await assert.rejects(completeJob(job),/references do not match/);
 job=await updateJob(job,'collecting',{code:'download_retry',error:'Download pending.'});assert.equal(job.lease_holder,null);
 job=await claimJob(job);assert.equal(job.state,'collecting');assert.equal(job.provider_request_id,'provider-design');
 const value=(await db.query('select complete_higgsfield_generation($1,$2,$3,$4) as result',[job.id,holder,generationPath(),[ids.ref]])).rows[0].result;
 assert.equal(value.status,'ready');assert.deepEqual((await db.query('select ref_ids from designs')).rows[0].ref_ids,[ids.ref]);
});

test('a requester losing artwork access cancels a queued job before any provider submission',async()=>{
 const job=await reserveJob();await db.query("update profiles set role='viewer' where id=$1",[ids.owner]);
 const stopped=await claimJob(job);assert.equal(stopped.state,'cancelled');assert.equal(stopped.error_code,'access_changed');assert.equal(stopped.provider_request_id,null);
 assert.equal((await db.query('select status,image_path from designs')).rows[0].status,'awaiting_import');assert.equal(await claimJob(stopped),null);
});

const scope='thread:80000000-0000-4000-8000-000000000001',projectId='90000000-0000-4000-8000-000000000001',folderId='90000000-0000-4000-8000-000000000002';
async function projectJob(source='design',workspace='workspace-one',account='account-one',projectScope=scope){
 await db.query(`update ${source==='design'?'designs':'creatives'} set artwork_handoff=$1 where id=$2`,[{packet:{requestId:ids.request},refs:[]},ids[source]]);
 const job=(await db.query('select reserve_higgsfield_generation($1,$2,$3,$4,$5,$6,$7) as result',[source,ids[source],ids.request,ids.owner,'image-model',account,{projectScope,workspaceId:workspace}])).rows[0].result;
 return claimJob(job);
}
const beginProject=async job=>(await db.query('select begin_higgsfield_generation_project($1,$2) as result',[job.id,holder])).rows[0].result;
const commitProject=async(job,destination)=>(await db.query('select commit_higgsfield_generation_project($1,$2,$3,$4,$5,$6) as result',[job.id,holder,destination.id,destination.token,projectId,folderId])).rows[0].result;
const failProject=async(job,destination)=>(await db.query('select fail_higgsfield_generation_project($1,$2,$3,$4) as result',[job.id,holder,destination.id,destination.token])).rows[0].result;
test('preparation authorizes a fresh uncached brief without reserving generation or exposing private helpers',async()=>{
 const prepare=(user=ids.owner)=>(db.query('select authorize_generation_preparation($1,$2,$3,$4) as result',['design',ids.design,ids.request,user]));
 const first=(await prepare()).rows[0].result;assert.equal(first.requestId,ids.request);assert.equal(first.status,'awaiting_import');
 assert.equal((await db.query('select * from artwork_generation_jobs')).rows.length,0);
 await assert.rejects(prepare(ids.other),/not available/);
 await db.query("update designs set status='ready' where id=$1",[ids.design]);await assert.rejects(prepare(),/Prepare an artwork revision/);
 await db.query("update designs set status='awaiting_import' where id=$1",[ids.design]);const job=await collectingJob();await completeJob(job);
 assert.equal((await prepare()).rows[0].result.status,'ready');
});
test('lease renewal checks current ownership, live request and requester access before a charge',async()=>{
 const job=await claimJob(await reserveJob());
 const renewed=(await db.query('select renew_higgsfield_generation_lease($1,$2,$3,$4) as result',[job.id,holder,'submitting',600])).rows[0].result;
 assert.ok(Date.parse(renewed.lease_until)>Date.parse(job.lease_until));
 await assert.rejects(db.query('select renew_higgsfield_generation_lease($1,$2,$3)',[job.id,otherHolder,'submitting']),/lease changed/);
 await db.query('update designs set artwork_request_id=$1 where id=$2',[ids.newer,ids.design]);
 await assert.rejects(db.query('select renew_higgsfield_generation_lease($1,$2,$3)',[job.id,holder,'submitting']),/request changed/);
 await db.query('update designs set artwork_request_id=$1 where id=$2',[ids.request,ids.design]);
 await db.query("update profiles set role='viewer' where id=$1",[ids.owner]);
 await assert.rejects(db.query('select renew_higgsfield_generation_lease($1,$2,$3)',[job.id,holder,'submitting']),/authorized department head/);
});
test('two jobs in one conversation serialize project creation and reuse the committed folder',async()=>{
 const first=await projectJob(),second=await projectJob('creative');
 const creation=await beginProject(first);assert.equal(creation.state,'claimed');assert.ok(creation.token);
 const waiting=await beginProject(second);assert.equal(waiting.state,'waiting');assert.equal(waiting.id,creation.id);assert.equal(waiting.token,undefined);
 await assert.rejects(commitProject(second,creation),/claim changed/);
 const committed=await commitProject(first,creation);assert.equal(committed.folderId,folderId);
 const reused=await beginProject(second);assert.equal(reused.state,'ready');assert.equal(reused.folderId,folderId);assert.equal(reused.projectId,projectId);
 const usages=(await db.query('select usage from artwork_generation_jobs')).rows;assert.ok(usages.every(row=>row.usage.folder_id===folderId&&row.usage.project_id===projectId));
 assert.equal((await db.query('select * from higgsfield_generation_projects')).rows.length,1);
});
test('project destinations cannot cross the connected workspace',async()=>{
 const first=await beginProject(await projectJob()),second=await beginProject(await projectJob('creative','workspace-two'));
 assert.equal(first.state,'claimed');assert.equal(second.state,'claimed');assert.notEqual(first.id,second.id);
});
test('lost project creation remains uncertain across jobs beyond the provider idempotency window',async()=>{
 const first=await projectJob(),second=await projectJob('creative'),creation=await beginProject(first);
 await db.query("update higgsfield_generation_projects set lease_until=now()-interval '20 minutes' where id=$1",[creation.id]);
 const uncertain=await beginProject(second);assert.equal(uncertain.state,'uncertain');assert.equal(uncertain.id,creation.id);assert.equal(uncertain.token,undefined);
 assert.equal((await beginProject(first)).state,'uncertain');await assert.rejects(commitProject(first,creation),/manual reconciliation/);
 assert.equal((await db.query('select * from higgsfield_generation_projects')).rows.length,1);
});
test('an ambiguous project response is recorded once and cannot erase a successful destination',async()=>{
 const first=await projectJob(),creation=await beginProject(first);
 await assert.rejects(failProject(first,{...creation,token:otherHolder}),/claim changed/);
 await commitProject(first,creation);assert.equal((await commitProject(first,creation)).folderId,folderId);
 assert.equal((await failProject(first,creation)).state,'ready');assert.equal((await beginProject(first)).folderId,folderId);
});
test('preflight retries retain the chosen conversation project and folder',async()=>{
 let job=await projectJob();const creation=await beginProject(job);await commitProject(job,creation);
 job=await updateJob(job,'blocked',{code:'preflight',error:'No image submitted.'});assert.equal(job.usage.folder_id,folderId);
 const retry=await projectJob();assert.equal(retry.id,job.id);const destination=await beginProject(retry);assert.equal(destination.state,'ready');assert.equal(destination.folderId,folderId);
});
test('project helper functions and data remain service-only',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  const row=(await db.query("select has_table_privilege($1,'higgsfield_generation_projects','select') as read,has_table_privilege($1,'higgsfield_generation_projects','update') as write,has_function_privilege($1,'begin_higgsfield_generation_project(uuid,uuid)','execute') as begin,has_function_privilege($1,'authorize_generation_preparation(text,uuid,uuid,uuid)','execute') as prepare,has_function_privilege($1,'owned_generation_job(uuid,uuid,text)','execute') as helper",[role])).rows[0];
  assert.equal(row.read,role==='service_role');assert.equal(row.write,false);assert.equal(row.begin,role==='service_role');assert.equal(row.prepare,role==='service_role');assert.equal(row.helper,false);
 }
});

test('concurrent project wait safely defers a new job without making generic submission retries possible',async()=>{
 const first=await projectJob(),second=await projectJob('creative'),creation=await beginProject(first);
 assert.equal((await beginProject(second)).state,'waiting');
 await assert.rejects(updateJob(second,'queued',{code:'preflight'}),/known project wait/);
 await assert.rejects(updateJob(second,'queued',{code:'project_wait',providerId:'already-dispatched'}),/known project wait/);
 const deferred=await updateJob(second,'queued',{code:'project_wait'});assert.equal(deferred.state,'queued');assert.equal(deferred.lease_holder,null);assert.equal(deferred.provider_request_id,null);
 assert.equal((await db.query('select art_status from creatives')).rows[0].art_status,'generating');
 await commitProject(first,creation);const resumed=await claimJob(deferred);assert.equal((await beginProject(resumed)).folderId,folderId);
});

test('campaign banners can use the saved campaign as their shared project scope',async()=>{
 const job=await projectJob('creative','workspace-one','account-one',`campaign:${ids.campaign}`);
 const destination=await beginProject(job);assert.equal(destination.state,'claimed');
 assert.equal((await db.query('select scope from higgsfield_generation_projects')).rows[0].scope,`campaign:${ids.campaign}`);
});
