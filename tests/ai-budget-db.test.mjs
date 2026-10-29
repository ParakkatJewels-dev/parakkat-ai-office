import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;
    create function public.is_admin() returns boolean language sql stable as $$select coalesce(current_setting('test.admin',true),'false')='true'$$;
    create function public.automation_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261026001000_ai_usage_budget.sql',import.meta.url),'utf8'));
});
after(async()=>db.close());
beforeEach(async()=>db.exec(`reset role;truncate ai_usage_reservations,ai_response_cache;update ai_usage_settings set enabled=true,daily_call_limit=40,weekly_call_limit=200,daily_token_limit=200000,weekly_token_limit=1000000,max_input_chars=30000,max_output_tokens=2400;set test.admin='false';set test.uid='';`));
const reserve=async(tokens=100,chars=100)=>(await db.query("select reserve_ai_request('chatgpt','automation:catalogue','catalogLead',$1,$2) v",[chars,tokens])).rows[0].v;
const status=async()=>(await db.query('select get_ai_budget_status() v')).rows[0].v;
const settle=async(id,status='complete',input=null,output=null)=>(await db.query('select settle_ai_request($1,$2,$3,$4) v',[id,status,input,output])).rows[0].v;
const snapshot=async(tokens,at)=>(await db.query('select ai_budget_snapshot($1,$2) v',[tokens,at])).rows[0].v;
async function recorded(at,tokens,status='reserved') {
  return (await db.query(`insert into ai_usage_reservations(provider,input_chars,estimated_input_tokens,max_output_tokens,reserved_tokens,accounted_tokens,status,created_at)
    values('chatgpt',20,$1,256,$1,$1,$2,$3) returning id`,[tokens,status,at])).rows[0].id;
}
test('concurrent queued claims cannot overspend the final allowance',async()=>{
  await db.exec('update ai_usage_settings set daily_call_limit=1');
  const rows=await Promise.all(Array.from({length:8},()=>reserve()));
  assert.equal(rows.filter(r=>r.allowed).length,1);assert.equal((await status()).daily.calls,1);
  const failure=rows.find(r=>!r.allowed),saved=(await db.query('select created_at from ai_usage_reservations')).rows[0];
  assert.equal(new Date(failure.retryAt).getTime(),new Date(saved.created_at).getTime()+86400000);
});
test('failed, incomplete-metadata and abandoned reservations remain counted',async()=>{
  const a=await reserve(),b=await reserve(),c=await reserve();
  assert.equal(await settle(a.id,'failed'),true);assert.equal(await settle(b.id,'complete',10,null),true);
  const value=await status();assert.equal(value.daily.calls,3);assert.equal(value.daily.tokens,7500);
  const uncertain=(await db.query('select * from ai_usage_reservations where id=$1',[c.id])).rows[0];assert.equal(uncertain.status,'reserved');
});
test('known actuals reconcile once while every attempt still counts',async()=>{
  const row=await reserve();assert.equal(await settle(row.id,'complete',100,20),true);assert.equal(await settle(row.id,'failed',0,0),false);
  assert.deepEqual((await status()).daily,{calls:1,tokens:120});
  const failed=await reserve();assert.equal(await settle(failed.id,'failed',25,50),true);assert.deepEqual((await status()).daily,{calls:2,tokens:195});
});
test('rolling windows distinguish 24h from seven days and never reset at midnight',async()=>{
  await recorded('2026-10-18T10:00:00Z',100);await recorded('2026-10-24T10:00:00Z',200);await recorded('2026-10-25T23:59:00Z',300,'failed');
  const value=await snapshot(256,'2026-10-26T00:01:00Z');assert.deepEqual(value.daily,{calls:1,tokens:300});assert.deepEqual(value.weekly,{calls:2,tokens:500});
});
test('retry boundary releases enough oldest reservations for all simultaneous limits',async()=>{
  await db.exec('update ai_usage_settings set max_output_tokens=256,daily_call_limit=2,weekly_call_limit=3,daily_token_limit=1000,weekly_token_limit=1200');
  await recorded('2026-10-20T10:00:00Z',500);await recorded('2026-10-25T10:00:00Z',300);await recorded('2026-10-25T11:00:00Z',400);await recorded('2026-10-25T12:00:00Z',400);
  const value=await snapshot(500,'2026-10-26T09:00:00Z');assert.equal(value.blocked,true);
  assert.equal(new Date(value.nextAvailableAt).toISOString(),'2026-11-01T11:00:00.000Z','weekly tokens must release at least 900 across the oldest three reservations');
  const next=await snapshot(500,value.nextAvailableAt);assert.equal(next.blocked,false);
});
test('token-only release waits for the cumulative necessary amount, not the first row',async()=>{
  await db.exec('update ai_usage_settings set max_output_tokens=256,daily_token_limit=1000');
  await recorded('2026-10-25T10:00:00Z',100);await recorded('2026-10-25T11:00:00Z',700);await recorded('2026-10-25T12:00:00Z',100);
  const value=await snapshot(500,'2026-10-26T09:00:00Z');assert.equal(new Date(value.nextAvailableAt).toISOString(),'2026-10-26T11:00:00.000Z');
});
test('impossible requests return no invented retry time and disabled rolling limits retain prompt caps',async()=>{
  await db.exec('update ai_usage_settings set daily_token_limit=1000,max_output_tokens=256,max_input_chars=1000');
  const denied=await reserve(1000);assert.equal(denied.allowed,false);assert.equal(denied.reason,'request_exceeds_token_limit');assert.equal(denied.retryAt,null);
  await db.exec('update ai_usage_settings set enabled=false');assert.equal((await reserve(1000)).allowed,true);
  const long=await reserve(10,1001);assert.equal(long.allowed,false);assert.equal(long.reason,'input_too_long');assert.equal((await status()).daily.calls,1);
});
test('browser users cannot reserve, settle, write settings, read cache or invoke private calculator',async()=>{
  const row=await reserve();
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    for(const sql of ['select get_ai_budget_status()',"select reserve_ai_request('chatgpt','x',null,1,1)",`select settle_ai_request('${row.id}','failed',0,0)`,"update ai_usage_settings set enabled=false",'select * from ai_response_cache',"select ai_budget_snapshot(1,now())",`select store_ai_response_cache('${'a'.repeat(64)}','{}')`])await assert.rejects(db.query(sql),e=>e.code==='42501');
    await db.exec('reset role');
  }
  await db.exec("set role authenticated;set test.uid='00000000-0000-4000-8000-000000000001'");assert.equal((await db.query('select * from ai_usage_settings')).rows.length,0);
  await db.exec("set test.admin='true'");assert.equal((await db.query('select * from ai_usage_settings')).rows.length,1);
  await db.exec('reset role;set role service_role');assert.equal((await reserve()).allowed,true);assert.equal((await status()).daily.calls,2);
  await assert.rejects(db.query('select ai_budget_snapshot(1,now())'),e=>e.code==='42501');
});
test('private result cache is bounded, expires after 24h and rejects oversized/non-hash entries',async()=>{
  await db.query("insert into ai_response_cache(cache_key,value,expires_at) values($1,'{}',now()-interval '1 second')",['f'.repeat(64)]);
  await db.exec('set role service_role');const key='a'.repeat(64);await db.query('select store_ai_response_cache($1,$2)',[key,{draft:'Approved source facts'}]);
  const rows=(await db.query('select * from ai_response_cache')).rows;assert.equal(rows.length,1);assert.equal(rows[0].cache_key,key);
  assert.ok(Math.abs(new Date(rows[0].expires_at)-new Date(rows[0].created_at)-86400000)<100);
  await assert.rejects(db.query('select store_ai_response_cache($1,$2)',['not-a-hash',{}]),e=>e.code==='22023');
  await assert.rejects(db.query('select store_ai_response_cache($1,$2)',[key,{draft:'x'.repeat(262144)}]),e=>e.code==='22023');
});
