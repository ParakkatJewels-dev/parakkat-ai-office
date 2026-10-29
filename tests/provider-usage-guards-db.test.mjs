import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth;create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;
    create function public.is_admin() returns boolean language sql stable as $$select false$$;
    create function public.automation_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;`);
  for(const file of ['20261026001000_ai_usage_budget.sql','20261026001300_provider_usage_guards.sql'])await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
});
after(async()=>db.close());
beforeEach(async()=>db.exec('reset role;truncate ai_usage_reservations,ai_image_reservations;update ai_usage_settings set daily_call_limit=40,weekly_call_limit=200,daily_token_limit=200000,weekly_token_limit=1000000;'));
const reserve=async(scheduled=true,provider='chatgpt')=>(await db.query('select reserve_ai_request($1,$2,null,10,10,$3) v',[provider,'test',scheduled])).rows[0].v;
test('automatic work has half the rolling allowance, manual work retains the rest',async()=>{
  for(let i=0;i<20;i++)assert.equal((await reserve()).allowed,true);
  const blocked=await reserve();assert.equal(blocked.allowed,false);assert.match(blocked.reason,/scheduled_/);
  for(let i=0;i<20;i++)assert.equal((await reserve(false)).allowed,true);
  assert.equal((await reserve(false)).allowed,false);
});
test('direct providers share one budget and failed settlements never refund the call',async()=>{
  await db.exec('update ai_usage_settings set daily_call_limit=2');
  const a=await reserve(false,'gemini');assert.equal(a.allowed,true);
  await db.query("select settle_ai_request($1,'failed',null,null)",[a.id]);
  assert.equal((await reserve(false,'jev')).allowed,true);
  assert.equal((await reserve(false,'chatgpt')).allowed,false);
});
test('image requests have an independent atomic cap, including abandoned attempts',async()=>{
  const rows=await Promise.all(Array.from({length:10},()=>db.query("select reserve_image_request('studio',null) v")));
  assert.equal(rows.filter(r=>r.rows[0].v.allowed).length,6);
  const status=(await db.query('select get_image_budget_status() v')).rows[0].v;
  assert.equal(status.daily,6);assert.equal(status.blocked,true);assert.ok(status.retryAt);
  assert.equal((await reserve(false)).allowed,true);
});
test('weekly scheduled allowance remains bounded when daily windows have elapsed',async()=>{
  await db.exec(`insert into ai_usage_reservations(provider,feature,scheduled,input_chars,estimated_input_tokens,max_output_tokens,reserved_tokens,accounted_tokens,created_at)
    select 'chatgpt','test',true,1,1,256,257,257,now()-interval '2 days' from generate_series(1,100)`);
  const no=await reserve();assert.equal(no.allowed,false);assert.equal(no.reason,'scheduled_weekly_calls');
  assert.equal((await reserve(false)).allowed,true);
});
test('browsers cannot reserve images or bypass scheduled admission through the internal function',async()=>{
  for(const role of ['anon','authenticated','service_role']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select reserve_ai_request_internal('jev','test',null,1,1)"),e=>e.code==='42501');
    if(role!=='service_role')await assert.rejects(db.query("select reserve_image_request('studio',null)"),e=>e.code==='42501');
    await db.exec('reset role');
  }
});
