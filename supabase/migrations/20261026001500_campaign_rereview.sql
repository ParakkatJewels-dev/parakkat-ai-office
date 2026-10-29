-- Explicit recovery for pending campaigns created before version-bound QC.
-- Installing this migration queues nothing and never changes a live campaign.
create or replace function public.guard_campaign_vote_version() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.approvals;
begin
  -- A human may decline or request changes even when QC is missing/negative.
  if new.decision='approve' then
    select * into a from public.approvals where id=new.approval_id;
    if not public.campaign_approval_current(a.campaign_id,a.quality_snapshot) then
      raise exception 'The campaign changed after this approval was opened. Earlier votes cannot approve the new version' using errcode='22023';
    end if;
  end if;
  return new;
end $$;

create function public.request_campaign_rereview(p_approval uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.approvals;c public.campaigns;r public.agent_runs;t public.automation_tasks;
  actor uuid:=auth.uid();actor_role public.app_role;holder text:=gen_random_uuid()::text;lock_name text;next_state jsonb;
begin
  select role into actor_role from public.profiles where id=actor for share;
  select * into a from public.approvals where id=p_approval;
  if actor is null or actor_role is null or actor_role='viewer' or a.id is null
    or (actor_role<>'super_admin' and not(actor_role=any(a.required_roles))) then
    raise exception 'This campaign does not need your review' using errcode='42501';
  end if;
  select * into c from public.campaigns where id=a.campaign_id;
  select * into r from public.agent_runs where id=c.run_id;
  if r.id is null or r.kind<>'campaign' then raise exception 'This campaign has no saved review workflow. Create a new campaign for review' using errcode='22023';end if;
  lock_name:='campaign:'||r.id;
  if not public.acquire_job_lock(lock_name,holder,30) then raise exception 'This campaign is already being worked on. Refresh before requesting review' using errcode='40001';end if;
  -- Match cancellation's task -> run order, and decisions' approval -> campaign order.
  if r.automation_task_id is not null then select * into t from public.automation_tasks where id=r.automation_task_id for update;end if;
  perform id from public.approvals where campaign_id=c.id order by id for update;
  select * into a from public.approvals where id=p_approval;
  select * into c from public.campaigns where id=a.campaign_id for update;
  select * into r from public.agent_runs where id=c.run_id for update;
  if a.id is null or (actor_role<>'super_admin' and not(actor_role=any(a.required_roles))) then
    raise exception 'This campaign does not need your review' using errcode='42501';
  end if;
  -- A lost response to this exact queue request can be retried without another job.
  if a.status='changes' and r.state->'qualityReviewRequest'->>'approvalId'=a.id::text
    and r.status='running' and r.stage in('review','approval') then
    perform public.release_job_lock(lock_name,holder);return r.id;
  end if;
  if a.status<>'pending' or c.status<>'in_approval' or r.status not in('waiting','done','failed')
    or r.stage not in('done','review','approval') or coalesce(c.external_ids,'{}'::jsonb)<>'{}'::jsonb then
    raise exception 'Only an unpublished pending campaign can be queued for fresh review' using errcode='22023';
  end if;
  if r.state->>'campaign_id' is distinct from c.id::text or jsonb_typeof(c.plan) is distinct from 'object' then
    raise exception 'The saved campaign review inputs are incomplete' using errcode='22023';
  end if;
  if r.automation_task_id is not null and (t.id is null or t.kind<>'campaign' or t.status='cancelled'
    or (t.status='running' and t.lease_until>now())) then
    raise exception 'The linked campaign task is unavailable or currently being worked on' using errcode='40001';
  end if;
  update public.approvals set status='changes' where campaign_id=c.id and status='pending';
  update public.campaigns set status='changes' where id=c.id;
  next_state:=(r.state-array['quality','review','retry','stageFailures'])||jsonb_build_object(
    'plan',c.plan-array['quality','ai_review'],'qualityReviewRequest',jsonb_build_object('approvalId',a.id,'requestedBy',actor,'requestedAt',now()));
  update public.agent_runs set stage='review',status='running',state=next_state,error=null,finished_at=null where id=r.id;
  if t.id is not null then
    update public.automation_tasks set status='queued',next_run_at=now(),claimed_by=null,lease_until=null,error=null,finished_at=null,result=null,
      state=state-array['blockedReason','retryAt'] where id=t.id;
  end if;
  insert into public.agent_events(run_id,kind,from_agent,from_dept,to_dept,text,payload)
    values(r.id,'feedback','compliance','qa','board','A human requested fresh quality review of the saved campaign. Previous votes remain historical.',jsonb_build_object('campaign_id',c.id,'approval_id',a.id));
  perform public.release_job_lock(lock_name,holder);
  return r.id;
end $$;
revoke all on function public.request_campaign_rereview(uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_campaign_rereview(uuid) to authenticated;

-- Exactly one new approval version per saved passing review, including a retry
-- after the response is lost. Earlier votes stay attached to their old version.
create function public.open_campaign_review(p_run_id uuid,p_plan jsonb,p_note text,p_quality jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.agent_runs;c public.campaigns;t public.automation_tasks;existing public.approvals;
  roles public.app_role[]:=array['creative_head','ecom_manager']::public.app_role[];next_version integer;created uuid;
begin
  select * into r from public.agent_runs where id=p_run_id;
  if r.id is null or r.kind<>'campaign' then raise exception 'Campaign review run not found' using errcode='22023';end if;
  if r.automation_task_id is not null then select * into t from public.automation_tasks where id=r.automation_task_id for update;end if;
  perform id from public.approvals where campaign_id=(r.state->>'campaign_id')::uuid order by id for update;
  select * into c from public.campaigns where id=(r.state->>'campaign_id')::uuid for update;
  select * into r from public.agent_runs where id=p_run_id for update;
  if c.id is null or c.run_id is distinct from r.id or r.status<>'running' or r.stage<>'approval'
    or c.status not in('draft','changes','in_approval') or coalesce(c.external_ids,'{}'::jsonb)<>'{}'::jsonb
    or (r.automation_task_id is not null and(t.id is null or t.status='cancelled')) then
    raise exception 'This campaign cannot open a new approval' using errcode='40001';
  end if;
  if p_plan is distinct from r.state->'plan' or p_quality is distinct from r.state->'quality'
    or p_quality->>'version' is distinct from '1' or p_quality->'passed' is distinct from 'true'::jsonb
    or p_quality->>'claims' is distinct from 'clean' or p_quality->>'policy' is distinct from 'ok'
    or p_quality->'cmoApproved' is distinct from 'true'::jsonb or p_note is distinct from r.state->>'review'
    or char_length(btrim(coalesce(p_note,'')))=0 then
    raise exception 'Only the saved passing campaign review can be handed to humans' using errcode='22023';
  end if;
  update public.campaigns set status='in_approval',plan=p_plan||jsonb_build_object('quality',p_quality,'ai_review',p_note) where id=c.id;
  if not public.campaign_approval_current(c.id,p_quality) then raise exception 'The campaign changed after quality review' using errcode='22023';end if;
  select * into existing from public.approvals where campaign_id=c.id and status='pending' and quality_snapshot=p_quality order by version desc,created_at desc limit 1;
  if existing.id is not null then return existing.id;end if;
  update public.approvals set status='changes' where campaign_id=c.id and status='pending';
  select coalesce(max(version),0)+1 into next_version from public.approvals where campaign_id=c.id;
  if (p_plan->>'budget_daily')::numeric>0 then roles:=array_append(roles,'perf_marketer'::public.app_role);end if;
  insert into public.approvals(campaign_id,version,required_roles) values(c.id,next_version,roles) returning id into created;
  return created;
end $$;
revoke all on function public.open_campaign_review(uuid,jsonb,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.open_campaign_review(uuid,jsonb,text,jsonb) to service_role;
notify pgrst,'reload schema';
