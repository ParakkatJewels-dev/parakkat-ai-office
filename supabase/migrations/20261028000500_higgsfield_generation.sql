-- Durable automatic Higgsfield jobs. No generation is started by this migration.
begin;
create table public.artwork_generation_jobs (
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('design','creative')),
 item_id uuid not null, request_id uuid not null,
 requested_by uuid not null references auth.users(id),
 provider text not null default 'higgsfield' check(provider='higgsfield'),
 model text not null check(length(model) between 1 and 200),
 account_id text not null check(length(account_id) between 1 and 200),
 settings jsonb not null default '{}' check(jsonb_typeof(settings)='object' and octet_length(settings::text)<=16384),
 state text not null default 'queued' check(state in ('queued','submitting','submitted','collecting','succeeded','blocked','failed','uncertain','cancelled')),
 provider_request_id text check(length(provider_request_id) between 1 and 500),
 lease_holder uuid, lease_until timestamptz, next_poll_at timestamptz not null default now(),
 error_code text, error text, usage jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
 unique(source,item_id,request_id)
);
create unique index artwork_generation_provider_request on public.artwork_generation_jobs(provider,account_id,provider_request_id) where provider_request_id is not null;
create index artwork_generation_due on public.artwork_generation_jobs(next_poll_at) where state in ('queued','submitting','submitted','collecting');
alter table public.artwork_generation_jobs enable row level security;
revoke all on public.artwork_generation_jobs from public,anon,authenticated,service_role;
grant select on public.artwork_generation_jobs to service_role;
comment on table public.artwork_generation_jobs is 'Service-only generation lifecycle; no OAuth tokens, original reference pixels, or signed media URLs.';

-- All functions lock campaign parent, artwork, then job in the same order.
create function public.lock_generation_artwork(p_source text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare artifact jsonb; campaign_status text;
begin
 if p_source='design' then select to_jsonb(d) into artifact from public.designs d where id=p_id for update;
 elsif p_source='creative' then
  select status into campaign_status from public.campaigns where id=(select campaign_id from public.creatives where id=p_id) for share;
  if campaign_status in ('approved','publishing','publish_review','live') then raise exception 'This campaign is approved. Its banner and copy are frozen'; end if;
  select to_jsonb(c) into artifact from public.creatives c where id=p_id for update;
 else raise exception 'Unknown artwork source'; end if;
 if artifact is null then raise exception 'Artwork not found'; end if;
 return artifact;
end $$;
revoke all on function public.lock_generation_artwork(text,uuid) from public,anon,authenticated,service_role;

create function public.reserve_higgsfield_generation(p_source text,p_id uuid,p_request_id uuid,p_user_id uuid,p_model text,p_account_id text,p_settings jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare artifact jsonb; job public.artwork_generation_jobs; current_state text; at timestamptz:=clock_timestamp();
begin
 if p_request_id is null or p_user_id is null or nullif(btrim(p_model),'') is null or nullif(btrim(p_account_id),'') is null then raise exception 'A current artwork request and connected model are required'; end if;
 artifact:=public.lock_generation_artwork(p_source,p_id);
 perform public.artwork_actor_role(p_source,p_id,p_user_id);
 if (artifact->>'artwork_request_id')::uuid is distinct from p_request_id then raise exception 'The artwork request changed. Refresh before generating'; end if;
 select * into job from public.artwork_generation_jobs where source=p_source and item_id=p_id and request_id=p_request_id for update;
 current_state:=artifact->>case when p_source='design' then 'status' else 'art_status' end;
 if job.id is not null then
  if job.model is distinct from p_model or job.account_id is distinct from p_account_id or job.settings is distinct from coalesce(p_settings,'{}') then raise exception 'This request already has a saved generation model. Prepare a new revision to change it'; end if;
  -- Only this explicit start call can retry a known pre-submission block.
  if job.state='blocked' and job.error_code in ('credits','auth','preflight') and job.provider_request_id is null and current_state='awaiting_import' then
   update public.artwork_generation_jobs set state='queued',requested_by=p_user_id,error_code=null,error=null,lease_holder=null,lease_until=null,next_poll_at=at,updated_at=at where id=job.id returning * into job;
  else return to_jsonb(job); end if;
 else
  if current_state is distinct from 'awaiting_import' then raise exception 'Prepare an artwork revision before generating'; end if;
  if artifact#>>'{artwork_handoff,packet,requestId}' is distinct from p_request_id::text then raise exception 'Prepare the current artwork brief before generating'; end if;
  insert into public.artwork_generation_jobs(source,item_id,request_id,requested_by,model,account_id,settings)
   values(p_source,p_id,p_request_id,p_user_id,p_model,p_account_id,coalesce(p_settings,'{}')) returning * into job;
 end if;
 if p_source='design' then update public.designs set status='generating',queued_at=at,error=null where id=p_id;
 else update public.creatives set art_status='generating',queued_at=at,art_error=null where id=p_id; end if;
 return to_jsonb(job);
end $$;

create function public.claim_higgsfield_generation(p_id uuid,p_holder uuid,p_expected_state text,p_lease_seconds integer default 180) returns jsonb
language plpgsql security definer set search_path=public as $$
declare found public.artwork_generation_jobs; job public.artwork_generation_jobs; artifact jsonb; at timestamptz:=clock_timestamp();
begin
 if p_holder is null then raise exception 'A generation lease owner is required'; end if;
 select * into found from public.artwork_generation_jobs where id=p_id;
 if found.id is null then return null; end if;
 artifact:=public.lock_generation_artwork(found.source,found.item_id);
 select * into job from public.artwork_generation_jobs where id=p_id for update;
 if job.state is distinct from p_expected_state or job.state not in ('queued','submitting','submitted','collecting') or job.next_poll_at>at or job.lease_until>at then return null; end if;
 if (artifact->>'artwork_request_id')::uuid is distinct from job.request_id or (artifact->>case when job.source='design' then 'status' else 'art_status' end) is distinct from 'generating' then
  update public.artwork_generation_jobs set state='cancelled',error_code='request_changed',error='The artwork request changed; no further provider request was sent.',lease_holder=null,lease_until=null,updated_at=at where id=p_id returning * into job;
  return to_jsonb(job);
 end if;
 if job.state='submitting' then
  update public.artwork_generation_jobs set state='uncertain',error_code='submission_unknown',error='The previous submission outcome is unknown. Check Higgsfield before requesting another generation.',lease_holder=null,lease_until=null,updated_at=at where id=p_id returning * into job;
  if job.source='design' then update public.designs set status='awaiting_import',queued_at=null,error=job.error where id=job.item_id;
  else update public.creatives set art_status='awaiting_import',queued_at=null,art_error=job.error where id=job.item_id; end if;
  return to_jsonb(job);
 end if;
 begin
  perform public.artwork_actor_role(job.source,job.item_id,job.requested_by);
 exception when sqlstate 'P0001' then
  update public.artwork_generation_jobs set state='cancelled',error_code='access_changed',error='The requester no longer has access. No further request will be sent; check any submitted job in Higgsfield.',lease_holder=null,lease_until=null,updated_at=at where id=p_id returning * into job;
  if job.source='design' then update public.designs set status='awaiting_import',queued_at=null,error=job.error where id=job.item_id;
  else update public.creatives set art_status='awaiting_import',queued_at=null,art_error=job.error where id=job.item_id; end if;
  return to_jsonb(job);
 end;
 update public.artwork_generation_jobs set state=case when state='queued' then 'submitting' else state end,lease_holder=p_holder,
  lease_until=at+make_interval(secs=>greatest(15,least(coalesce(p_lease_seconds,180),900))),updated_at=at where id=p_id returning * into job;
 return to_jsonb(job);
end $$;

create function public.update_higgsfield_generation(p_id uuid,p_holder uuid,p_expected_state text,p_state text,p_provider_request_id text default null,p_next_poll_at timestamptz default null,p_error_code text default null,p_error text default null,p_usage jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare found public.artwork_generation_jobs; job public.artwork_generation_jobs; artifact jsonb; at timestamptz:=clock_timestamp(); provider_id text;
begin
 select * into found from public.artwork_generation_jobs where id=p_id;
 if found.id is null then raise exception 'Generation job not found'; end if;
 artifact:=public.lock_generation_artwork(found.source,found.item_id);
 select * into job from public.artwork_generation_jobs where id=p_id for update;
 if job.state is distinct from p_expected_state or job.lease_holder is distinct from p_holder or p_holder is null or job.lease_until is null or job.lease_until<=at then raise exception 'The generation job lease changed'; end if;
 if (artifact->>'artwork_request_id')::uuid is distinct from job.request_id or (artifact->>case when job.source='design' then 'status' else 'art_status' end) is distinct from 'generating' then raise exception 'The artwork request changed'; end if;
 if not ((job.state='submitting' and p_state in ('queued','submitted','blocked','failed','uncertain','cancelled')) or (job.state='submitted' and p_state in ('submitted','collecting','failed','cancelled')) or (job.state='collecting' and p_state in ('collecting','failed','cancelled'))) then raise exception 'Invalid generation transition'; end if;
 provider_id:=coalesce(p_provider_request_id,job.provider_request_id);
 if p_state='queued' and (p_error_code is distinct from 'project_wait' or provider_id is not null or not exists(
  select 1 from public.higgsfield_generation_projects d where d.account_id=job.account_id and d.workspace_id=coalesce(job.settings->>'workspaceId','')
   and d.scope=coalesce(nullif(job.settings->>'projectScope',''),job.source||':'||job.item_id::text) and d.owner_job_id<>job.id and
   (d.state='ready' or (d.state='creating' and d.lease_until>at)))) then raise exception 'Only a known project wait can defer an unsubmitted generation'; end if;
 if job.provider_request_id is not null and provider_id is distinct from job.provider_request_id then raise exception 'The provider request cannot change'; end if;
 if p_state in ('submitted','collecting') and nullif(btrim(provider_id),'') is null then raise exception 'A provider request ID is required'; end if;
 if p_state='blocked' and (provider_id is not null or p_error_code is null or p_error_code not in ('credits','auth','preflight')) then raise exception 'Only a known pre-submission failure can be blocked'; end if;
 if jsonb_typeof(coalesce(p_usage,'{}'))<>'object' or octet_length(coalesce(p_usage,'{}')::text)>4096 then raise exception 'Invalid generation usage metadata'; end if;
 update public.artwork_generation_jobs set state=p_state,provider_request_id=provider_id,
  lease_holder=case when job.state='submitted' and p_state='collecting' then p_holder else null end,
  lease_until=case when job.state='submitted' and p_state='collecting' then job.lease_until else null end,
  next_poll_at=greatest(at,least(coalesce(p_next_poll_at,at+interval '10 seconds'),at+interval '1 day')),
  error_code=left(p_error_code,100),error=left(p_error,600),usage=usage||coalesce(p_usage,'{}'),updated_at=at where id=p_id returning * into job;
 if p_state in ('blocked','failed','uncertain','cancelled') then
  if job.source='design' then update public.designs set status='awaiting_import',queued_at=null,error=job.error where id=job.item_id;
  else update public.creatives set art_status='awaiting_import',queued_at=null,art_error=job.error where id=job.item_id; end if;
 end if;
 return to_jsonb(job);
end $$;

create function public.complete_higgsfield_generation(p_id uuid,p_holder uuid,p_path text,p_ref_ids uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare found public.artwork_generation_jobs; job public.artwork_generation_jobs; artifact jsonb; history jsonb; refs uuid[]:=coalesce(p_ref_ids,'{}'); cached_refs uuid[]; at timestamptz:=clock_timestamp();
begin
 select * into found from public.artwork_generation_jobs where id=p_id;
 if found.id is null then raise exception 'Generation job not found'; end if;
 artifact:=public.lock_generation_artwork(found.source,found.item_id);
 select * into job from public.artwork_generation_jobs where id=p_id for update;
 if job.state is distinct from 'collecting' or job.lease_holder is distinct from p_holder or p_holder is null or job.lease_until is null or job.lease_until<=at then raise exception 'The generation job lease changed'; end if;
 perform public.artwork_actor_role(job.source,job.item_id,job.requested_by);
 if (artifact->>'artwork_request_id')::uuid is distinct from job.request_id or (artifact->>case when job.source='design' then 'status' else 'art_status' end) is distinct from 'generating' then raise exception 'The artwork request changed'; end if;
 if p_path is null or p_path !~ ('^higgsfield-generations/'||job.source||'/'||job.item_id::text||'/'||job.request_id::text||'/[0-9a-f-]{36}\.(png|jpg|webp)$') then raise exception 'The result path does not belong to this generation'; end if;
 if cardinality(refs)>3 or exists(select 1 from unnest(refs) ref where ref is null or not exists(select 1 from public.design_refs r where r.id=ref and r.status='ready' and not r.hidden)) then raise exception 'The selected style references are unavailable'; end if;
 if artifact#>>'{artwork_handoff,packet,requestId}' is distinct from job.request_id::text or jsonb_typeof(artifact#>'{artwork_handoff,refs}') is distinct from 'array' then raise exception 'The saved artwork brief does not match this generation'; end if;
 select coalesce(array_agg((ref->>'id')::uuid order by ordinal),'{}'::uuid[]) into cached_refs from jsonb_array_elements(artifact#>'{artwork_handoff,refs}') with ordinality as selected(ref,ordinal);
 if refs is distinct from cached_refs then raise exception 'The generated references do not match the saved artwork brief'; end if;
 history:=coalesce(artifact->'versions','[]'::jsonb);
 if artifact->>'image_path' is not null then history:=history||jsonb_build_array(jsonb_build_object('image_path',artifact->>'image_path','concept',artifact->>'concept','note',artifact->>'redo_note','at',at,'artwork_origin',artifact->>'artwork_origin','imported_at',artifact->>'imported_at','imported_by',artifact->>'imported_by')); end if;
 if job.source='design' then update public.designs set image_path=p_path,status='ready',versions=history,ref_ids=refs,queued_at=null,error=null,artwork_origin='higgsfield_oauth',imported_at=at,imported_by=job.requested_by,review_note='Generated through Higgsfield OAuth using subscription credits. Human review required; no automated image check was run.' where id=job.item_id;
 else update public.creatives set image_path=p_path,art_status='ready',versions=history,ref_ids=refs,queued_at=null,art_error=null,artwork_origin='higgsfield_oauth',imported_at=at,imported_by=job.requested_by,review_note='Generated through Higgsfield OAuth using subscription credits. Human review required; no automated image check was run.' where id=job.item_id; end if;
 delete from public.image_reviews where source=job.source and item_id=job.item_id;
 update public.artwork_generation_jobs set state='succeeded',completed_at=at,updated_at=at,error_code=null,error=null,lease_holder=null,lease_until=null where id=p_id;
 return jsonb_build_object('id',job.item_id,'source',job.source,'status','ready','version',jsonb_array_length(history)+1,'image_path',p_path);
end $$;

revoke all on function public.reserve_higgsfield_generation(text,uuid,uuid,uuid,text,text,jsonb),public.claim_higgsfield_generation(uuid,uuid,text,integer),public.update_higgsfield_generation(uuid,uuid,text,text,text,timestamptz,text,text,jsonb),public.complete_higgsfield_generation(uuid,uuid,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.reserve_higgsfield_generation(text,uuid,uuid,uuid,text,text,jsonb),public.claim_higgsfield_generation(uuid,uuid,text,integer),public.update_higgsfield_generation(uuid,uuid,text,text,text,timestamptz,text,text,jsonb),public.complete_higgsfield_generation(uuid,uuid,text,uuid[]) to service_role;

-- Shared destinations are durable across jobs in the same private conversation/set.
create table public.higgsfield_generation_projects (
 id uuid primary key default gen_random_uuid(),account_id text not null,workspace_id text not null default '',scope text not null,
 state text not null check(state in ('creating','ready','uncertain')),
 owner_job_id uuid not null references public.artwork_generation_jobs(id),holder uuid not null,claim_token uuid not null,
 lease_until timestamptz not null,project_id uuid,folder_id uuid,error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(account_id,workspace_id,scope),
 check((state='ready' and project_id is not null and folder_id is not null) or state<>'ready')
);
alter table public.higgsfield_generation_projects enable row level security;
revoke all on public.higgsfield_generation_projects from public,anon,authenticated,service_role;
grant select on public.higgsfield_generation_projects to service_role;

create function public.authorize_generation_preparation(p_source text,p_id uuid,p_request_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare artifact jsonb; state text;
begin
 artifact:=public.lock_generation_artwork(p_source,p_id);
 perform public.artwork_actor_role(p_source,p_id,p_user_id);
 if p_request_id is null or (artifact->>'artwork_request_id')::uuid is distinct from p_request_id then raise exception 'The artwork request changed. Refresh before generating'; end if;
 state:=artifact->>case when p_source='design' then 'status' else 'art_status' end;
 if state is null or (state not in ('awaiting_import','generating') and not(state='ready' and exists(select 1 from public.artwork_generation_jobs j where j.source=p_source and j.item_id=p_id and j.request_id=p_request_id and j.state='succeeded'))) then raise exception 'Prepare an artwork revision before generating'; end if;
 return jsonb_build_object('requestId',p_request_id,'status',state,'carouselId',artifact->>'carousel_id','campaignId',artifact->>'campaign_id');
end $$;

-- Used only by definer RPCs. Keeps lock order and last-moment authorization identical.
create function public.owned_generation_job(p_id uuid,p_holder uuid,p_expected_state text) returns public.artwork_generation_jobs
language plpgsql security definer set search_path=public as $$
declare found public.artwork_generation_jobs; job public.artwork_generation_jobs; artifact jsonb;
begin
 select * into found from public.artwork_generation_jobs where id=p_id;
 if found.id is null then raise exception 'Generation job not found'; end if;
 artifact:=public.lock_generation_artwork(found.source,found.item_id);
 select * into job from public.artwork_generation_jobs where id=p_id for update;
 if job.state is distinct from p_expected_state or job.lease_holder is distinct from p_holder or p_holder is null or job.lease_until is null or job.lease_until<=clock_timestamp() then raise exception 'The generation job lease changed'; end if;
 if (artifact->>'artwork_request_id')::uuid is distinct from job.request_id or (artifact->>case when job.source='design' then 'status' else 'art_status' end) is distinct from 'generating' then raise exception 'The artwork request changed'; end if;
 perform public.artwork_actor_role(job.source,job.item_id,job.requested_by);
 return job;
end $$;
revoke all on function public.owned_generation_job(uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.renew_higgsfield_generation_lease(p_id uuid,p_holder uuid,p_expected_state text,p_lease_seconds integer default 600) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.artwork_generation_jobs;
begin
 job:=public.owned_generation_job(p_id,p_holder,p_expected_state);
 update public.artwork_generation_jobs set lease_until=clock_timestamp()+make_interval(secs=>greatest(15,least(coalesce(p_lease_seconds,600),900))),updated_at=clock_timestamp() where id=p_id returning * into job;
 return to_jsonb(job);
end $$;

create function public.begin_higgsfield_generation_project(p_job_id uuid,p_holder uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.artwork_generation_jobs; destination public.higgsfield_generation_projects; wanted_scope text; workspace text; inserted boolean;
begin
 job:=public.owned_generation_job(p_job_id,p_holder,'submitting');
 wanted_scope:=coalesce(nullif(job.settings->>'projectScope',''),job.source||':'||job.item_id::text);
 workspace:=coalesce(job.settings->>'workspaceId','');
 if wanted_scope !~ '^(thread|carousel|campaign|design|creative):[0-9a-fA-F-]{36}$' or length(workspace)>200 then raise exception 'Invalid generation project scope'; end if;
 insert into public.higgsfield_generation_projects(account_id,workspace_id,scope,state,owner_job_id,holder,claim_token,lease_until)
  values(job.account_id,workspace,wanted_scope,'creating',job.id,p_holder,gen_random_uuid(),job.lease_until)
  on conflict(account_id,workspace_id,scope) do nothing returning * into destination;
 inserted:=destination.id is not null;
 if not inserted then select * into destination from public.higgsfield_generation_projects where account_id=job.account_id and workspace_id=workspace and scope=wanted_scope for update; end if;
 if destination.state='ready' then
  update public.artwork_generation_jobs set usage=usage||jsonb_build_object('project_id',destination.project_id,'folder_id',destination.folder_id),updated_at=clock_timestamp() where id=job.id;
  return jsonb_build_object('state','ready','id',destination.id,'projectId',destination.project_id,'folderId',destination.folder_id);
 end if;
 if inserted then return jsonb_build_object('state','claimed','id',destination.id,'token',destination.claim_token); end if;
 if destination.state='creating' and destination.lease_until<=clock_timestamp() then
  update public.higgsfield_generation_projects set state='uncertain',error='The prior project creation outcome is unknown. Manage the existing project in Higgsfield before continuing.',updated_at=clock_timestamp() where id=destination.id returning * into destination;
 end if;
 return jsonb_build_object('state',case when destination.state='creating' then 'waiting' else 'uncertain' end,'id',destination.id);
end $$;

create function public.commit_higgsfield_generation_project(p_job_id uuid,p_holder uuid,p_id uuid,p_token uuid,p_project_id uuid,p_folder_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.artwork_generation_jobs; destination public.higgsfield_generation_projects;
begin
 job:=public.owned_generation_job(p_job_id,p_holder,'submitting');
 select * into destination from public.higgsfield_generation_projects where id=p_id for update;
 if destination.id is null or destination.owner_job_id is distinct from job.id or destination.holder is distinct from p_holder or destination.claim_token is distinct from p_token or p_token is null or p_project_id is null or p_folder_id is null then raise exception 'The project creation claim changed'; end if;
 if destination.state='ready' then
  if destination.project_id is distinct from p_project_id or destination.folder_id is distinct from p_folder_id then raise exception 'The saved generation destination cannot change'; end if;
 elsif destination.state='creating' and destination.lease_until>clock_timestamp() then
  update public.higgsfield_generation_projects set state='ready',project_id=p_project_id,folder_id=p_folder_id,error=null,updated_at=clock_timestamp() where id=p_id;
 else raise exception 'Project creation needs manual reconciliation; no replacement project was created'; end if;
 update public.artwork_generation_jobs set usage=usage||jsonb_build_object('project_id',p_project_id,'folder_id',p_folder_id),updated_at=clock_timestamp() where id=job.id;
 return jsonb_build_object('state','ready','id',p_id,'projectId',p_project_id,'folderId',p_folder_id);
end $$;

create function public.fail_higgsfield_generation_project(p_job_id uuid,p_holder uuid,p_id uuid,p_token uuid,p_error text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare destination public.higgsfield_generation_projects;
begin
 select * into destination from public.higgsfield_generation_projects where id=p_id for update;
 if destination.id is null or destination.owner_job_id is distinct from p_job_id or destination.holder is distinct from p_holder or destination.claim_token is distinct from p_token or p_token is null then raise exception 'The project creation claim changed'; end if;
 -- This may be recorded after the worker lease expires. Never turn a committed destination uncertain.
 if destination.state='creating' then update public.higgsfield_generation_projects set state='uncertain',error=left(coalesce(p_error,'Project creation outcome is unknown. Manage the existing project in Higgsfield before continuing.'),600),updated_at=clock_timestamp() where id=p_id returning * into destination; end if;
 return jsonb_build_object('state',destination.state,'id',destination.id);
end $$;
revoke all on function public.authorize_generation_preparation(text,uuid,uuid,uuid),public.renew_higgsfield_generation_lease(uuid,uuid,text,integer),public.begin_higgsfield_generation_project(uuid,uuid),public.commit_higgsfield_generation_project(uuid,uuid,uuid,uuid,uuid,uuid),public.fail_higgsfield_generation_project(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.authorize_generation_preparation(text,uuid,uuid,uuid),public.renew_higgsfield_generation_lease(uuid,uuid,text,integer),public.begin_higgsfield_generation_project(uuid,uuid),public.commit_higgsfield_generation_project(uuid,uuid,uuid,uuid,uuid,uuid),public.fail_higgsfield_generation_project(uuid,uuid,uuid,uuid,text) to service_role;

create or replace function public.review_artwork(
  p_source text,p_id uuid,p_image_path text,p_request_id uuid,p_verdict text,p_note text,p_reviewer uuid,p_reviewer_role text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare artifact jsonb; actor public.app_role; state text; at timestamptz:=clock_timestamp();
begin
  if p_source='design' then
    select to_jsonb(d) into artifact from public.designs d where id=p_id for update;
  elsif p_source='creative' then
    perform 1 from public.campaigns where id=(select campaign_id from public.creatives where id=p_id) for share;
    select to_jsonb(c) into artifact from public.creatives c where id=p_id for update;
  else raise exception 'Unknown artwork source'; end if;
  if artifact is null then raise exception 'Artwork not found'; end if;
  actor:=public.artwork_actor_role(p_source,p_id,p_reviewer);
  if actor::text is distinct from p_reviewer_role then raise exception 'The reviewer role changed. Refresh before reviewing'; end if;
  state:=artifact->>case when p_source='design' then 'status' else 'art_status' end;
  if artifact->>'image_path' is null or state in ('awaiting_import','queued','making','generating') then raise exception 'Import the finished artwork before reviewing it'; end if;
  if artifact->>'image_path' is distinct from p_image_path or (artifact->>'artwork_request_id')::uuid is distinct from p_request_id then
    raise exception 'The artwork changed. Review the current image before submitting';
  end if;
  if p_verdict not in ('good','bad') or p_verdict is null then raise exception 'Choose Good or Bad'; end if;
  if p_verdict='bad' and nullif(btrim(p_note),'') is null then raise exception 'Say what needs correction'; end if;
  if p_verdict='good' and artifact->>'format'='carousel_card' and state is distinct from 'ready' then raise exception 'Review a finished carousel card'; end if;
  insert into public.image_reviews(source,item_id,verdict,note,reviewer,reviewer_role,updated_at)
    values(p_source,p_id,p_verdict,nullif(left(btrim(p_note),600),''),p_reviewer,actor,at)
    on conflict(source,item_id) do update set verdict=excluded.verdict,note=excluded.note,reviewer=excluded.reviewer,
      reviewer_role=excluded.reviewer_role,updated_at=excluded.updated_at;
  return jsonb_build_object('id',p_id,'source',p_source,'verdict',p_verdict,'reviewed_at',at);
end $$;
revoke all on function public.review_artwork(text,uuid,text,uuid,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.review_artwork(text,uuid,text,uuid,text,text,uuid,text) to service_role;

create or replace function public.guard_approved_campaign_artwork() returns trigger
language plpgsql security definer set search_path=public as $$
declare campaign_status text; campaign uuid;
begin
  campaign:=case when TG_OP='DELETE' then OLD.campaign_id else NEW.campaign_id end;
  if TG_OP='UPDATE' and NEW.campaign_id is distinct from OLD.campaign_id then raise exception 'A campaign creative cannot move to another campaign'; end if;
  select status into campaign_status from public.campaigns where id=campaign for share;
  if campaign_status in ('approved','publishing','publish_review','live') then
    if TG_OP in ('INSERT','DELETE') then raise exception 'This campaign is approved. Its banner and copy are frozen'; end if;
    if NEW.art_status in ('queued','making','awaiting_import','generating') or
       (to_jsonb(NEW)-array['art_status','art_error','queued_at','review_note','redo_note']) is distinct from
       (to_jsonb(OLD)-array['art_status','art_error','queued_at','review_note','redo_note']) then
      raise exception 'This campaign is approved. Its banner and copy are frozen';
    end if;
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;


create or replace function public.guard_campaign_artwork_approval() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if NEW.status='approved' and OLD.status is distinct from NEW.status then
    if exists (select 1 from public.creatives where campaign_id=NEW.id and art_status in ('queued','making','awaiting_import','generating')) then
      raise exception 'Wait for the banner import or redesign to finish before final approval';
    end if;
    if exists (select 1 from public.creatives c where c.campaign_id=NEW.id and c.artwork_origin in ('chatgpt_import','higgsfield_import','higgsfield_oauth') and
      (c.image_path is null or c.art_status is distinct from 'ready' or c.imported_at is null or not exists
        (select 1 from public.image_reviews r where r.source='creative' and r.item_id=c.id and r.verdict='good' and r.updated_at>=c.imported_at))) then
      raise exception 'The imported campaign artwork needs a human Good review before final approval';
    end if;
    if NEW.channels=array['meta']::text[] and not exists (select 1 from public.creatives where campaign_id=NEW.id and image_path is not null) then
      raise exception 'Create a finished banner before approving a Meta-only campaign';
    end if;
  end if;
  return NEW;
end $$;
revoke all on function public.guard_campaign_artwork_approval() from public,anon,authenticated;
commit;
