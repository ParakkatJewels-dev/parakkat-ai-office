-- User-assigned head tasks share the durable queue, then enter the existing human
-- report inbox only after persisted specialist work and an explicit AI-head review.
-- This migration is additive and does not schedule or resume any work.
alter table public.automation_tasks drop constraint automation_tasks_kind_check;
alter table public.automation_tasks add constraint automation_tasks_kind_check
  check (kind in ('briefing','data_quality','campaign','inventory','customer','catalogue','advertising','follow_up','head_task'));

alter table public.reports add column automation_task_id uuid references public.automation_tasks(id);
create unique index reports_automation_task on public.reports(automation_task_id) where automation_task_id is not null;

-- Keep ordinary report visibility unchanged. Linked workflow reports also retain
-- the queue's non-viewer requirement, including after department reassignment.
drop policy "forwarded reports for my departments" on public.reports;
create policy "forwarded reports for my departments" on public.reports for select using (
  (public.is_admin() or (department_id in (select public.my_depts()) and status in ('with_head','accepted','sent_back','rejected')))
  and (automation_task_id is null or (auth.uid() is not null and public.my_role() <> 'viewer'))
);

create function public.handoff_head_task(p_task_id uuid,p_holder uuid,p_result jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  t public.automation_tasks; r public.reports; h jsonb; assignment jsonb; output jsonb;
  worker public.agents; worker_ids text[] := '{}'; actor_role public.app_role;
  report_id uuid; human_revision integer;
begin
  if p_task_id is null or p_holder is null or jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'Invalid head-task handoff' using errcode='22023';
  end if;
  -- Every linked-report mutation uses task -> report lock order.
  select * into t from public.automation_tasks where id=p_task_id for update;
  if not found or t.kind <> 'head_task' then raise exception 'Head task not found' using errcode='22023'; end if;
  h := t.state->'headWorkflow';
  select * into r from public.reports where automation_task_id=t.id for update;
  -- A response lost after commit can be replayed without another report or event.
  if r.id is not null and t.status in ('review','completed')
    and h->>'phase' in ('human_review','completed') and h->>'reportId'=r.id::text
    and r.data->>'humanRevision'=coalesce(h->>'humanRevision','0')
    and r.status in ('with_head','accepted') then return r.id; end if;
  if t.status <> 'running' or t.claimed_by is distinct from p_holder
    or t.lease_until is null or t.lease_until <= now() then
    raise exception 'Head-task ownership changed' using errcode='40001';
  end if;
  if h->>'phase' is distinct from 'handoff' or h->>'headAgentId' is distinct from t.owner_agent
    or h->'review'->>'decision' is distinct from 'approve'
    or char_length(btrim(coalesce(h->'review'->>'note',''))) not between 1 and 6000
    or jsonb_typeof(h->'review'->'finalMarkdown') is distinct from 'string'
    or char_length(btrim(h->'review'->>'finalMarkdown')) not between 1 and 24000
    or p_result->>'markdown' is distinct from h->'review'->>'finalMarkdown'
    or p_result->>'status' is distinct from 'review'
    or char_length(btrim(coalesce(p_result->>'summary',''))) not between 1 and 2000
    or jsonb_typeof(p_result->'evidence') is distinct from 'array'
    or jsonb_typeof(p_result->'warnings') is distinct from 'array'
    or (p_result ? 'actions' and p_result->'actions' <> '[]'::jsonb) then
    raise exception 'Only the saved AI-head-approved output can be handed off' using errcode='22023';
  end if;
  if jsonb_typeof(h->'plan'->'assignments') is distinct from 'array'
    or jsonb_typeof(h->'outputs') is distinct from 'object'
    or jsonb_typeof(t.input->'allowedDepartments') is distinct from 'array' then
    raise exception 'The head task has no valid specialist plan' using errcode='22023';
  end if;
  if jsonb_array_length(h->'plan'->'assignments') not between 1 and 2 then
    raise exception 'A head task requires one or two specialist assignments' using errcode='22023';
  end if;
  select role into actor_role from public.profiles where id=t.created_by;
  if actor_role is null or actor_role='viewer' or not exists (
    select 1 from public.departments d join public.agents a on a.id=d.ai_lead_agent
    where d.id=t.department_id and a.id=t.owner_agent and a.enabled and a.is_lead
      and a.department_id=d.id and d.human_head_role<>'viewer'
      and (t.input->'allowedDepartments' ? d.id)
      and (actor_role='super_admin' or d.human_head_role=actor_role)
  ) then raise exception 'The requester or assigned head is no longer authorized' using errcode='42501'; end if;
  for assignment in select value from jsonb_array_elements(h->'plan'->'assignments') loop
    if char_length(btrim(coalesce(assignment->>'task',''))) = 0
      or char_length(btrim(coalesce(assignment->>'deliverable',''))) = 0
      or assignment->>'agentId'=any(worker_ids) then
      raise exception 'Every specialist must have a unique saved assignment' using errcode='22023';
    end if;
    select * into worker from public.agents where id=assignment->>'agentId';
    if not found or not worker.enabled or worker.id=t.owner_agent or worker.model in ('Person','Scheduled job')
      or not (t.input->'allowedDepartments' ? worker.department_id)
      or not exists (select 1 from public.departments d where d.id=worker.department_id
        and (actor_role='super_admin' or d.human_head_role=actor_role)) then
      raise exception 'A specialist is unavailable or outside the requester department access' using errcode='42501';
    end if;
    output := h->'outputs'->worker.id;
    if jsonb_typeof(output) is distinct from 'object'
      or jsonb_typeof(output->'body') is distinct from 'string'
      or char_length(btrim(output->>'body')) not between 1 and 16000
      or output->'blocked' is distinct from 'false'::jsonb
      or jsonb_typeof(output->'missing') is distinct from 'array' then
      raise exception 'Every specialist must have saved completed work' using errcode='22023';
    end if;
    if jsonb_array_length(output->'missing') <> 0 then
      raise exception 'Specialist work still has missing prerequisites' using errcode='22023';
    end if;
    worker_ids := array_append(worker_ids,worker.id);
  end loop;
  if coalesce(h->>'humanRevision','0') !~ '^[0-9]{1,8}$' then
    raise exception 'Invalid human revision' using errcode='22023';
  end if;
  human_revision := coalesce(h->>'humanRevision','0')::integer;
  if r.id is not null and (r.status <> 'sent_back' or
    coalesce(r.data->>'humanRevision','-1') <> (human_revision-1)::text) then
    raise exception 'The previous human review is not ready for replacement' using errcode='40001';
  end if;
  if r.id is null then
    insert into public.reports(automation_task_id,department_id,author_agent,lead_agent,title,body,status,lead_note,data)
      values(t.id,t.department_id,t.owner_agent,t.owner_agent,t.title,p_result->>'markdown','with_head',left(h->'review'->>'note',6000),
        jsonb_build_object('kind','head_task','taskId',t.id,'humanRevision',human_revision,'workerAgentIds',to_jsonb(worker_ids)))
      returning id into report_id;
  else
    update public.reports set department_id=t.department_id,author_agent=t.owner_agent,lead_agent=t.owner_agent,
      title=t.title,body=p_result->>'markdown',status='with_head',lead_note=left(h->'review'->>'note',6000),
      head_note=null,decided_by=null,revision=revision+1,updated_at=now(),
      data=jsonb_build_object('kind','head_task','taskId',t.id,'humanRevision',human_revision,'workerAgentIds',to_jsonb(worker_ids))
      where id=r.id returning id into report_id;
  end if;
  h := h || jsonb_build_object('phase','human_review','reportId',report_id,'humanRevision',human_revision);
  update public.automation_tasks set status='review',result=p_result,
    state=jsonb_set(state,'{headWorkflow}',h),claimed_by=null,lease_until=null,finished_at=now(),error=null
    where id=t.id;
  insert into public.automation_events(task_id,kind,agent_id,text)
    values(t.id,'head_approved',t.owner_agent,'The AI head approved the specialist work and forwarded it to the human head.');
  insert into public.agent_events(kind,from_agent,from_dept,to_dept,text,payload)
    values('report',t.owner_agent,t.department_id,t.department_id,'The AI head forwarded approved specialist work for human review.',
      jsonb_build_object('report_id',report_id,'automation_task_id',t.id));
  return report_id;
end $$;
revoke all on function public.handoff_head_task(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.handoff_head_task(uuid,uuid,jsonb) to service_role;

-- The existing human inbox remains the only acceptance surface for these tasks.
-- Read the link first, then lock task -> report and recheck the link. Other report
-- types retain their existing decision behavior and feedback/learning triggers.
create or replace function public.decide_report(p_report uuid,p_decision text,p_note text,p_revision integer)
returns public.report_status language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.reports; s public.report_status; t public.automation_tasks; linked_task uuid;
  h jsonb; next_h jsonb; task_status text; me public.app_role := public.my_role();
begin
  select automation_task_id into linked_task from public.reports where id=p_report;
  if linked_task is not null then
    select * into t from public.automation_tasks where id=linked_task for update;
  end if;
  select * into r from public.reports where id=p_report for update;
  if not found or r.status <> 'with_head' then raise exception 'This report is not waiting on a head'; end if;
  if r.automation_task_id is distinct from linked_task then raise exception 'The report changed before the decision' using errcode='40001'; end if;
  if not (public.is_admin() or r.department_id in (select public.my_depts())) then raise exception 'Not your department' using errcode='42501'; end if;
  if p_decision <> 'accept' and coalesce(trim(p_note),'')='' then raise exception 'Add a note so the team lead knows why'; end if;
  s := case p_decision when 'accept' then 'accepted' when 'send_back' then 'sent_back' when 'reject' then 'rejected' end;
  if s is null then raise exception 'Unknown decision %',p_decision; end if;
  if linked_task is not null then
    h := t.state->'headWorkflow';
    if auth.uid() is null or me='viewer' then raise exception 'Not your department' using errcode='42501'; end if;
    if p_revision is null or p_revision<>r.revision then
      raise exception 'This report was revised. Refresh it before deciding' using errcode='40001';
    end if;
    if t.kind is distinct from 'head_task' or t.status is distinct from 'review'
      or t.department_id is distinct from r.department_id
      or h->>'phase' is distinct from 'human_review' or h->>'reportId' is distinct from r.id::text
      or h->>'humanRevision' is distinct from r.data->>'humanRevision' then
      raise exception 'The head task changed before the decision' using errcode='40001';
    end if;
    if char_length(coalesce(p_note,''))>6000 then raise exception 'Keep feedback within 6000 characters' using errcode='22023'; end if;
    if s='sent_back' then
      next_h := jsonb_build_object('version',1,'phase','plan','headAgentId',t.owner_agent,
        'revisionRound',0,'humanRevision',(h->>'humanRevision')::integer+1,
        'humanFeedback',p_note,'reportId',r.id,'previousDelivery',left(r.body,8000));
      task_status := 'queued';
    else
      next_h := h || jsonb_build_object('phase',case s when 'accepted' then 'completed' else 'rejected' end,
        'humanFeedback',p_note,'humanDecision',s::text);
      task_status := case s when 'accepted' then 'completed' else 'cancelled' end;
    end if;
    update public.automation_tasks set status=task_status,state=jsonb_set(state-'blockedReason'-'retryAt','{headWorkflow}',next_h),
      result=case when s='sent_back' then null else jsonb_set(result,'{status}',to_jsonb(task_status)) end,
      next_run_at=now(),claimed_by=null,lease_until=null,error=null,
      finished_at=case when s='sent_back' then null else now() end where id=t.id;
    insert into public.automation_events(task_id,kind,text)
      values(t.id,'human_decision',case s when 'accepted' then 'The human head accepted the work.'
        when 'sent_back' then left('The human head requested changes: '||p_note,6000) else left('The human head rejected the work: '||p_note,6000) end);
  end if;
  update public.reports set status=s,head_note=p_note,decided_by=auth.uid(),updated_at=now() where id=p_report;
  insert into public.agent_events(kind,to_agent,from_dept,to_dept,text,payload)
    values(case when s='accepted' then 'say' else 'feedback' end,r.lead_agent,'lead',r.department_id,
      case when linked_task is null then initcap(replace(p_decision,'_',' '))||': '||r.title||coalesce(' — '||p_note,'')
        else 'The human head '||case s when 'accepted' then 'accepted the approved work.' when 'sent_back' then 'requested changes to the assigned work.' else 'rejected the assigned work.' end end,
      jsonb_build_object('report_id',r.id,'by_role',me));
  return s;
end $$;
revoke all on function public.decide_report(uuid,text,text,integer) from public,anon;
grant execute on function public.decide_report(uuid,text,text,integer) to authenticated;

-- Keep older callers working for ordinary reports, but never approve a linked
-- task without the report revision the human actually read.
create or replace function public.decide_report(p_report uuid,p_decision text,p_note text default null)
returns public.report_status language sql security definer set search_path=pg_catalog,public as $$
  select public.decide_report(p_report,p_decision,p_note,null::integer);
$$;
revoke all on function public.decide_report(uuid,text,text) from public,anon;
grant execute on function public.decide_report(uuid,text,text) to authenticated;

create function public.cancel_head_task(p_task_id uuid,p_revision integer,p_user_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare t public.automation_tasks; r public.reports; actor_role public.app_role;
begin
  if p_task_id is null or p_revision is null or p_user_id is null then raise exception 'Invalid cancellation' using errcode='22023'; end if;
  select * into t from public.automation_tasks where id=p_task_id for update;
  if not found or t.kind <> 'head_task' or t.revision<>p_revision
    or t.status not in ('queued','running','blocked','review','failed') or t.state->>'executionPending' is not null then
    raise exception 'The task changed before cancellation' using errcode='40001';
  end if;
  select role into actor_role from public.profiles where id=p_user_id;
  if actor_role is null or actor_role='viewer' or not exists (
    select 1 from public.departments d where d.id=t.department_id and (actor_role='super_admin' or d.human_head_role=actor_role)
  ) then raise exception 'Not your department' using errcode='42501'; end if;
  select * into r from public.reports where automation_task_id=t.id for update;
  if r.id is not null and r.status='with_head' then
    update public.reports set status='rejected',head_note='The assigned task was cancelled by its human head.',
      decided_by=p_user_id,updated_at=now() where id=r.id;
  end if;
  update public.automation_tasks set status='cancelled',
    state=jsonb_set(state,'{headWorkflow}',coalesce(state->'headWorkflow','{}'::jsonb)||jsonb_build_object('phase','rejected','humanDecision','cancelled')),
    claimed_by=null,lease_until=null,finished_at=now(),error=null where id=t.id;
  insert into public.automation_events(task_id,kind,text) values(t.id,'cancelled','The human head cancelled the assigned task.');
  return t.id;
end $$;
revoke all on function public.cancel_head_task(uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_head_task(uuid,integer,uuid) to service_role;

notify pgrst,'reload schema';
