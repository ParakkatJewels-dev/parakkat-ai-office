import { test,before,beforeEach,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
let db;
const code=expected=>error=>error.code===expected;
async function ingest(fields={},role='service_role') {
  const message={account:'111111',id:'provider-message',sender:'333333',at:new Date(Date.now()-10000).toISOString(),body:'Customer-private question',name:'Actual username',conversation:'conversation-id',deleted:false,...fields};
  await db.exec(`set role ${role}`);
  try{return (await db.query('select ingest_instagram_message($1,$2,$3,$4,$5,$6,$7,$8) as result',Object.values(message))).rows[0].result;}
  finally{await db.exec('reset role');}
}
before(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text);alter table storage.objects enable row level security;
    create publication supabase_realtime;create role authenticated nologin;create role anon nologin;create role service_role nologin bypassrls;`);
  await db.exec(read('supabase/migrations/20261024000000_init.sql').replace('create extension if not exists pgcrypto;',''));
  await db.exec(read('supabase/seed.sql'));
  await db.exec('grant usage on schema public,auth to authenticated,anon,service_role;');
  await db.exec(read('supabase/migrations/20261026000700_business_automation.sql'));
  await db.exec(read('supabase/migrations/20261026000800_instagram_inbox.sql'));
});
after(async()=>await db.close());
beforeEach(async()=>await db.exec('truncate automation_tasks,automation_inquiries restart identity cascade'));

test('Instagram import atomically saves inquiry, provider timestamp, private task and a generic progress event',async()=>{
  const result=await ingest();assert.equal(result.created,true);assert.equal(result.deleted,false);
  const inquiry=(await db.query('select * from automation_inquiries')).rows[0],task=(await db.query('select * from automation_tasks')).rows[0];
  assert.equal(inquiry.id,result.inquiryId);assert.equal(inquiry.task_id,result.taskId);assert.equal(inquiry.provider_account_id,'111111');
  assert.equal(inquiry.contact_ref,'333333');assert.equal(inquiry.contact_name,'Actual username');assert.equal(inquiry.consent,false);
  assert.equal(new Date(inquiry.created_at).getTime(),new Date(inquiry.provider_received_at).getTime());
  assert.equal(task.kind,'customer');assert.equal(task.status,'queued');assert.equal(task.owner_agent,'crmLead');assert.equal(task.department_id,'crm');
  assert.deepEqual(task.input,{inquiryId:inquiry.id,channel:'instagram'});assert.doesNotMatch(task.brief,/Customer-private/);
  const event=(await db.query('select * from automation_events')).rows[0];assert.doesNotMatch(event.text,/Customer-private|Actual username|333333/);
  assert.equal((await db.query('select count(*)::int n from agent_events')).rows[0].n,0);
});

test('duplicate webhook and polling delivery retain one inquiry/task and do not overwrite the first message',async()=>{
  const first=await ingest(),second=await ingest({body:'A retry must not replace the saved customer message'});
  assert.equal(second.created,false);assert.equal(first.inquiryId,second.inquiryId);assert.equal(first.taskId,second.taskId);
  assert.equal((await db.query('select count(*)::int n from automation_tasks')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from automation_events')).rows[0].n,1);
  assert.equal((await db.query('select body from automation_inquiries')).rows[0].body,'Customer-private question');
  await assert.rejects(ingest({account:'999999'}),code('22023'));
  await assert.rejects(ingest({sender:'999999'}),code('22023'));
});

test('historical messages stay blocked for manual handling and do not pretend their reply window is new',async()=>{
  const at=new Date(Date.now()-25*3600000).toISOString(),result=await ingest({at});
  const task=(await db.query('select * from automation_tasks where id=$1',[result.taskId])).rows[0];
  assert.equal(task.status,'blocked');assert.match(task.error,/24-hour reply window/);
  assert.equal(new Date(task.due_at).getTime(),Date.parse(at)+24*3600000);
  assert.equal((await db.query('select status from automation_inquiries')).rows[0].status,'review');
});

test('deletion redacts saved source/draft and cancels work; later polling cannot restore it',async()=>{
  const first=await ingest();
  await db.query("update automation_tasks set status='running',claimed_by=gen_random_uuid(),lease_until=now()+interval '1 minute',result=$2 where id=$1",[first.taskId,{summary:'Private derived reply'}]);
  await db.query("update automation_inquiries set reply_text='Private draft' where id=$1",[first.inquiryId]);
  await db.query("insert into automation_events(task_id,kind,text) values($1,'draft','Private event text')",[first.taskId]);
  const deleted=await ingest({deleted:true});assert.equal(deleted.deleted,true);
  const inquiry=(await db.query('select * from automation_inquiries')).rows[0],task=(await db.query('select * from automation_tasks')).rows[0];
  assert.ok(inquiry.provider_deleted_at);assert.equal(inquiry.contact_name,'');assert.equal(inquiry.reply_text,null);assert.equal(inquiry.status,'closed');
  assert.doesNotMatch(inquiry.body,/Customer-private/);assert.equal(task.status,'cancelled');assert.equal(task.claimed_by,null);assert.equal(task.result,null);
  assert.equal((await db.query("select count(*)::int n from automation_events where text like '%Private%'")).rows[0].n,0);
  const replay=await ingest();assert.equal(replay.deleted,true);assert.equal(replay.created,false);
  assert.equal((await db.query('select status from automation_tasks')).rows[0].status,'cancelled');
});

test('a deletion arriving before the message creates only a tombstone and never opens work',async()=>{
  const deleted=await ingest({deleted:true});assert.equal(deleted.created,true);assert.equal(deleted.taskId,null);
  const later=await ingest();assert.equal(later.deleted,true);assert.equal(later.taskId,null);
  assert.equal((await db.query('select count(*)::int n from automation_tasks')).rows[0].n,0);
});

test('database failures roll the entire message/task transaction back so provider retry can recover',async()=>{
  await db.exec("create function test_reject_instagram_task() returns trigger language plpgsql as $$ begin raise exception 'queue unavailable'; end $$;create trigger test_reject_instagram_task before insert on automation_tasks for each row execute function test_reject_instagram_task();");
  try{await assert.rejects(ingest(),/queue unavailable/);}finally{await db.exec('drop trigger test_reject_instagram_task on automation_tasks;drop function test_reject_instagram_task();');}
  assert.equal((await db.query('select count(*)::int n from automation_inquiries')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from automation_events')).rows[0].n,0);
  assert.equal((await ingest()).created,true);
});

test('a conflicting task key cannot attach a customer message to unrelated work',async()=>{
  await db.exec("insert into automation_tasks(kind,department_id,owner_agent,title,source_key) values('campaign','creative','creativeDirector','Unrelated task','instagram:provider-message')");
  await assert.rejects(ingest(),code('22023'));
  assert.equal((await db.query('select count(*)::int n from automation_inquiries')).rows[0].n,0);
});

test('only the service role can ingest and malformed provider fields are rejected',async()=>{
  for(const role of ['authenticated','anon'])await assert.rejects(ingest({},role),code('42501'));
  for(const fields of [{account:'https://evil.test'},{sender:'111111'},{id:null},{body:''},{body:'a'.repeat(6001)},{name:'a'.repeat(201)},{at:new Date(Date.now()+3600000).toISOString()}]){
    await assert.rejects(ingest(fields),code('22023'));
  }
  assert.equal((await db.query('select count(*)::int n from automation_inquiries')).rows[0].n,0);
});
