-- Task-level text usage. IDs and metering only: no prompts, titles or response content.
create table public.task_usage_events (
  id uuid primary key default gen_random_uuid(),
  task_kind text not null check(task_kind in ('campaign','conversation','head_task')),
  task_id uuid not null,
  event_kind text not null check(event_kind in ('provider_attempt','cache_reuse','inflight_reuse','deterministic_reuse','checkpoint_reuse')),
  reservation_id uuid references public.ai_usage_reservations(id) on delete set null,
  provider text check(provider in ('chatgpt','openai','gemini','jev')),
  model text check(char_length(model)<=100),
  agent_id text check(char_length(agent_id)<=100),
  feature text check(char_length(feature)<=100),
  status text not null check(status in ('pending','complete','failed')),
  input_tokens bigint check(input_tokens>=0),
  output_tokens bigint check(output_tokens>=0),
  estimated_tokens bigint not null default 0 check(estimated_tokens>=0),
  created_at timestamptz not null default now(),
  check((input_tokens is null)=(output_tokens is null)),
  check(event_kind='provider_attempt' or (status='complete' and reservation_id is null and provider is null and model is null and input_tokens is null and output_tokens is null and estimated_tokens=0))
);
create index task_usage_events_window on public.task_usage_events(created_at desc,task_kind,task_id);
create index task_usage_events_task on public.task_usage_events(task_kind,task_id,created_at desc);
create unique index task_usage_events_reservation on public.task_usage_events(reservation_id) where event_kind='provider_attempt' and reservation_id is not null;
alter table public.task_usage_events enable row level security;
create policy "admin reads task metering" on public.task_usage_events for select to authenticated using(auth.uid() is not null and public.is_admin());
revoke all on public.task_usage_events from public,anon,authenticated,service_role;
grant select on public.task_usage_events to authenticated;
grant select,insert,update on public.task_usage_events to service_role;

-- Definer access is restricted to a signed-in Super Admin and returns only metering
-- plus status. It never returns private task titles, prompts, participants or output.
create function public.task_usage_report(p_from timestamptz,p_to timestamptz,p_kind text default 'all',p_status text default 'all',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'Super Admin access required' using errcode='42501';end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '93 days'
    or p_kind is null or p_kind not in ('all','campaign','conversation','head_task')
    or p_status is null or p_status not in ('all','completed','active','failed')
    or p_page is null or p_page not between 1 and 10000 or p_page_size is null or p_page_size not in (20,50)
    then raise exception 'Invalid usage report filters' using errcode='22023';end if;
  with events as (
    select e.*,
      coalesce(r.actual_input_tokens,e.input_tokens) as measured_input,
      coalesce(r.actual_output_tokens,e.output_tokens) as measured_output,
      coalesce(r.accounted_tokens,e.estimated_tokens) as conservative_tokens,
      coalesce(nullif(r.status,'reserved'),e.status) as measured_status
    from public.task_usage_events e left join public.ai_usage_reservations r on r.id=e.reservation_id
    where e.created_at>=p_from and e.created_at<p_to and (p_kind='all' or e.task_kind=p_kind)
  ), grouped as (
    select e.task_kind,e.task_id,min(e.created_at) first_at,max(e.created_at) last_at,
      count(*) filter(where event_kind='provider_attempt') calls,
      count(*) filter(where event_kind='provider_attempt' and measured_status='failed') failed_calls,
      count(*) filter(where event_kind='provider_attempt' and measured_status='pending') pending_calls,
      coalesce(sum(measured_input) filter(where event_kind='provider_attempt' and measured_input is not null and measured_output is not null),0) input_tokens,
      coalesce(sum(measured_output) filter(where event_kind='provider_attempt' and measured_input is not null and measured_output is not null),0) output_tokens,
      count(*) filter(where event_kind='provider_attempt' and (measured_input is null or measured_output is null)) unknown_calls,
      coalesce(sum(conservative_tokens) filter(where event_kind='provider_attempt' and (measured_input is null or measured_output is null)),0) estimated_tokens,
      count(*) filter(where event_kind<>'provider_attempt' and e.status='complete') reused,
      count(*) filter(where event_kind='cache_reuse') cache_reused,
      count(*) filter(where event_kind='inflight_reuse') inflight_reused,
      count(*) filter(where event_kind='deterministic_reuse') deterministic_reused,
      count(*) filter(where event_kind='checkpoint_reuse') checkpoint_reused
    from events e group by e.task_kind,e.task_id
  ), task_rows as (
    select g.*,case when g.task_kind='campaign' then case when r.status='done' then 'completed' else r.status end
      when g.task_kind='conversation' then c.status when g.task_kind='head_task' then a.status end as task_status
    from grouped g
    left join public.agent_runs r on g.task_kind='campaign' and r.id=g.task_id
    left join public.agent_tasks c on g.task_kind='conversation' and c.id=g.task_id
    left join public.automation_tasks a on g.task_kind='head_task' and a.kind='head_task' and a.id=g.task_id
  ), filtered as (
    select * from task_rows where p_status='all' or (p_status='completed' and task_status='completed')
      or (p_status='failed' and task_status in ('failed','cancelled'))
      or (p_status='active' and task_status in ('queued','running','waiting','review','blocked'))
  ), bounds as (
    select count(*) total,least(p_page,greatest(1,ceil(count(*)::numeric/p_page_size)::integer)) current_page from filtered
  ), page_rows as (
    select f.* from filtered f order by f.last_at desc,f.task_kind,f.task_id limit p_page_size offset ((select current_page from bounds)-1)*p_page_size
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.last_at desc,p.task_kind,p.task_id) from page_rows p),'[]'::jsonb),
    'total',(select total from bounds),'page',(select current_page from bounds),'pageSize',p_page_size,
    'totals',(select jsonb_build_object('calls',coalesce(sum(calls),0),'failed_calls',coalesce(sum(failed_calls),0),'input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),'unknown_calls',coalesce(sum(unknown_calls),0),'estimated_tokens',coalesce(sum(estimated_tokens),0),'reused',coalesce(sum(reused),0)) from filtered),
    'trackingStartedAt',(select min(created_at) from public.task_usage_events)
  ) into result;
  return result;
end $$;
revoke all on function public.task_usage_report(timestamptz,timestamptz,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.task_usage_report(timestamptz,timestamptz,text,text,integer,integer) to authenticated;
