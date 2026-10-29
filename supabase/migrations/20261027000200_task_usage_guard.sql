-- Defensive authorization guard: NULL must never count as administrator access.
-- CREATE OR REPLACE retains the existing restricted function grants.
create or replace function public.task_usage_report(p_from timestamptz,p_to timestamptz,p_kind text default 'all',p_status text default 'all',p_page integer default 1,p_page_size integer default 20)
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
