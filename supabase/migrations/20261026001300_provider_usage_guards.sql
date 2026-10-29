-- Extend the shared admission ledger to all model providers, reserve half for manual
-- work, and cap image attempts separately. Existing office pause/settings are preserved.
alter table public.ai_usage_reservations drop constraint ai_usage_reservations_provider_check;
alter table public.ai_usage_reservations add constraint ai_usage_reservations_provider_check check(provider in ('chatgpt','openai','gemini','jev'));
alter table public.ai_usage_reservations add column scheduled boolean not null default false;
update public.ai_usage_reservations set scheduled=true where feature like 'autopilot:%' or feature in ('opportunities','seo','library','automation:advertising','automation:catalogue');
alter function public.reserve_ai_request(text,text,text,integer,bigint) rename to reserve_ai_request_internal;
create function public.ai_scheduled_budget_snapshot(p_tokens bigint,p_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.ai_usage_settings; dc bigint;wc bigint;dt bigint;wt bigint;
  need bigint; candidate timestamptz; retry_at timestamptz; reason text; blocked boolean:=false;
begin
  select * into strict s from public.ai_usage_settings where id=1;
  select count(*) filter(where scheduled and created_at>p_at-interval '24 hours'),count(*),
    coalesce(sum(accounted_tokens) filter(where scheduled and created_at>p_at-interval '24 hours'),0),coalesce(sum(accounted_tokens),0)
    into dc,wc,dt,wt from public.ai_usage_reservations where scheduled and created_at>p_at-interval '7 days' and created_at<=p_at;
  if s.enabled then
    if p_tokens>floor(s.daily_token_limit * 0.5) or p_tokens>floor(s.weekly_token_limit * 0.5) then
      blocked:=true;reason:='request_exceeds_token_limit';
    else
      if dc+1>floor(s.daily_call_limit * 0.5) then
        blocked:=true;reason:='daily_calls';
        select created_at+interval '24 hours' into candidate from public.ai_usage_reservations
          where scheduled and created_at>p_at-interval '24 hours' and created_at<=p_at order by created_at,id offset (dc-floor(s.daily_call_limit * 0.5)) limit 1;
        retry_at:=greatest(retry_at,candidate);
      end if;
      if wc+1>floor(s.weekly_call_limit * 0.5) then
        blocked:=true;reason:=coalesce(reason,'weekly_calls');
        select created_at+interval '7 days' into candidate from public.ai_usage_reservations
          where scheduled and created_at>p_at-interval '7 days' and created_at<=p_at order by created_at,id offset (wc-floor(s.weekly_call_limit * 0.5)) limit 1;
        retry_at:=greatest(retry_at,candidate);
      end if;
      need:=dt+p_tokens-floor(s.daily_token_limit * 0.5);
      if need>0 then
        blocked:=true;reason:=coalesce(reason,'daily_tokens');
        select min(created_at+interval '24 hours') into candidate from (
          select created_at,sum(accounted_tokens) over(order by created_at,id rows unbounded preceding) as freed
          from public.ai_usage_reservations where scheduled and created_at>p_at-interval '24 hours' and created_at<=p_at
        ) x where freed>=need;
        retry_at:=greatest(retry_at,candidate);
      end if;
      need:=wt+p_tokens-floor(s.weekly_token_limit * 0.5);
      if need>0 then
        blocked:=true;reason:=coalesce(reason,'weekly_tokens');
        select min(created_at+interval '7 days') into candidate from (
          select created_at,sum(accounted_tokens) over(order by created_at,id rows unbounded preceding) as freed
          from public.ai_usage_reservations where scheduled and created_at>p_at-interval '7 days' and created_at<=p_at
        ) x where freed>=need;
        retry_at:=greatest(retry_at,candidate);
      end if;
    end if;
  end if;
  return jsonb_build_object('settings',to_jsonb(s),'daily',jsonb_build_object('calls',dc,'tokens',dt),
    'weekly',jsonb_build_object('calls',wc,'tokens',wt),'blocked',blocked,'blockedReason',reason,'nextAvailableAt',retry_at);
end $$;

create or replace function public.reserve_ai_request_internal(p_provider text,p_feature text,p_agent_id text,p_input_chars integer,p_input_tokens_estimate bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.ai_usage_settings; usage jsonb; token_count bigint; reservation_id uuid; at timestamptz;
begin
  if p_provider is null or p_provider not in ('chatgpt','openai','gemini','jev') or p_feature is null or char_length(p_feature)>100
    or char_length(p_agent_id)>100 or p_input_chars is null or p_input_chars<0 or p_input_chars>1000000
    or p_input_tokens_estimate is null or p_input_tokens_estimate<0 or p_input_tokens_estimate>2000000 then
    raise exception 'Invalid AI budget request' using errcode='22023';
  end if;
  -- Every reservation/settlement takes this lock before inspecting the rolling
  -- ledger. Concurrent requests cannot all spend the same remaining allowance.
  select * into strict s from public.ai_usage_settings where id=1 for update;
  at:=clock_timestamp();
  if p_input_chars>s.max_input_chars then return jsonb_build_object('allowed',false,'reason','input_too_long','retryAt',null,'maxInputChars',s.max_input_chars); end if;
  token_count:=p_input_tokens_estimate+s.max_output_tokens;
  usage:=public.ai_budget_snapshot(token_count,at);
  if (usage->>'blocked')::boolean then return usage||jsonb_build_object('allowed',false,'reason',usage->>'blockedReason','retryAt',usage->'nextAvailableAt');end if;
  insert into public.ai_usage_reservations(provider,feature,agent_id,input_chars,estimated_input_tokens,max_output_tokens,reserved_tokens,accounted_tokens,created_at)
    values(p_provider,p_feature,p_agent_id,p_input_chars,p_input_tokens_estimate,s.max_output_tokens,token_count,token_count,at) returning id into reservation_id;
  return jsonb_build_object('allowed',true,'id',reservation_id,'maxOutputTokens',s.max_output_tokens,'estimatedTokens',token_count);
end $$;


create function public.reserve_ai_request(p_provider text,p_feature text,p_agent_id text,p_input_chars integer,p_input_tokens_estimate bigint,p_scheduled boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.ai_usage_settings; usage jsonb; result jsonb;
begin
  if p_scheduled is null then raise exception 'Invalid work origin' using errcode='22023'; end if;
  select * into strict s from public.ai_usage_settings where id=1 for update;
  if p_scheduled then
    usage:=public.ai_scheduled_budget_snapshot(coalesce(p_input_tokens_estimate,0)+s.max_output_tokens,clock_timestamp());
    if (usage->>'blocked')::boolean then return usage||jsonb_build_object('allowed',false,'reason','scheduled_'||(usage->>'blockedReason'),'retryAt',usage->'nextAvailableAt');end if;
  end if;
  result:=public.reserve_ai_request_internal(p_provider,p_feature,p_agent_id,p_input_chars,p_input_tokens_estimate);
  if (result->>'allowed')::boolean then update public.ai_usage_reservations set scheduled=p_scheduled where id=(result->>'id')::uuid;end if;
  return result;
end $$;
revoke all on function public.reserve_ai_request_internal(text,text,text,integer,bigint),public.ai_scheduled_budget_snapshot(bigint,timestamptz),public.reserve_ai_request(text,text,text,integer,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.reserve_ai_request(text,text,text,integer,bigint,boolean) to service_role;

create table public.ai_image_budget_settings (
 id integer primary key default 1 check(id=1),
 daily_request_limit integer not null default 6 check(daily_request_limit between 1 and 1000),
 weekly_request_limit integer not null default 20 check(weekly_request_limit between 1 and 5000),
 check(weekly_request_limit>=daily_request_limit)
);
insert into public.ai_image_budget_settings(id) values(1);
create table public.ai_image_reservations (
 id uuid primary key default gen_random_uuid(),feature text not null check(char_length(feature)<=100),
 agent_id text check(char_length(agent_id)<=100),created_at timestamptz not null default clock_timestamp()
);
create index ai_image_reservation_window on public.ai_image_reservations(created_at,id);
alter table public.ai_image_budget_settings enable row level security;
alter table public.ai_image_reservations enable row level security;
create policy "admin reads image limits" on public.ai_image_budget_settings for select to authenticated using(auth.uid() is not null and public.is_admin());
create policy "admin reads image reservations" on public.ai_image_reservations for select to authenticated using(auth.uid() is not null and public.is_admin());
revoke all on public.ai_image_budget_settings,public.ai_image_reservations from public,anon,authenticated,service_role;
grant select on public.ai_image_budget_settings,public.ai_image_reservations to authenticated,service_role;
grant update on public.ai_image_budget_settings to service_role;
create function public.get_image_budget_status() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.ai_image_budget_settings;dc bigint;wc bigint;at timestamptz:=clock_timestamp();retry timestamptz;candidate timestamptz;
begin
 select * into strict s from public.ai_image_budget_settings where id=1;
 select count(*) filter(where created_at>at-interval '24 hours'),count(*) into dc,wc from public.ai_image_reservations where created_at>at-interval '7 days' and created_at<=at;
 if dc>=s.daily_request_limit then select created_at+interval '24 hours' into candidate from public.ai_image_reservations where created_at>at-interval '24 hours' and created_at<=at order by created_at,id offset (dc-s.daily_request_limit) limit 1;retry:=greatest(retry,candidate);end if;
 if wc>=s.weekly_request_limit then select created_at+interval '7 days' into candidate from public.ai_image_reservations where created_at>at-interval '7 days' and created_at<=at order by created_at,id offset (wc-s.weekly_request_limit) limit 1;retry:=greatest(retry,candidate);end if;
 return jsonb_build_object('daily',dc,'weekly',wc,'dailyLimit',s.daily_request_limit,'weeklyLimit',s.weekly_request_limit,'blocked',dc>=s.daily_request_limit or wc>=s.weekly_request_limit,'retryAt',retry);
end $$;
create function public.reserve_image_request(p_feature text,p_agent_id text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare usage jsonb;rid uuid;
begin
 if p_feature is null or char_length(p_feature)>100 or char_length(p_agent_id)>100 then raise exception 'Invalid image reservation' using errcode='22023';end if;
 perform 1 from public.ai_image_budget_settings where id=1 for update;
 usage:=public.get_image_budget_status();
 if (usage->>'blocked')::boolean then return usage||jsonb_build_object('allowed',false);end if;
 insert into public.ai_image_reservations(feature,agent_id) values(p_feature,p_agent_id) returning id into rid;
 return usage||jsonb_build_object('allowed',true,'id',rid);
end $$;
revoke all on function public.get_image_budget_status(),public.reserve_image_request(text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_image_budget_status(),public.reserve_image_request(text,text) to service_role;
notify pgrst,'reload schema';
