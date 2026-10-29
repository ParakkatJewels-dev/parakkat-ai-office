-- Read-only business monitoring: source work, external execution and business
-- outcomes remain distinct. No schedule is enabled and no provider is called.
create table public.campaign_registry (
 id uuid primary key default gen_random_uuid(),provider text not null check(provider in('meta','google')),
 account_id text not null check(length(account_id) between 1 and 120),campaign_id text not null check(length(campaign_id) between 1 and 160),
 department_id text not null default 'perf' references public.departments(id),name text not null check(length(name) between 1 and 500),
 configured_status text,effective_status text,objective text,daily_budget numeric check(daily_budget>=0),currency text,account_timezone text,
 budget_scope text not null default 'unknown' check(budget_scope in('campaign','shared','adset','unknown')),
 destination_url text,provider_updated_at timestamptz,last_seen_at timestamptz not null default now(),selected boolean not null default true,
 details jsonb not null default '{}',unique(provider,account_id,campaign_id)
);
create table public.campaign_sync_coverage (
 provider text not null check(provider in('meta','google')),account_id text not null,
 selected boolean not null default true,status text not null default 'pending' check(status in('pending','complete','partial','failed','unsupported')),
 complete boolean not null default false,last_attempt_at timestamptz,last_success_at timestamptz,
 observed_count integer not null default 0 check(observed_count>=0),error_code text,safe_message text,
 coverage jsonb not null default '{}',fingerprint text,primary key(provider,account_id)
);
alter table public.ad_insights_daily alter column purchases drop not null,alter column purchases drop default,
 alter column revenue drop not null,alter column revenue drop default;
alter table public.ad_insights_daily add column conversion_definition text not null default 'legacy_unverified',
 add column data_updated_at timestamptz,add column currency text,add column account_timezone text;
-- Provider ad IDs alone are not an account identity. Keep legacy unknown account
-- rows without inventing an account or rewriting their recorded measurements.
alter table public.ad_insights_daily drop constraint ad_insights_daily_pkey;
create unique index ad_insights_daily_identity on public.ad_insights_daily(day,platform,account_id,ad_id) nulls not distinct;

-- Preserve the legacy API shape while separating stable provider identities.
-- Display names can change or collide; unknown conversions remain unknown.
create or replace function public.ad_rollup(p_since date,p_limit int default 15)
 returns table(platform text,campaign_name text,ad_name text,spend numeric,clicks bigint,purchases numeric,revenue numeric)
 language sql stable security invoker set search_path=public as $$
 select a.platform,max(a.campaign_name),max(a.ad_name),sum(a.spend),sum(a.clicks)::bigint,
  case when bool_and(a.conversion_definition='purchase' and a.purchases is not null) then sum(a.purchases) else null end,
  case when bool_and(a.conversion_definition='purchase' and a.revenue is not null) then sum(a.revenue) else null end
 from public.ad_insights_daily a where a.day>=p_since
 group by a.platform,a.account_id,a.campaign_id,a.ad_id,a.currency
 order by sum(a.spend) desc limit least(p_limit,500);
$$;
revoke execute on function public.ad_rollup(date,int) from public,anon;
grant execute on function public.ad_rollup(date,int) to authenticated,service_role;

create table public.outcome_initiatives (
 id uuid primary key default gen_random_uuid(),source_kind text not null check(source_kind in('task','campaign','report','provider_campaign','manual')),
 source_key text not null unique,source_task_id uuid references public.automation_tasks(id),source_campaign_id uuid references public.campaigns(id),
 source_report_id uuid references public.reports(id),registry_id uuid references public.campaign_registry(id),
 department_id text not null references public.departments(id),owner_agent text references public.agents(id),
 title text not null check(char_length(btrim(title)) between 1 and 500),summary text not null default '' check(char_length(summary)<=6000),
 approval_state text not null default 'proposed' check(approval_state in('proposed','producing','needs_correction','qc_passed','awaiting_human','approved','rejected','expired')),
 execution_state text not null default 'not_started' check(execution_state in('not_started','scheduled','attempted','provider_confirmed','uncertain','failed','cancelled')),
 outcome_state text not null default 'awaiting_data' check(outcome_state in('awaiting_data','healthy','underperforming','improving','inconclusive','ready_for_scaling_review','closed')),
 due_at timestamptz,next_review_at timestamptz,metric_config jsonb,baseline jsonb,evidence jsonb not null default '[]',warnings jsonb not null default '[]',
 notes jsonb not null default '[]',qa_review jsonb,source_fingerprint text not null default '',observation jsonb not null default '{}',
 last_observed_at timestamptz,created_by uuid references auth.users(id) on delete set null,
 revision integer not null default 1 check(revision>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index outcome_initiatives_department on public.outcome_initiatives(department_id,updated_at desc);
create index outcome_initiatives_review on public.outcome_initiatives(next_review_at) where outcome_state<>'closed';
create table public.outcome_incidents (
 id uuid primary key default gen_random_uuid(),initiative_id uuid not null references public.outcome_initiatives(id) on delete cascade,
 problem_key text not null check(length(problem_key) between 1 and 160),status text not null default 'open' check(status in('open','resolved')),
 severity text not null check(severity in('info','warning','critical')),title text not null check(length(title) between 1 and 300),detail text not null check(length(detail)<=6000),
 evidence jsonb not null default '[]',fingerprint text not null,first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),resolved_at timestamptz,
 unique(initiative_id,problem_key)
);
create table public.outcome_experiments (
 id uuid primary key default gen_random_uuid(),initiative_id uuid not null references public.outcome_initiatives(id) on delete cascade,
 request_key text not null unique,hypothesis text not null check(length(btrim(hypothesis)) between 1 and 3000),primary_metric text not null check(length(primary_metric) between 1 and 160),
 guardrails jsonb not null default '[]',baseline jsonb,planned_change text not null check(length(btrim(planned_change)) between 1 and 3000),evaluation_at timestamptz not null,
 status text not null default 'planned' check(status in('planned','evaluated','cancelled')),
 verdict text check(verdict in('improved','no_improvement','harmful','inconclusive')),evaluation_summary text check(length(evaluation_summary)<=4000),
 evaluation_evidence jsonb not null default '[]',created_by uuid references auth.users(id) on delete set null,
 revision integer not null default 1 check(revision>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index outcome_experiments_initiative on public.outcome_experiments(initiative_id,evaluation_at);
create function public.outcome_revision() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin new.revision:=old.revision+1;new.updated_at:=now();return new;end $$;
create trigger outcome_revision before update on public.outcome_initiatives for each row execute function public.outcome_revision();
create trigger outcome_experiment_revision before update on public.outcome_experiments for each row execute function public.outcome_revision();
revoke all on function public.outcome_revision() from public,anon,authenticated;

-- Evaluate current ownership and current source visibility, never a cached role.
create function public.can_access_outcome(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and public.my_role()<>'viewer' and exists(
 select 1 from public.outcome_initiatives o join public.departments d on d.id=o.department_id
 where o.id=p_id and (public.is_admin() or d.human_head_role=public.my_role())
 and (o.source_task_id is null or exists(select 1 from public.automation_tasks t where t.id=o.source_task_id and t.department_id=o.department_id))
 and (o.source_report_id is null or exists(select 1 from public.reports r where r.id=o.source_report_id and r.department_id=o.department_id and (public.is_admin() or r.status in('with_head','accepted','sent_back','rejected'))))
 and (o.source_campaign_id is null or public.is_admin() or exists(select 1 from public.approvals a where a.campaign_id=o.source_campaign_id and public.my_role()=any(a.required_roles)))
 );
$$;
revoke all on function public.can_access_outcome(uuid) from public,anon;
grant execute on function public.can_access_outcome(uuid) to authenticated,service_role;
alter table public.campaign_registry enable row level security;
alter table public.campaign_sync_coverage enable row level security;
alter table public.outcome_initiatives enable row level security;
alter table public.outcome_incidents enable row level security;
alter table public.outcome_experiments enable row level security;
create policy "heads read selected campaign registry" on public.campaign_registry for select to authenticated using(auth.uid() is not null and public.my_role()<>'viewer' and exists(select 1 from public.departments d where d.id=department_id and(public.is_admin() or d.human_head_role=public.my_role())));
create policy "performance heads read campaign coverage" on public.campaign_sync_coverage for select to authenticated using(auth.uid() is not null and public.my_role()<>'viewer' and exists(select 1 from public.departments d where d.id='perf' and(public.is_admin() or d.human_head_role=public.my_role())));
create policy "heads read outcome initiatives" on public.outcome_initiatives for select to authenticated using(public.can_access_outcome(id));
create policy "heads read outcome incidents" on public.outcome_incidents for select to authenticated using(public.can_access_outcome(initiative_id));
create policy "heads read outcome experiments" on public.outcome_experiments for select to authenticated using(public.can_access_outcome(initiative_id));
revoke all on public.campaign_registry,public.campaign_sync_coverage,public.outcome_initiatives,public.outcome_incidents,public.outcome_experiments from public,anon,authenticated,service_role;
grant select on public.campaign_registry,public.campaign_sync_coverage,public.outcome_initiatives,public.outcome_incidents,public.outcome_experiments to authenticated;
grant all on public.campaign_registry,public.campaign_sync_coverage,public.outcome_initiatives,public.outcome_incidents,public.outcome_experiments to service_role;

-- One account refresh commits inventory, the complete metric window and coverage
-- together. Partial snapshots never erase old rows or claim complete coverage.
create function public.store_campaign_account_snapshot(p_provider text,p_account_id text,p_campaigns jsonb,p_metrics jsonb,p_coverage jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb;m jsonb;w_from date;w_to date;attempt timestamptz;old_attempt timestamptz;inventory_ok boolean;metrics_ok boolean;chosen boolean;definition text;
begin
 if p_provider not in('meta','google') or p_account_id is null or length(p_account_id) not between 1 and 120
 or jsonb_typeof(p_campaigns) is distinct from 'array' or jsonb_typeof(p_metrics) is distinct from 'array' or jsonb_typeof(p_coverage) is distinct from 'object' then raise exception 'Invalid campaign snapshot' using errcode='22023';end if;
 if jsonb_array_length(p_campaigns)>10000 or jsonb_array_length(p_metrics)>30000 then raise exception 'Campaign snapshot exceeds its bound' using errcode='22023';end if;
 attempt:=coalesce((p_coverage->>'last_attempt_at')::timestamptz,now());
 if attempt>now()+interval '5 minutes' then raise exception 'Invalid snapshot time' using errcode='22023';end if;
 inventory_ok:=coalesce(p_coverage->>'inventory_complete','false')='true';metrics_ok:=coalesce(p_coverage->>'metrics_complete','false')='true';chosen:=coalesce(p_coverage->>'selected','true')='true';
 w_from:=(p_coverage->>'window_from')::date;w_to:=(p_coverage->>'window_to')::date;
 if (metrics_ok or jsonb_array_length(p_metrics)>0) and(w_from is null or w_to is null or w_to<w_from or w_to-w_from>366) then raise exception 'Metric dates require a bounded window' using errcode='22023';end if;
 insert into public.campaign_sync_coverage(provider,account_id) values(p_provider,p_account_id) on conflict do nothing;
 select last_attempt_at into old_attempt from public.campaign_sync_coverage where provider=p_provider and account_id=p_account_id for update;
 if old_attempt is not null and attempt<old_attempt then return jsonb_build_object('saved',false,'reason','stale_snapshot');end if;
 for c in select value from jsonb_array_elements(p_campaigns) loop
  if coalesce(c->>'campaign_id','')='' or coalesce(c->>'name','')='' or (c ? 'account_id' and c->>'account_id'<>p_account_id) or (c ? 'provider' and c->>'provider'<>p_provider) then raise exception 'Campaign identity mismatch' using errcode='22023';end if;
  insert into public.campaign_registry(provider,account_id,campaign_id,name,configured_status,effective_status,objective,daily_budget,currency,account_timezone,budget_scope,destination_url,provider_updated_at,last_seen_at,selected,details)
  values(p_provider,p_account_id,c->>'campaign_id',left(c->>'name',500),c->>'configured_status',c->>'effective_status',c->>'objective',(c->>'daily_budget')::numeric,c->>'currency',c->>'account_timezone',coalesce(c->>'budget_scope','unknown'),c->>'destination_url',(c->>'provider_updated_at')::timestamptz,attempt,chosen,coalesce(c->'details','{}'))
  on conflict(provider,account_id,campaign_id) do update set name=excluded.name,configured_status=excluded.configured_status,effective_status=excluded.effective_status,objective=excluded.objective,daily_budget=excluded.daily_budget,currency=excluded.currency,account_timezone=excluded.account_timezone,budget_scope=excluded.budget_scope,destination_url=excluded.destination_url,provider_updated_at=excluded.provider_updated_at,last_seen_at=excluded.last_seen_at,selected=excluded.selected,details=excluded.details;
 end loop;
 if inventory_ok or not chosen then update public.campaign_registry set selected=false where provider=p_provider and account_id=p_account_id and (not chosen or campaign_id not in(select value->>'campaign_id' from jsonb_array_elements(p_campaigns)));end if;
 if metrics_ok then delete from public.ad_insights_daily where platform=p_provider and account_id=p_account_id and day between w_from and w_to;end if;
 for m in select value from jsonb_array_elements(p_metrics) loop
  definition:=coalesce(m->>'conversion_definition',p_coverage->>'conversion_definition','unknown');
  if coalesce(m->>'ad_id','')='' or coalesce(m->>'campaign_id','')='' or (m->>'day')::date not between w_from and w_to
   or(m ? 'account_id' and m->>'account_id'<>p_account_id) or(m ? 'platform' and m->>'platform'<>p_provider)
   or definition not in('purchase','unknown','legacy_unverified') then raise exception 'Metric identity or definition mismatch' using errcode='22023';end if;
  insert into public.ad_insights_daily(day,platform,account_id,campaign_id,campaign_name,ad_id,ad_name,spend,impressions,clicks,purchases,revenue,conversion_definition,data_updated_at,currency,account_timezone)
  values((m->>'day')::date,p_provider,p_account_id,m->>'campaign_id',m->>'campaign_name',m->>'ad_id',m->>'ad_name',(m->>'spend')::numeric,(m->>'impressions')::bigint,(m->>'clicks')::bigint,
   case when definition='purchase' then(m->>'purchases')::numeric else null end,case when definition='purchase' then(m->>'revenue')::numeric else null end,definition,attempt,m->>'currency',m->>'account_timezone')
  on conflict(day,platform,account_id,ad_id) do update set campaign_id=excluded.campaign_id,campaign_name=excluded.campaign_name,ad_name=excluded.ad_name,spend=excluded.spend,impressions=excluded.impressions,clicks=excluded.clicks,purchases=excluded.purchases,revenue=excluded.revenue,conversion_definition=excluded.conversion_definition,data_updated_at=excluded.data_updated_at,currency=excluded.currency,account_timezone=excluded.account_timezone;
 end loop;
 update public.campaign_sync_coverage set selected=chosen,status=coalesce(p_coverage->>'status',case when inventory_ok and metrics_ok then 'complete' else 'partial' end),complete=inventory_ok and metrics_ok and coalesce(p_coverage->>'status','complete')='complete' and coalesce(p_coverage->>'complete','true')='true',
 last_attempt_at=attempt,last_success_at=case when inventory_ok and metrics_ok then attempt else last_success_at end,observed_count=jsonb_array_length(p_campaigns),error_code=left(p_coverage->>'error_code',100),safe_message=left(p_coverage->>'safe_message',1000),
 coverage=coalesce(p_coverage->'coverage','{}')||jsonb_build_object('window_from',w_from,'window_to',w_to,'inventory_complete',inventory_ok,'metrics_complete',metrics_ok,'conversion_definition',coalesce(p_coverage->>'conversion_definition','unknown')),
 fingerprint=coalesce(p_coverage->>'fingerprint',md5((p_campaigns||p_metrics)::text)) where provider=p_provider and account_id=p_account_id;
 return jsonb_build_object('saved',true,'campaigns',jsonb_array_length(p_campaigns),'metricRows',jsonb_array_length(p_metrics),'complete',inventory_ok and metrics_ok);
end $$;
revoke all on function public.store_campaign_account_snapshot(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.store_campaign_account_snapshot(text,text,jsonb,jsonb,jsonb) to service_role;

-- Private continuation markers bound each deterministic sweep without starving
-- sources after the cap. Browser readers receive only the completeness flag.
create table public.outcome_scan_state (
 singleton boolean primary key default true check(singleton),materialize_cursors jsonb not null default '{}',
 materialize_limited boolean not null default false,monitor_after uuid,monitor_limited boolean not null default false,last_attempt_at timestamptz,last_refreshed_at timestamptz
);
insert into public.outcome_scan_state(singleton) values(true);
alter table public.outcome_scan_state enable row level security;
revoke all on public.outcome_scan_state from public,anon,authenticated,service_role;
grant all on public.outcome_scan_state to service_role;
create function public.read_outcome_monitoring_status() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('limited',materialize_limited or monitor_limited,'last_refreshed_at',last_refreshed_at)
 from public.outcome_scan_state where auth.uid() is not null and public.my_role()<>'viewer';
$$;
revoke all on function public.read_outcome_monitoring_status() from public,anon;
grant execute on function public.read_outcome_monitoring_status() to authenticated,service_role;

-- Materialization keeps source status separate from execution. Accepted reports
-- and completed drafts never become provider-confirmed actions or business wins.
create function public.materialize_outcome_sources() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare t record;r record;c record;h jsonb;q jsonb;fingerprint text;n integer:=0;approval text;execution text;quality_current boolean;cursors jsonb;after_id uuid;last_id uuid;kind_n integer;more boolean;limited boolean:=false;counts jsonb:='{}';
begin
 select materialize_cursors into cursors from public.outcome_scan_state where singleton for update;
 after_id:=(cursors->>'task')::uuid;last_id:=null;kind_n:=0;
 for t in select * from public.automation_tasks where after_id is null or id>after_id order by id limit 5000 loop
  h:=t.state->'headWorkflow';q:=h->'quality';quality_current:=coalesce(q->>'reviewerId'='outputQc' and h->>'headAgentId'<>'outputQc' and h->'review'->>'decision'='approve'
   and not exists(select 1 from jsonb_array_elements(coalesce(h->'plan'->'assignments','[]')) x where x->>'agentId'='outputQc')
   and q->'artifact'=jsonb_build_object('humanRevision',q->'artifact'->'humanRevision','revisionRound',q->'artifact'->'revisionRound','finalMarkdown',coalesce(h->'review'->>'finalMarkdown',''),'outputs',h->'outputs','plan',h->'plan','evidenceSnapshot',coalesce(h->'evidenceSnapshot','null'::jsonb),'evidence',coalesce(h->'evidence','[]'::jsonb)),false);
  approval:=case when t.status='cancelled' then 'rejected' when t.status='completed' then 'approved' when t.status='review' then 'awaiting_human' when t.status in('blocked','failed') then 'needs_correction' when quality_current and q->>'decision'='pass' then 'qc_passed' when t.status='running' then 'producing' else 'proposed' end;
  execution:=case when t.status='cancelled' then 'cancelled' when t.state->>'executionPending' is not null then case when exists(select 1 from public.automation_actions a where a.task_id=t.id and a.status='executing') then 'attempted' else 'uncertain' end else 'not_started' end;
  if t.state->>'executionPending' is null and exists(select 1 from public.automation_actions a where a.task_id=t.id and a.status='completed' and((a.kind='instagram_reply' and coalesce(a.result->>'messageId','')<>'') or(a.kind='catalogue_copy' and a.result->'after'->>'id'='gid://shopify/Product/'||(a.payload->>'productId')))) then execution:='provider_confirmed';end if;
  q:=case when q is null then null else jsonb_build_object('reviewerId',q->>'reviewerId','decision',q->>'decision','note',q->>'note','findings',coalesce(q->'findings','[]'),'checkedAt',q->>'checkedAt','humanRevision',q->'artifact'->'humanRevision','revisionRound',q->'artifact'->'revisionRound','artifactFingerprint',md5(coalesce((q->'artifact')::text,'')),'current',quality_current) end;
  fingerprint:=md5(jsonb_build_array(t.title,t.owner_agent,t.department_id,t.status,t.due_at,approval,execution,q)::text);
  insert into public.outcome_initiatives(source_kind,source_key,source_task_id,department_id,owner_agent,title,summary,approval_state,execution_state,due_at,source_fingerprint,qa_review,warnings)
   values('task','task:'||t.id,t.id,t.department_id,t.owner_agent,t.title,case when execution='provider_confirmed' then 'At least one linked provider action has a confirmed receipt. Review individual actions; this does not confirm every proposal was executed.' else 'Linked workflow status; acceptance does not establish external execution or a business result.' end,approval,execution,t.due_at,fingerprint,q,'["Business impact has not been measured. Review the linked source for its actual deliverable."]')
  on conflict(source_key) do update set title=excluded.title,summary=excluded.summary,department_id=excluded.department_id,approval_state=excluded.approval_state,execution_state=excluded.execution_state,qa_review=excluded.qa_review,source_fingerprint=excluded.source_fingerprint
   where outcome_initiatives.source_fingerprint<>excluded.source_fingerprint;
  n:=n+1;kind_n:=kind_n+1;last_id:=t.id;
 end loop;
 more:=exists(select 1 from public.automation_tasks where id>last_id);limited:=limited or more;
 cursors:=jsonb_set(cursors,'{task}',case when more then to_jsonb(last_id) else 'null'::jsonb end);counts:=counts||jsonb_build_object('task',kind_n);
 after_id:=(cursors->>'report')::uuid;last_id:=null;kind_n:=0;
 for r in select * from public.reports where automation_task_id is null and (after_id is null or id>after_id) order by id limit 5000 loop
  approval:=case when r.status='accepted' then 'approved' when r.status in('rejected','rejected_by_lead') then 'rejected' when r.status='with_head' then 'awaiting_human' when r.status in('sent_back','revise') then 'needs_correction' else 'producing' end;
  fingerprint:=md5(jsonb_build_array(r.title,r.department_id,r.author_agent,r.status,r.revision)::text);
  insert into public.outcome_initiatives(source_kind,source_key,source_report_id,department_id,owner_agent,title,summary,approval_state,source_fingerprint,warnings)
   values('report','report:'||r.id,r.id,r.department_id,coalesce(r.lead_agent,r.author_agent),r.title,'Linked report; acceptance confirms a review decision only.',approval,fingerprint,'["No external execution or business result is implied by report acceptance."]')
  on conflict(source_key) do update set title=excluded.title,approval_state=excluded.approval_state,source_fingerprint=excluded.source_fingerprint where outcome_initiatives.source_fingerprint<>excluded.source_fingerprint;
  n:=n+1;kind_n:=kind_n+1;last_id:=r.id;
 end loop;
 more:=exists(select 1 from public.reports where id>last_id and automation_task_id is null);limited:=limited or more;
 cursors:=jsonb_set(cursors,'{report}',case when more then to_jsonb(last_id) else 'null'::jsonb end);counts:=counts||jsonb_build_object('report',kind_n);
 after_id:=(cursors->>'campaign')::uuid;last_id:=null;kind_n:=0;
 for c in select * from public.campaigns where after_id is null or id>after_id order by id limit 5000 loop
  approval:=case when c.status in('approved','publishing','publish_review','live') then 'approved' when c.status='rejected' then 'rejected' when c.status='changes' then 'needs_correction' when c.status='in_approval' then 'awaiting_human' else 'proposed' end;
  execution:=case when c.external_ids->'_publish'->>'status'='provider_completed' and coalesce(c.external_ids->'meta'->>'campaign_id','')<>'' and coalesce(c.external_ids->'meta'->>'adset_id','')<>'' and coalesce(c.external_ids->'meta'->>'ad_id','')<>'' and coalesce(c.external_ids->'_publish'->>'approval_id','')<>'' then 'provider_confirmed' when c.status='publish_review' then 'uncertain' when c.status='publishing' then 'attempted' else 'not_started' end;
  fingerprint:=md5(jsonb_build_array(c.name,c.status,c.external_ids,approval,execution)::text);
  insert into public.outcome_initiatives(source_kind,source_key,source_campaign_id,department_id,owner_agent,title,summary,approval_state,execution_state,source_fingerprint,warnings)
   values('campaign','campaign:'||c.id,c.id,'perf','perfLead',c.name,'AI Office campaign; provider confirmation does not establish ad delivery or profitability.',approval,execution,fingerprint,'["Delivery, measurement coverage and business results require separate evidence."]')
  on conflict(source_key) do update set title=excluded.title,approval_state=excluded.approval_state,execution_state=excluded.execution_state,source_fingerprint=excluded.source_fingerprint where outcome_initiatives.source_fingerprint<>excluded.source_fingerprint;
  n:=n+1;kind_n:=kind_n+1;last_id:=c.id;
 end loop;
 more:=exists(select 1 from public.campaigns where id>last_id);limited:=limited or more;
 cursors:=jsonb_set(cursors,'{campaign}',case when more then to_jsonb(last_id) else 'null'::jsonb end);counts:=counts||jsonb_build_object('campaign',kind_n);
 after_id:=(cursors->>'registry')::uuid;last_id:=null;kind_n:=0;
 for c in select * from public.campaign_registry where after_id is null or id>after_id order by id limit 5000 loop
  fingerprint:=md5(jsonb_build_array(c.provider,c.account_id,c.campaign_id,c.name,c.selected,c.configured_status,c.effective_status,c.objective,c.daily_budget,c.currency,c.account_timezone,c.budget_scope,c.details)::text);
  insert into public.outcome_initiatives(source_kind,source_key,registry_id,department_id,owner_agent,title,summary,source_fingerprint,warnings)
   values('provider_campaign','registry:'||c.id,c.id,c.department_id,'perfLead',c.name,'Existing provider campaign in observation mode. No change or spending authority has been granted.',fingerprint,'["Provider inventory is an observation, not an AI Office approval. Configure metric definitions and evidence requirements before recommendations."]')
  on conflict(source_key) do update set title=excluded.title,source_fingerprint=excluded.source_fingerprint where outcome_initiatives.source_fingerprint<>excluded.source_fingerprint;
  n:=n+1;kind_n:=kind_n+1;last_id:=c.id;
 end loop;
 more:=exists(select 1 from public.campaign_registry where id>last_id);limited:=limited or more;
 cursors:=jsonb_set(cursors,'{registry}',case when more then to_jsonb(last_id) else 'null'::jsonb end);counts:=counts||jsonb_build_object('registry',kind_n);
 update public.outcome_scan_state set materialize_cursors=cursors,materialize_limited=limited where singleton;
 return jsonb_build_object('processed',n,'counts',counts,'limited',limited);
end $$;
revoke all on function public.materialize_outcome_sources() from public,anon,authenticated,service_role;
grant execute on function public.materialize_outcome_sources() to service_role;

create function public.valid_outcome_metric(p jsonb) returns boolean language sql immutable set search_path=pg_catalog,public as $$
 select jsonb_typeof(p)='object' and p->>'metric' in('spend','impressions','clicks','purchases','revenue','ctr','cpc','cpa','roas')
 and p->>'direction' in('higher','lower') and p->>'sampleMetric' in('impressions','clicks','purchases')
 and jsonb_typeof(p->'windowDays')='number' and (p->>'windowDays')::numeric between 1 and 90 and (p->>'windowDays')::numeric=trunc((p->>'windowDays')::numeric)
 and jsonb_typeof(p->'maturityHours')='number' and (p->>'maturityHours')::numeric between 0 and 720
 and jsonb_typeof(p->'maxDataAgeHours')='number' and (p->>'maxDataAgeHours')::numeric between 1 and 720
 and (p->'target'='null'::jsonb or(jsonb_typeof(p->'target')='number' and (p->>'target')::numeric>=0))
 and (p->'minSample'='null'::jsonb or(jsonb_typeof(p->'minSample')='number' and (p->>'minSample')::numeric>=1 and (p->>'minSample')::numeric=trunc((p->>'minSample')::numeric)));
$$;
create function public.valid_outcome_baseline(p jsonb) returns boolean language sql immutable set search_path=pg_catalog,public as $$
 select p='null'::jsonb or(jsonb_typeof(p)='object' and(p->'value'='null'::jsonb or(jsonb_typeof(p->'value')='number' and(p->>'value')::numeric>=0)) and char_length(coalesce(p->>'source',''))<=500);
$$;
revoke all on function public.valid_outcome_metric(jsonb),public.valid_outcome_baseline(jsonb) from public,anon,authenticated;

-- Records plans, observations and responsibility only. There is intentionally no
-- mutation that approves a source report, executes an ad change or asserts delivery.
create function public.mutate_outcome(p_action text,p_id uuid,p_revision integer,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.outcome_initiatives;e public.outcome_experiments;key text;created uuid;actor public.app_role:=public.my_role();parent uuid;txt text;item jsonb;
begin
 if auth.uid() is null or actor='viewer' then raise exception 'Outcome access denied' using errcode='42501';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>40000 then raise exception 'Invalid outcome change' using errcode='22023';end if;
 if p_action='create_manual' then
  if coalesce(p_payload->>'requestId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Invalid request identifier' using errcode='22023';end if;
  if not exists(select 1 from public.departments d where d.id=p_payload->>'departmentId' and(actor='super_admin' or d.human_head_role=actor)) then raise exception 'Outcome access denied' using errcode='42501';end if;
  if not exists(select 1 from public.agents a where a.id=p_payload->>'ownerAgent' and a.department_id=p_payload->>'departmentId' and a.enabled) then raise exception 'Choose an enabled department owner' using errcode='22023';end if;
  key:='manual:'||auth.uid()||':'||(p_payload->>'requestId');
  insert into public.outcome_initiatives(source_kind,source_key,department_id,owner_agent,title,summary,due_at,next_review_at,created_by)
   values('manual',key,p_payload->>'departmentId',p_payload->>'ownerAgent',btrim(p_payload->>'title'),coalesce(p_payload->>'summary',''),(p_payload->>'dueAt')::timestamptz,(p_payload->>'nextReviewAt')::timestamptz,auth.uid()) on conflict(source_key) do nothing returning id into created;
  if created is null then select * into o from public.outcome_initiatives where source_key=key;
   if o.created_by is distinct from auth.uid() or o.title is distinct from btrim(p_payload->>'title') or o.department_id is distinct from p_payload->>'departmentId' or o.owner_agent is distinct from p_payload->>'ownerAgent' or o.summary is distinct from coalesce(p_payload->>'summary','') or o.due_at is distinct from (p_payload->>'dueAt')::timestamptz or o.next_review_at is distinct from (p_payload->>'nextReviewAt')::timestamptz then raise exception 'Request identifier reused for different work' using errcode='40001';end if;created:=o.id;
  end if;return created;
 end if;
 if p_action='experiment_evaluate' then
  select initiative_id into parent from public.outcome_experiments where id=p_id;
  select * into o from public.outcome_initiatives where id=parent for update;
  if not public.can_access_outcome(parent) then raise exception 'Outcome access denied' using errcode='42501';end if;
  select * into e from public.outcome_experiments where id=p_id for update;
  if e.id is null or e.revision is distinct from p_revision or e.status='cancelled' then raise exception 'Experiment changed; refresh before saving' using errcode='40001';end if;
  if coalesce(p_payload->>'verdict','') not in('improved','no_improvement','harmful','inconclusive') or char_length(btrim(coalesce(p_payload->>'summary',''))) not between 1 and 4000 or jsonb_typeof(p_payload->'evidence') is distinct from 'array' then raise exception 'Add a valid evaluation and evidence' using errcode='22023';end if;
  if jsonb_array_length(p_payload->'evidence')>12 then raise exception 'Add up to twelve evidence references' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(p_payload->'evidence') loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'source') is distinct from 'string' or jsonb_typeof(item->'detail') is distinct from 'string'
    or char_length(btrim(coalesce(item->>'source',''))) not between 1 and 200 or char_length(btrim(coalesce(item->>'detail',''))) not between 1 and 1500
    or(item ? 'at' and item->'at'<>'null'::jsonb and (jsonb_typeof(item->'at') is distinct from 'string' or char_length(item->>'at')>100)) then raise exception 'Invalid evaluation evidence' using errcode='22023';end if;
   if item ? 'at' and item->'at'<>'null'::jsonb then perform (item->>'at')::timestamptz;end if;
  end loop;
  if p_payload->>'verdict'<>'inconclusive' and(e.evaluation_at>now() or jsonb_array_length(p_payload->'evidence')=0) then raise exception 'Wait for the evaluation window and supply evidence' using errcode='22023';end if;
  update public.outcome_experiments set status='evaluated',verdict=p_payload->>'verdict',evaluation_summary=p_payload->>'summary',evaluation_evidence=p_payload->'evidence' where id=e.id;
  update public.outcome_initiatives set observation=jsonb_set(observation,'{manualEvaluation}',jsonb_build_object('experimentId',e.id,'verdict',p_payload->>'verdict','at',now(),'source','human_recorded')),outcome_state=case p_payload->>'verdict' when 'improved' then 'improving' when 'harmful' then 'underperforming' else 'inconclusive' end,
   notes=coalesce((select jsonb_agg(x.value order by x.ordinality) from jsonb_array_elements(notes||jsonb_build_array(jsonb_build_object('text','Manual experiment evaluation: '||(p_payload->>'verdict'),'at',now(),'by',auth.uid()))) with ordinality x where x.ordinality>greatest(jsonb_array_length(notes)+1-20,0)),'[]') where id=o.id;
  return e.id;
 end if;
 select * into o from public.outcome_initiatives where id=p_id for update;
 if not public.can_access_outcome(p_id) then raise exception 'Outcome access denied' using errcode='42501';end if;
 if o.id is null or o.revision is distinct from p_revision then raise exception 'Outcome changed; refresh before saving' using errcode='40001';end if;
 if p_action='configure' then
  if p_payload ? 'ownerAgent' and not exists(select 1 from public.agents a where a.id=p_payload->>'ownerAgent' and a.enabled and a.department_id=o.department_id) then raise exception 'Choose an enabled department owner' using errcode='22023';end if;
  if p_payload ? 'metricConfig' and p_payload->'metricConfig'<>'null'::jsonb and public.valid_outcome_metric(p_payload->'metricConfig') is not true then raise exception 'Invalid metric safeguards' using errcode='22023';end if;
  if p_payload ? 'baseline' and public.valid_outcome_baseline(p_payload->'baseline') is not true then raise exception 'Invalid baseline' using errcode='22023';end if;
  update public.outcome_initiatives set owner_agent=case when p_payload ? 'ownerAgent' then p_payload->>'ownerAgent' else owner_agent end,
   due_at=case when p_payload ? 'dueAt' then(p_payload->>'dueAt')::timestamptz else due_at end,next_review_at=case when p_payload ? 'nextReviewAt' then(p_payload->>'nextReviewAt')::timestamptz else next_review_at end,
   metric_config=case when p_payload ? 'metricConfig' then nullif(p_payload->'metricConfig','null'::jsonb) else metric_config end,
   baseline=case when p_payload ? 'baseline' then nullif(p_payload->'baseline','null'::jsonb) else baseline end,
   observation=case when p_payload ? 'metricConfig' or p_payload ? 'baseline' then '{}'::jsonb else observation end,
   outcome_state=case when p_payload ? 'metricConfig' or p_payload ? 'baseline' then 'awaiting_data' else outcome_state end where id=o.id;return o.id;
 elsif p_action='note' then
  txt:=btrim(coalesce(p_payload->>'note',''));if char_length(txt) not between 1 and 3000 then raise exception 'Add a note of 1 to 3000 characters' using errcode='22023';end if;
  update public.outcome_initiatives set notes=(select jsonb_agg(x.value order by x.ordinality) from jsonb_array_elements(notes||jsonb_build_array(jsonb_build_object('text',txt,'at',now(),'by',auth.uid()))) with ordinality x where x.ordinality>greatest(jsonb_array_length(notes)+1-20,0)) where id=o.id;return o.id;
 elsif p_action='experiment_create' then
  if coalesce(p_payload->>'requestId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or jsonb_typeof(p_payload->'guardrails') is distinct from 'array' or public.valid_outcome_baseline(coalesce(p_payload->'baseline','null')) is not true then raise exception 'Invalid experiment plan' using errcode='22023';end if;
  if jsonb_array_length(p_payload->'guardrails')>8 then raise exception 'Add up to eight experiment guardrails' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(p_payload->'guardrails') loop
   if jsonb_typeof(item) is distinct from 'string' or char_length(btrim(item#>>'{}')) not between 1 and 500 then raise exception 'Invalid experiment guardrail' using errcode='22023';end if;
  end loop;
  if jsonb_typeof(p_payload->'hypothesis') is distinct from 'string' or jsonb_typeof(p_payload->'primaryMetric') is distinct from 'string' or jsonb_typeof(p_payload->'plannedChange') is distinct from 'string' or char_length(btrim(coalesce(p_payload->>'primaryMetric',''))) not between 1 and 160 then raise exception 'Invalid experiment plan' using errcode='22023';end if;
  key:=auth.uid()||':'||(p_payload->>'requestId');
  insert into public.outcome_experiments(initiative_id,request_key,hypothesis,primary_metric,guardrails,baseline,planned_change,evaluation_at,created_by)
   values(o.id,key,btrim(p_payload->>'hypothesis'),p_payload->>'primaryMetric',p_payload->'guardrails',nullif(p_payload->'baseline','null'),btrim(p_payload->>'plannedChange'),(p_payload->>'evaluationAt')::timestamptz,auth.uid()) on conflict(request_key) do nothing returning id into created;
  if created is null then select * into e from public.outcome_experiments where request_key=key;
   if e.initiative_id<>o.id or e.hypothesis is distinct from btrim(p_payload->>'hypothesis') or e.planned_change is distinct from btrim(p_payload->>'plannedChange') or e.primary_metric is distinct from p_payload->>'primaryMetric' or e.guardrails is distinct from p_payload->'guardrails' or e.baseline is distinct from nullif(p_payload->'baseline','null') or e.evaluation_at is distinct from (p_payload->>'evaluationAt')::timestamptz then raise exception 'Request identifier reused for another experiment' using errcode='40001';end if;created:=e.id;
  end if;return created;
 else raise exception 'Unsupported outcome operation' using errcode='22023';end if;
end $$;
revoke all on function public.mutate_outcome(text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.mutate_outcome(text,uuid,integer,jsonb) to authenticated;

create function public.save_outcome_observation(p_id uuid,p_revision integer,p_observation jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.outcome_initiatives;i jsonb;fp text;
begin
 select * into o from public.outcome_initiatives where id=p_id for update;
 if not found or o.revision is distinct from p_revision then return false;end if;
 if jsonb_typeof(p_observation) is distinct from 'object' or coalesce(p_observation->>'fingerprint','')='' or p_observation->>'outcome_state' not in('awaiting_data','healthy','underperforming','improving','inconclusive','closed') or jsonb_typeof(p_observation->'incidents') is distinct from 'array' then raise exception 'Invalid observation' using errcode='22023';end if;
 if o.observation->>'fingerprint'=p_observation->>'fingerprint' then return true;end if;
 if jsonb_array_length(p_observation->'incidents')>12 then raise exception 'Too many incidents' using errcode='22023';end if;
 update public.outcome_initiatives set outcome_state=p_observation->>'outcome_state',observation=p_observation-'incidents',evidence=coalesce(p_observation->'evidence','[]'),warnings=coalesce(p_observation->'warnings','[]'),last_observed_at=now() where id=o.id;
 for i in select value from jsonb_array_elements(p_observation->'incidents') loop
  fp:=md5(i::text);
  insert into public.outcome_incidents(initiative_id,problem_key,severity,title,detail,evidence,fingerprint)
   values(o.id,i->>'problem_key',i->>'severity',i->>'title',i->>'detail',coalesce(i->'evidence','[]'),fp)
  on conflict(initiative_id,problem_key) do update set status='open',severity=excluded.severity,title=excluded.title,detail=excluded.detail,evidence=excluded.evidence,fingerprint=excluded.fingerprint,last_seen_at=now(),resolved_at=null
   where outcome_incidents.fingerprint<>excluded.fingerprint or outcome_incidents.status='resolved';
 end loop;
 update public.outcome_incidents set status='resolved',resolved_at=now() where initiative_id=o.id and status='open' and problem_key not in(select value->>'problem_key' from jsonb_array_elements(p_observation->'incidents'));
 return true;
end $$;
revoke all on function public.save_outcome_observation(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_outcome_observation(uuid,integer,jsonb) to service_role;
notify pgrst,'reload schema';

create function public.read_outcome_campaign_metrics(p_registry_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.campaign_registry;answer jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>90 then raise exception 'Invalid metric window' using errcode='22023';end if;
 select * into c from public.campaign_registry where id=p_registry_id;
 if not found then return null;end if;
 select jsonb_build_object('row_count',count(*),'date_count',count(distinct day),'from',p_from,'to',p_to,
  'spend',case when count(*)=0 then 0 when bool_and(spend is not null and spend>=0) then sum(spend) else null end,
  'impressions',case when count(*)=0 then 0 when bool_and(impressions is not null and impressions>=0) then sum(impressions) else null end,
  'clicks',case when count(*)=0 then 0 when bool_and(clicks is not null and clicks>=0) then sum(clicks) else null end,
  'purchases',case when count(*)=0 then 0 when bool_and(conversion_definition='purchase' and purchases is not null and purchases>=0) then sum(purchases) else null end,
  'revenue',case when count(*)=0 then 0 when bool_and(conversion_definition='purchase' and revenue is not null and revenue>=0) then sum(revenue) else null end,
  'purchase_known',case when count(*)=0 then null else bool_and(conversion_definition='purchase' and purchases is not null and revenue is not null) end,
  'currency',case when count(*)=0 then c.currency when count(currency)=count(*) and min(currency)=max(currency) then min(currency) else null end,
  'account_timezone',c.account_timezone,'oldest_refresh',min(data_updated_at),'all_refreshed',count(data_updated_at)=count(*))
 into answer from public.ad_insights_daily where platform=c.provider and account_id=c.account_id and campaign_id=c.campaign_id and day between p_from and p_to;
 return answer;
end $$;
revoke all on function public.read_outcome_campaign_metrics(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.read_outcome_campaign_metrics(uuid,date,date) to service_role;
notify pgrst,'reload schema';

-- Seed only derived tracking records; never resumes source work or calls a provider.
select public.materialize_outcome_sources();
