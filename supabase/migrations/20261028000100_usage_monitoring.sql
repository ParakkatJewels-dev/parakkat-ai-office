-- User-directed accounting mode: remove application-owned rolling text/image
-- stops without clearing usage history, changing credentials or bypassing the
-- providers' own limits. Per-request text size/output bounds still apply.
begin;

alter table public.ai_usage_settings alter column enabled set default false,
  alter column max_input_chars set default 100000,
  alter column max_output_tokens set default 8000;
-- Retain finite, validated per-call ceilings while allowing restored evidence
-- and complete deliverables. Small routing/review requests still ask for less.
update public.ai_usage_settings set enabled=false,max_input_chars=100000,max_output_tokens=8000 where id=1;

alter table public.ai_image_budget_settings add column enabled boolean not null default false;

create or replace function public.get_image_budget_status() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.ai_image_budget_settings;dc bigint;wc bigint;at timestamptz:=clock_timestamp();retry timestamptz;candidate timestamptz;
begin
 select * into strict s from public.ai_image_budget_settings where id=1;
 select count(*) filter(where created_at>at-interval '24 hours'),count(*) into dc,wc
   from public.ai_image_reservations where created_at>at-interval '7 days' and created_at<=at;
 if s.enabled then
   if dc>=s.daily_request_limit then
     select created_at+interval '24 hours' into candidate from public.ai_image_reservations
       where created_at>at-interval '24 hours' and created_at<=at order by created_at,id offset (dc-s.daily_request_limit) limit 1;
     retry:=greatest(retry,candidate);
   end if;
   if wc>=s.weekly_request_limit then
     select created_at+interval '7 days' into candidate from public.ai_image_reservations
       where created_at>at-interval '7 days' and created_at<=at order by created_at,id offset (wc-s.weekly_request_limit) limit 1;
     retry:=greatest(retry,candidate);
   end if;
 end if;
 return jsonb_build_object('enabled',s.enabled,'daily',dc,'weekly',wc,
   'dailyLimit',s.daily_request_limit,'weeklyLimit',s.weekly_request_limit,
   'blocked',s.enabled and (dc>=s.daily_request_limit or wc>=s.weekly_request_limit),'retryAt',retry);
end $$;

-- reserve_image_request continues using this status under its settings-row lock
-- and records every allowed attempt. The old counters and optional caps remain.
revoke all on function public.get_image_budget_status() from public,anon,authenticated,service_role;
grant execute on function public.get_image_budget_status() to service_role;

-- These deferrals explicitly recorded that admission refused the request before
-- inference. Make only those queued/running jobs eligible at their next tick.
-- Failed/blocked tasks, provider-limit waits, cancelled work and uncertain model
-- calls still require their existing recovery path.
update public.automation_tasks set next_run_at=clock_timestamp()
 where status='queued' and state->>'blockedReason'='ai_budget'
   and nullif(state->>'retryAt','') is not null
   and coalesce(state#>'{headWorkflow,pendingCall}','null'::jsonb)='null'::jsonb;

update public.agent_runs set state=state-'retry'
 where status='running' and state#>>'{retry,reason}'='ai_budget'
   and not exists (
     select 1 from jsonb_each(case when jsonb_typeof(state#>'{checkpoints,entries}')='object'
       then state#>'{checkpoints,entries}' else '{}'::jsonb end) entry
     where entry.value->>'status'='pending'
   );

notify pgrst,'reload schema';
commit;
