-- App-owned text-call limits. This ledger is independent of best-effort API billing
-- telemetry. No prompts, API credentials or customer conversations are stored here.
create table public.ai_usage_settings (
  id integer primary key default 1 check(id=1),
  enabled boolean not null default true,
  daily_call_limit integer not null default 40 check(daily_call_limit between 1 and 10000),
  weekly_call_limit integer not null default 200 check(weekly_call_limit between 1 and 50000),
  daily_token_limit bigint not null default 200000 check(daily_token_limit between 1000 and 10000000),
  weekly_token_limit bigint not null default 1000000 check(weekly_token_limit between 1000 and 50000000),
  max_input_chars integer not null default 30000 check(max_input_chars between 1000 and 100000),
  max_output_tokens integer not null default 2400 check(max_output_tokens between 256 and 8000),
  updated_at timestamptz not null default now(),
  check(weekly_call_limit>=daily_call_limit), check(weekly_token_limit>=daily_token_limit)
);
insert into public.ai_usage_settings(id) values(1);
create table public.ai_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('chatgpt','openai','gemini')),
  feature text not null default 'unspecified' check(char_length(feature)<=100),
  agent_id text check(char_length(agent_id)<=100),
  input_chars integer not null check(input_chars>=0),
  estimated_input_tokens bigint not null check(estimated_input_tokens>=0),
  max_output_tokens integer not null check(max_output_tokens between 256 and 8000),
  reserved_tokens bigint not null check(reserved_tokens>=0),
  accounted_tokens bigint not null check(accounted_tokens>=0),
  actual_input_tokens bigint check(actual_input_tokens>=0),
  actual_output_tokens bigint check(actual_output_tokens>=0),
  status text not null default 'reserved' check(status in ('reserved','complete','failed')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index ai_usage_reservations_window on public.ai_usage_reservations(created_at,id);
create table public.ai_response_cache (
  cache_key text primary key check(cache_key~'^[a-f0-9]{64}$'),
  value jsonb not null check(octet_length(value::text)<=262144),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '24 hours')
);
create index ai_response_cache_expiry on public.ai_response_cache(expires_at);
alter table public.ai_usage_settings enable row level security;
alter table public.ai_usage_reservations enable row level security;
alter table public.ai_response_cache enable row level security;
create policy "admin reads text budget" on public.ai_usage_settings for select to authenticated using(auth.uid() is not null and public.is_admin());
create policy "admin reads text usage reservations" on public.ai_usage_reservations for select to authenticated using(auth.uid() is not null and public.is_admin());
revoke all on public.ai_usage_settings,public.ai_usage_reservations,public.ai_response_cache from public,anon,authenticated,service_role;
grant select on public.ai_usage_settings,public.ai_usage_reservations to authenticated;
grant select,update on public.ai_usage_settings to service_role;
grant select on public.ai_usage_reservations,public.ai_response_cache to service_role;
create trigger ai_usage_settings_updated before update on public.ai_usage_settings for each row execute function public.automation_updated_at();

-- Private calculator. Each limit's earliest release time is computed from its
-- actual oldest reservations and cumulative token release, then the latest
-- necessary release wins. Unknown/failed reservations count until they age out.
create function public.ai_budget_snapshot(p_tokens bigint,p_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.ai_usage_settings; dc bigint;wc bigint;dt bigint;wt bigint;
  need bigint; candidate timestamptz; retry_at timestamptz; reason text; blocked boolean:=false;
begin
  select * into strict s from public.ai_usage_settings where id=1;
  select count(*) filter(where created_at>p_at-interval '24 hours'),count(*),
    coalesce(sum(accounted_tokens) filter(where created_at>p_at-interval '24 hours'),0),coalesce(sum(accounted_tokens),0)
    into dc,wc,dt,wt from public.ai_usage_reservations where created_at>p_at-interval '7 days' and created_at<=p_at;
  if s.enabled then
    if p_tokens>s.daily_token_limit or p_tokens>s.weekly_token_limit then
      blocked:=true;reason:='request_exceeds_token_limit';
    else
      if dc+1>s.daily_call_limit then
        blocked:=true;reason:='daily_calls';
        select created_at+interval '24 hours' into candidate from public.ai_usage_reservations
          where created_at>p_at-interval '24 hours' and created_at<=p_at order by created_at,id offset (dc-s.daily_call_limit) limit 1;
        retry_at:=greatest(retry_at,candidate);
      end if;
      if wc+1>s.weekly_call_limit then
        blocked:=true;reason:=coalesce(reason,'weekly_calls');
        select created_at+interval '7 days' into candidate from public.ai_usage_reservations
          where created_at>p_at-interval '7 days' and created_at<=p_at order by created_at,id offset (wc-s.weekly_call_limit) limit 1;
        retry_at:=greatest(retry_at,candidate);
      end if;
      need:=dt+p_tokens-s.daily_token_limit;
      if need>0 then
        blocked:=true;reason:=coalesce(reason,'daily_tokens');
        select min(created_at+interval '24 hours') into candidate from (
          select created_at,sum(accounted_tokens) over(order by created_at,id rows unbounded preceding) as freed
          from public.ai_usage_reservations where created_at>p_at-interval '24 hours' and created_at<=p_at
        ) x where freed>=need;
        retry_at:=greatest(retry_at,candidate);
      end if;
      need:=wt+p_tokens-s.weekly_token_limit;
      if need>0 then
        blocked:=true;reason:=coalesce(reason,'weekly_tokens');
        select min(created_at+interval '7 days') into candidate from (
          select created_at,sum(accounted_tokens) over(order by created_at,id rows unbounded preceding) as freed
          from public.ai_usage_reservations where created_at>p_at-interval '7 days' and created_at<=p_at
        ) x where freed>=need;
        retry_at:=greatest(retry_at,candidate);
      end if;
    end if;
  end if;
  return jsonb_build_object('settings',to_jsonb(s),'daily',jsonb_build_object('calls',dc,'tokens',dt),
    'weekly',jsonb_build_object('calls',wc,'tokens',wt),'blocked',blocked,'blockedReason',reason,'nextAvailableAt',retry_at);
end $$;

create function public.get_ai_budget_status() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare cap integer;
begin
  select max_output_tokens into strict cap from public.ai_usage_settings where id=1;
  return public.ai_budget_snapshot(cap,clock_timestamp());
end $$;

create function public.reserve_ai_request(p_provider text,p_feature text,p_agent_id text,p_input_chars integer,p_input_tokens_estimate bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.ai_usage_settings; usage jsonb; token_count bigint; reservation_id uuid; at timestamptz;
begin
  if p_provider is null or p_provider not in ('chatgpt','openai','gemini') or p_feature is null or char_length(p_feature)>100
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

create function public.settle_ai_request(p_id uuid,p_status text,p_input_tokens bigint default null,p_output_tokens bigint default null)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare changed integer;
begin
  if p_status is null or p_status not in ('complete','failed') or p_input_tokens<0 or p_output_tokens<0
    or p_input_tokens>100000000 or p_output_tokens>100000000 then raise exception 'Invalid AI usage settlement' using errcode='22023';end if;
  perform 1 from public.ai_usage_settings where id=1 for update;
  update public.ai_usage_reservations set status=p_status,settled_at=clock_timestamp(),
    actual_input_tokens=case when p_input_tokens is not null and p_output_tokens is not null then p_input_tokens else null end,
    actual_output_tokens=case when p_input_tokens is not null and p_output_tokens is not null then p_output_tokens else null end,
    accounted_tokens=case when p_input_tokens is not null and p_output_tokens is not null then p_input_tokens+p_output_tokens else reserved_tokens end
    where id=p_id and status='reserved';
  get diagnostics changed=row_count;return changed=1;
end $$;

create function public.store_ai_response_cache(p_key text,p_value jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_key is null or p_key!~'^[a-f0-9]{64}$' or p_value is null or octet_length(p_value::text)>262144 then
    raise exception 'Invalid AI response cache value' using errcode='22023';end if;
  insert into public.ai_response_cache(cache_key,value,created_at,expires_at) values(p_key,p_value,clock_timestamp(),clock_timestamp()+interval '24 hours')
    on conflict(cache_key) do update set value=excluded.value,created_at=excluded.created_at,expires_at=excluded.expires_at;
  delete from public.ai_response_cache where expires_at<=clock_timestamp();
  delete from public.ai_response_cache where cache_key in(select cache_key from public.ai_response_cache order by created_at desc,cache_key offset 1000);
end $$;
revoke all on function public.ai_budget_snapshot(bigint,timestamptz),public.get_ai_budget_status(),public.reserve_ai_request(text,text,text,integer,bigint),
  public.settle_ai_request(uuid,text,bigint,bigint),public.store_ai_response_cache(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_ai_budget_status(),public.reserve_ai_request(text,text,text,integer,bigint),
  public.settle_ai_request(uuid,text,bigint,bigint),public.store_ai_response_cache(text,jsonb) to service_role;
notify pgrst,'reload schema';
