import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

let db;
const sql=file=>readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8');
before(async()=>{
  db=new PGlite();
  await db.exec(`set time zone 'UTC';
    create schema auth;create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function public.is_admin() returns boolean language sql stable as $$select false$$;
    create function public.automation_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
    create table automation_tasks(id text primary key,status text,state jsonb,next_run_at timestamptz);
    create table agent_runs(id text primary key,status text,state jsonb);`);
  for(const file of ['20261026001000_ai_usage_budget.sql','20261026001300_provider_usage_guards.sql'])await db.exec(sql(file));
  // Migrate an already exhausted office, rather than testing empty defaults only.
  await db.exec(`update ai_usage_settings set daily_call_limit=1,weekly_call_limit=2,daily_token_limit=1000,weekly_token_limit=2000;
    insert into ai_usage_reservations(provider,feature,scheduled,input_chars,estimated_input_tokens,max_output_tokens,reserved_tokens,accounted_tokens,status)
      values('chatgpt','existing-work',true,10,10000,2400,12400,12400,'failed');
    insert into ai_image_reservations(feature) select 'existing-image' from generate_series(1,22);
    insert into automation_tasks values
      ('waiting','queued','{"blockedReason":"ai_budget","retryAt":"2099-01-01"}','2099-01-01'),
      ('provider','queued','{"blockedReason":"chatgpt_usage","retryAt":"2099-01-01"}','2099-01-01'),
      ('cancelled','cancelled','{"blockedReason":"ai_budget","retryAt":"2099-01-01"}','2099-01-01'),
      ('input-too-long','blocked','{"blockedReason":"ai_budget","retryAt":null}','2099-01-01'),
      ('unknown','queued','{"blockedReason":"ai_budget","retryAt":"2099-01-01","headWorkflow":{"pendingCall":{"phase":"work"}}}','2099-01-01');
    insert into agent_runs values
      ('waiting','running','{"retry":{"reason":"ai_budget","at":"2099-01-01"},"stageFailures":{"n":1},"checkpoints":{"entries":{"copy":{"status":"complete","value":"saved draft"}}}}'),
      ('provider','running','{"retry":{"reason":"provider","at":"2099-01-01"}}'),
      ('cancelled','cancelled','{"retry":{"reason":"ai_budget","at":"2099-01-01"}}'),
      ('unknown','running','{"retry":{"reason":"ai_budget","at":"2099-01-01"},"checkpoints":{"entries":{"image":{"status":"pending"}}}}');`);
  await db.exec(sql('20261028000100_usage_monitoring.sql'));
});
after(async()=>db.close());
beforeEach(async()=>db.exec(`reset role;update ai_usage_settings set enabled=false,daily_call_limit=1,weekly_call_limit=2,daily_token_limit=1000,weekly_token_limit=2000,max_input_chars=100000,max_output_tokens=8000;
  update ai_image_budget_settings set enabled=false,daily_request_limit=6,weekly_request_limit=20;`));

const textStatus=async()=>(await db.query('select get_ai_budget_status() v')).rows[0].v;
const imageStatus=async()=>(await db.query('select get_image_budget_status() v')).rows[0].v;
const textRequest=async(scheduled=true,chars=100)=>(await db.query("select reserve_ai_request('chatgpt','quality-work',null,$1,12000,$2) v",[chars,scheduled])).rows[0].v;
const imageRequest=async()=>(await db.query("select reserve_image_request('design',null) v")).rows[0].v;

test('migration disables existing and default rolling caps without erasing exhausted ledgers',async()=>{
  const text=await textStatus(),image=await imageStatus();
  assert.equal(text.settings.enabled,false);assert.equal(text.blocked,false);assert.equal(text.nextAvailableAt,null);
  assert.equal(text.settings.max_input_chars,100000);assert.equal(text.settings.max_output_tokens,8000);
  assert.equal(text.daily.calls,1);assert.equal(text.daily.tokens,12400);
  assert.equal(image.enabled,false);assert.equal(image.blocked,false);assert.equal(image.retryAt,null);assert.equal(image.daily,22);
  const defaults=(await db.query("select table_name,column_default from information_schema.columns where table_schema='public' and table_name in ('ai_usage_settings','ai_image_budget_settings') and column_name='enabled' order by table_name")).rows;
  assert.equal(defaults.length,2);assert.ok(defaults.every(row=>row.column_default==='false'));
});

test('manual and scheduled work continue beyond rolling budgets while actual and uncertain usage remain counted',async()=>{
  const before=await textStatus();
  const manual=await textRequest(false),scheduled=await textRequest(true);
  assert.equal(manual.allowed,true);assert.equal(scheduled.allowed,true);
  assert.equal(manual.maxOutputTokens,8000);assert.equal(scheduled.maxOutputTokens,8000);
  await db.query("select settle_ai_request($1,'complete',1500,500)",[manual.id]);
  await db.query("select settle_ai_request($1,'failed',null,null)",[scheduled.id]);
  const after=await textStatus();
  assert.equal(after.daily.calls,before.daily.calls+2);assert.equal(after.daily.tokens,before.daily.tokens+2000+20000);
  assert.equal(after.blocked,false);
  const rows=(await db.query('select scheduled,status from ai_usage_reservations where id in ($1,$2) order by scheduled',[manual.id,scheduled.id])).rows;
  assert.deepEqual(rows,[{scheduled:false,status:'complete'},{scheduled:true,status:'failed'}]);
});

test('image attempts keep atomic accounting above the old daily and weekly caps',async()=>{
  const before=await imageStatus();
  const attempts=await Promise.all(Array.from({length:8},imageRequest));
  assert.ok(attempts.every(row=>row.allowed));assert.equal(new Set(attempts.map(row=>row.id)).size,8);
  const after=await imageStatus();assert.equal(after.daily,before.daily+8);assert.equal(after.weekly,before.weekly+8);
  assert.equal(after.enabled,false);assert.equal(after.blocked,false);assert.equal(after.retryAt,null);
});

test('per-request prompt bounds still reject oversized work before a reservation is added',async()=>{
  const before=await textStatus();
  const denied=await textRequest(false,100001);assert.equal(denied.allowed,false);assert.equal(denied.reason,'input_too_long');
  assert.equal((await textStatus()).daily.calls,before.daily.calls);
  assert.equal((await textRequest(false,60000)).allowed,true,'complete restored context can exceed the former 30K limit');
});

test('only known pre-request rolling deferrals wake while provider waits and uncertain calls stay untouched',async()=>{
  const tasks=(await db.query('select * from automation_tasks')).rows;
  const waking=tasks.find(row=>row.id==='waiting');
  assert.equal(waking.status,'queued');assert.ok(Math.abs(Date.now()-Date.parse(waking.next_run_at))<60000);
  for(const row of tasks.filter(row=>row.id!=='waiting'))assert.equal(new Date(row.next_run_at).toISOString(),'2099-01-01T00:00:00.000Z',row.id);
  const runs=(await db.query('select * from agent_runs')).rows;
  const resumed=runs.find(row=>row.id==='waiting');
  assert.equal(resumed.status,'running');assert.equal(resumed.state.retry,undefined);
  assert.deepEqual(resumed.state.stageFailures,{n:1});assert.equal(resumed.state.checkpoints.entries.copy.value,'saved draft');
  for(const row of runs.filter(row=>row.id!=='waiting'))assert.equal(row.state.retry.at,'2099-01-01',row.id);
});

test('optional caps can be re-enabled against the preserved history',async()=>{
  await db.exec('update ai_usage_settings set enabled=true;update ai_image_budget_settings set enabled=true');
  assert.equal((await textRequest(false)).allowed,false);
  assert.equal((await textRequest(true)).allowed,false);
  const image=await imageStatus();assert.equal(image.enabled,true);assert.equal(image.blocked,true);assert.ok(image.retryAt);
  assert.equal((await imageRequest()).allowed,false);
});

test('monitoring mode keeps browser restrictions and service-only reservation privileges',async()=>{
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    for(const query of ['select get_image_budget_status()',"select reserve_image_request('design',null)",'update ai_image_budget_settings set enabled=true','update ai_usage_settings set enabled=true']){
      await assert.rejects(db.query(query),error=>error.code==='42501');
    }
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await imageRequest()).allowed,true);assert.equal((await textRequest()).allowed,true);
});
