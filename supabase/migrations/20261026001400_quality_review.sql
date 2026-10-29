-- Additive QC rollout. No schedules, pause settings, credentials or provider actions are changed.
insert into public.agents(id,name,role_desc,department_id,is_lead,model) values
('outcomesAnalyst','Experiment & Outcomes Analyst','Evidence-based experiment evaluation, baselines and outcome follow-through','insights',false,'OpenAI GPT, worker tier'),
('funnelCro','Funnel/CRO Specialist','Diagnoses measured conversion gaps and separates missing tracking from drop-off','perf',false,'OpenAI GPT, worker tier'),
('outputQc','Output QC Reviewer','Independent evidence and artifact review of the exact completed version','qa',false,'OpenAI GPT, worker tier')
on conflict(id) do nothing;
-- Upgrade the stock lead label only; preserve any administrator-customized identity/role.
update public.agents set name='QA/QC Lead',role_desc='Acceptance criteria, independent quality review, hallmark and claims rules'
where id='compliance' and name='Compliance Checker' and role_desc='Hallmark and claims rules';
insert into public.agent_instructions(agent_id,instructions,revision) values
('outputQc','Independently review the exact assigned deliverable against its brief, acceptance criteria and permitted evidence. Record pass, needs correction or blocked with concrete findings and checked version. Never approve your own work. Unsupported claims, missing essential inputs and absent image/file artifacts block readiness. A description of a file is not a finished artifact. AI policy advice does not guarantee platform acceptance. Review only the routed artifact; do not seek unrelated departmental or customer records. Keep the responsible head accountable and require human approval before external action.',1),
('funnelCro','Diagnose conversion problems only from recorded compatible funnel events and explicit denominators. State source, time window, freshness, coverage and segment. Separate missing instrumentation from measured drop-off; empty or absent events are unknown, not zero conversions. Current channel summaries and ad clicks alone cannot establish product-view, cart, checkout or payment failure. Never claim an implemented step-level funnel when events are absent. Do not join platform-attributed purchases as unique orders or infer payment/shipping causes from abandonment alone. Return evidence, hypothesis, proposed fix, accountable owner, primary metric, guardrails and evaluation date. Store changes require the E-com Manager and appropriate human approval.',1),
('outcomesAnalyst','Evaluate the exact implemented change against a declared baseline/control, primary metric, guardrails and mature observation window. Distinguish proposed, approved, provider-confirmed execution and measured outcome. Without implementation evidence or sufficient data, report awaiting evidence or inconclusive. Before/after comparisons are observational unless a credible control supports causal interpretation. Platform-attributed ROAS is not profit; costs, returns, measurement overlap, stock and fulfilment capacity must be verified before a scaling recommendation. Do not infer a winning creative or move budget from ROAS rankings. Return supported result, limitations, owner and next review/action; external actions and new tests require explicit human approval. Do not repeat unchanged analysis or invent thresholds.',1)
on conflict(agent_id) do nothing;
-- Retire only generated historical ROAS directives; never delete human-authored instructions/lessons.
update public.lessons set active=false where source in ('results','analytics') and
(lesson like '%Paid back; improve before repeating.%' or lesson like '%Lost money; do not repeat this approach unchanged.%'
 or lesson like '%Worth repeating.%' or lesson like '%Move budget towards the first.%' or lesson like '%Learn from its style.%');

create or replace function public.head_quality_current(h jsonb) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
  select coalesce(h->'quality'->>'reviewerId'='outputQc'
    and h->>'headAgentId'<>'outputQc' and h->'review'->>'decision'='approve'
    and h->'quality'->>'decision'='pass'
    and not exists(select 1 from jsonb_array_elements(coalesce(h->'plan'->'assignments','[]'::jsonb)) a where a->>'agentId'='outputQc')
    and h->'quality'->'artifact'=jsonb_build_object('humanRevision',h->'humanRevision','revisionRound',h->'revisionRound',
      'finalMarkdown',h->'review'->'finalMarkdown','outputs',h->'outputs','plan',h->'plan',
      'evidenceSnapshot',coalesce(h->'evidenceSnapshot','null'::jsonb),'evidence',coalesce(h->'evidence','[]'::jsonb)), false)
$$;
revoke all on function public.head_quality_current(jsonb) from public,anon,authenticated;
create or replace function public.handoff_head_task(p_task_id uuid,p_holder uuid,p_result jsonb)
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
  if not public.head_quality_current(h) or not exists(select 1 from public.agents a where a.id='outputQc' and a.enabled and a.department_id='qa' and a.model not in ('Person','Scheduled job')) then
    raise exception 'The exact deliverable requires a current independent QC pass' using errcode='22023';
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
        jsonb_build_object('kind','head_task','taskId',t.id,'humanRevision',human_revision,'workerAgentIds',to_jsonb(worker_ids),'quality',h->'quality'))
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
    values(t.id,'head_approved',t.owner_agent,'The AI head and independent QC approved the exact specialist work for human review.');
  insert into public.agent_events(kind,from_agent,from_dept,to_dept,text,payload)
    values('report',t.owner_agent,t.department_id,t.department_id,'The AI head forwarded approved specialist work for human review.',
      jsonb_build_object('report_id',report_id,'automation_task_id',t.id));
  return report_id;
end $$;
revoke all on function public.handoff_head_task(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.handoff_head_task(uuid,uuid,jsonb) to service_role;


create or replace function public.guard_head_quality_acceptance() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare h jsonb;
begin
  if new.automation_task_id is not null and new.status='accepted' and old.status is distinct from new.status then
    select state->'headWorkflow' into h from public.automation_tasks where id=new.automation_task_id;
    if not public.head_quality_current(h) or new.body is distinct from h->'review'->>'finalMarkdown'
      or new.data->'quality' is distinct from h->'quality' then
      raise exception 'The reviewed version changed. Independent QC is required before acceptance' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
create trigger head_quality_acceptance before update of status on public.reports for each row execute function public.guard_head_quality_acceptance();
revoke all on function public.guard_head_quality_acceptance() from public,anon,authenticated;

-- Final human approval and publication require the exact saved passing review.
-- Earlier approved campaigns without this evidence must be reviewed again.
create or replace function public.guard_campaign_quality() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q jsonb; assets jsonb;
begin
  if old.status in ('approved','publishing','publish_review','live') and
    (new.name is distinct from old.name or new.budget_daily is distinct from old.budget_daily or new.channels is distinct from old.channels or new.plan is distinct from old.plan) then
    raise exception 'The approved campaign payload is frozen. A new version needs review' using errcode='22023';
  end if;
  if new.status in ('in_approval','approved','publishing') and old.status is distinct from new.status then
    q := new.plan->'quality';
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'headline',headline,'body',body,'image_path',image_path,'art_status',art_status) order by id),'[]'::jsonb)
      into assets from public.creatives where campaign_id=new.id;
    if q->>'version' is distinct from '1' or q->'passed' is distinct from 'true'::jsonb
      or q->>'claims' is distinct from 'clean' or q->>'policy' is distinct from 'ok' or q->'cmoApproved' is distinct from 'true'::jsonb
      or q->'artifact'->'plan' is distinct from (new.plan - array['quality','ai_review'])
      or q->'artifact'->'creatives' is distinct from assets or jsonb_array_length(assets)=0
      or to_jsonb(new.name) is distinct from q->'artifact'->'plan'->'name'
      or to_jsonb(new.budget_daily) is distinct from q->'artifact'->'plan'->'budget_daily'
      or to_jsonb(new.channels) is distinct from q->'artifact'->'plan'->'channels' then
      raise exception 'The exact campaign requires a passing claims, policy and CMO review' using errcode='22023';
    end if;
    if new.status in ('approved','publishing') and 'meta'=any(new.channels) and not exists
      (select 1 from public.creatives where campaign_id=new.id and art_status='ready' and image_path is not null) then
      raise exception 'Meta publication requires a finished image that passed its artifact check' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
create trigger campaign_quality before update of status,name,budget_daily,channels,plan on public.campaigns
for each row execute function public.guard_campaign_quality();
revoke all on function public.guard_campaign_quality() from public,anon,authenticated;

-- Human votes belong to one immutable reviewed version. A fresh AI review or
-- replacement approval must not carry earlier human votes onto changed work.
alter table public.approvals add column quality_snapshot jsonb;
create function public.campaign_approval_current(p_campaign uuid,p_snapshot jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.campaigns; assets jsonb;
begin
  select * into c from public.campaigns where id=p_campaign for share;
  if not found or p_snapshot is null or p_snapshot->'passed' is distinct from 'true'::jsonb
    or p_snapshot is distinct from c.plan->'quality'
    or p_snapshot->'artifact'->'plan' is distinct from (c.plan-array['quality','ai_review'])
    or to_jsonb(c.name) is distinct from p_snapshot->'artifact'->'plan'->'name'
    or to_jsonb(c.budget_daily) is distinct from p_snapshot->'artifact'->'plan'->'budget_daily'
    or to_jsonb(c.channels) is distinct from p_snapshot->'artifact'->'plan'->'channels' then return false; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'headline',headline,'body',body,'image_path',image_path,'art_status',art_status) order by id),'[]'::jsonb)
    into assets from public.creatives where campaign_id=c.id;
  return p_snapshot->'artifact'->'creatives'=assets and jsonb_array_length(assets)>0;
end $$;
create function public.guard_campaign_approval_version() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if TG_OP='INSERT' then
    select plan->'quality' into new.quality_snapshot from public.campaigns where id=new.campaign_id;
    if not public.campaign_approval_current(new.campaign_id,new.quality_snapshot) then
      raise exception 'A human approval requires the exact passing campaign review' using errcode='22023';
    end if;
  else
    if new.campaign_id is distinct from old.campaign_id or new.quality_snapshot is distinct from old.quality_snapshot then
      raise exception 'An approval cannot move to another campaign version' using errcode='22023';
    end if;
    if new.status='approved' and old.status is distinct from new.status and
      not public.campaign_approval_current(new.campaign_id,new.quality_snapshot) then
      raise exception 'This approval is for an old version. Review the current campaign approval' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
create function public.guard_campaign_vote_version() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.approvals;
begin
  select * into a from public.approvals where id=new.approval_id;
  if not public.campaign_approval_current(a.campaign_id,a.quality_snapshot) then
    raise exception 'The campaign changed after this approval was opened. Earlier votes cannot approve the new version' using errcode='22023';
  end if;
  return new;
end $$;
create trigger campaign_approval_version before insert or update on public.approvals for each row execute function public.guard_campaign_approval_version();
create trigger campaign_vote_version before insert or update on public.approval_steps for each row execute function public.guard_campaign_vote_version();
revoke all on function public.campaign_approval_current(uuid,jsonb),public.guard_campaign_approval_version(),public.guard_campaign_vote_version() from public,anon,authenticated;
notify pgrst,'reload schema';
