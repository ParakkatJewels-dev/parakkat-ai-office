-- Additive subscription worker ledger. Applying this migration starts no work.
begin;
create table public.chatgpt_image_jobs (
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('design','creative')),
 item_id uuid not null, request_id uuid not null,
 requested_by uuid not null references auth.users(id),
 state text not null default 'queued' check(state in ('queued','preparing','generating','succeeded','blocked','uncertain','cancelled')),
 lease_holder uuid, lease_until timestamptz,
 dispatched_at timestamptz, manifest_sha256 text check(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 output_sha256 text check(output_sha256 ~ '^[0-9a-f]{64}$'), output_path text, result jsonb,
 error_code text, error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
 unique(source,item_id,request_id)
);
create index chatgpt_image_jobs_due on public.chatgpt_image_jobs(created_at) where state in ('queued','preparing','generating');
alter table public.chatgpt_image_jobs enable row level security;
revoke all on public.chatgpt_image_jobs from public,anon,authenticated,service_role;
grant select on public.chatgpt_image_jobs to service_role;
comment on table public.chatgpt_image_jobs is 'Subscription Codex image worker lifecycle. No auth tokens, original pixels or signed URLs.';

-- Helpers are private to definer RPCs; all mutations lock artwork before the job.
create function public.chatgpt_job_artwork_status(p_job public.chatgpt_image_jobs,p_status text,p_error text default null) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_job.source='design' then
  update public.designs set status=p_status,queued_at=case when p_status='generating' then clock_timestamp() else null end,error=p_error
   where id=p_job.item_id and artwork_request_id=p_job.request_id;
 else
  update public.creatives set art_status=p_status,queued_at=case when p_status='generating' then clock_timestamp() else null end,art_error=p_error
   where id=p_job.item_id and artwork_request_id=p_job.request_id;
 end if;
end $$;

create function public.reserve_chatgpt_image_job(p_source text,p_id uuid,p_request_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare artifact jsonb; job public.chatgpt_image_jobs; current_state text;
begin
 if p_request_id is null or p_user_id is null then raise exception 'A current artwork request and authorized requester are required'; end if;
 artifact:=public.lock_generation_artwork(p_source,p_id);
 perform public.artwork_actor_role(p_source,p_id,p_user_id);
 if (artifact->>'artwork_request_id')::uuid is distinct from p_request_id then raise exception 'The artwork request changed'; end if;
 select * into job from public.chatgpt_image_jobs where source=p_source and item_id=p_id and request_id=p_request_id for update;
 current_state:=artifact->>case when p_source='design' then 'status' else 'art_status' end;
 if job.id is not null and job.state <> 'blocked' then return to_jsonb(job); end if;
 if current_state is distinct from 'awaiting_import' then raise exception 'Prepare an artwork revision before generating'; end if;
 if exists(select 1 from public.artwork_generation_jobs where source=p_source and item_id=p_id and request_id=p_request_id and state in ('queued','submitting','submitted','collecting','uncertain','succeeded')) then
  raise exception 'This request already has a Higgsfield generation. Reconcile it or prepare a new revision';
 end if;
 if artifact#>>'{artwork_handoff,packet,requestId}' is distinct from p_request_id::text then raise exception 'Prepare the current artwork brief before generating'; end if;
 if job.id is null then
  insert into public.chatgpt_image_jobs(source,item_id,request_id,requested_by) values(p_source,p_id,p_request_id,p_user_id) returning * into job;
 else
  if job.dispatched_at is not null then raise exception 'The generation outcome must be reconciled before retrying'; end if;
  update public.chatgpt_image_jobs set state='queued',requested_by=p_user_id,lease_holder=null,lease_until=null,error_code=null,error=null,updated_at=clock_timestamp() where id=job.id returning * into job;
 end if;
 perform public.chatgpt_job_artwork_status(job,'generating');
 return to_jsonb(job);
end $$;

-- Serializes against the existing Higgsfield reserve RPC's artwork lock. It may
-- continue polling historical submitted jobs; it cannot start this request anew.
create function public.guard_higgsfield_chatgpt_overlap() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if NEW.state in ('queued','submitting','submitted','collecting') and exists(
  select 1 from public.chatgpt_image_jobs where source=NEW.source and item_id=NEW.item_id and request_id=NEW.request_id and state in ('queued','preparing','generating','uncertain','succeeded')) then
  raise exception 'This artwork request belongs to the ChatGPT image worker. Prepare a new revision to change providers';
 end if;
 return NEW;
end $$;
create trigger higgsfield_chatgpt_overlap before insert or update on public.artwork_generation_jobs for each row execute function public.guard_higgsfield_chatgpt_overlap();

create function public.claim_chatgpt_image_job(p_id uuid,p_holder uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare found public.chatgpt_image_jobs; job public.chatgpt_image_jobs; artifact jsonb; at timestamptz:=clock_timestamp();
begin
 if p_holder is null then raise exception 'A worker lease owner is required'; end if;
 select * into found from public.chatgpt_image_jobs where id=p_id;
 if found.id is null then return null; end if;
 artifact:=public.lock_generation_artwork(found.source,found.item_id);
 select * into job from public.chatgpt_image_jobs where id=p_id for update;
 if job.state not in ('queued','preparing','generating') or job.lease_until>at then return null; end if;
 if (artifact->>'artwork_request_id')::uuid is distinct from job.request_id or (artifact->>case when job.source='design' then 'status' else 'art_status' end) is distinct from 'generating' then
  update public.chatgpt_image_jobs set state='cancelled',error_code='request_changed',error='The artwork request changed. No new generation was started.',lease_until=null,updated_at=at where id=p_id returning * into job;
  return to_jsonb(job);
 end if;
 if job.dispatched_at is not null then
  update public.chatgpt_image_jobs set state='uncertain',error_code='generation_unknown',error='The ChatGPT generation outcome needs reconciliation. No replacement will be generated automatically.',lease_until=null,updated_at=at where id=p_id returning * into job;
  perform public.chatgpt_job_artwork_status(job,'awaiting_import',job.error);
  return to_jsonb(job);
 end if;
 begin
  perform public.artwork_actor_role(job.source,job.item_id,job.requested_by);
 exception when sqlstate 'P0001' then
  update public.chatgpt_image_jobs set state='cancelled',error_code='access_changed',error='The requester no longer has access. No image was generated.',lease_until=null,updated_at=at where id=p_id returning * into job;
  perform public.chatgpt_job_artwork_status(job,'awaiting_import',job.error);
  return to_jsonb(job);
 end;
 update public.chatgpt_image_jobs set state='preparing',lease_holder=p_holder,lease_until=at+interval '15 minutes',updated_at=at where id=p_id returning * into job;
 return to_jsonb(job);
end $$;

create function public.owned_chatgpt_image_job(p_id uuid,p_holder uuid,p_allow_recovery boolean default false) returns public.chatgpt_image_jobs
language plpgsql security definer set search_path=public as $$
declare found public.chatgpt_image_jobs; job public.chatgpt_image_jobs; artifact jsonb; current_state text;
begin
 select * into found from public.chatgpt_image_jobs where id=p_id;
 if found.id is null then raise exception 'Image job not found'; end if;
 artifact:=public.lock_generation_artwork(found.source,found.item_id);
 select * into job from public.chatgpt_image_jobs where id=p_id for update;
 if p_holder is null or job.lease_holder is distinct from p_holder then raise exception 'The image worker lease changed'; end if;
 if job.state='succeeded' and p_allow_recovery then return job; end if;
 current_state:=artifact->>case when job.source='design' then 'status' else 'art_status' end;
 if (artifact->>'artwork_request_id')::uuid is distinct from job.request_id or
  not coalesce(current_state='generating' or (p_allow_recovery and job.state='uncertain' and current_state='awaiting_import'),false) then raise exception 'The artwork request changed'; end if;
 if not(p_allow_recovery and job.dispatched_at is not null and job.state in ('generating','uncertain')) and
  (job.state not in ('preparing','generating') or job.lease_until is null or job.lease_until<=clock_timestamp()) then raise exception 'The image worker lease expired'; end if;
 perform public.artwork_actor_role(job.source,job.item_id,job.requested_by);
 return job;
end $$;

create function public.heartbeat_chatgpt_image_job(p_id uuid,p_holder uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.chatgpt_image_jobs;
begin
 job:=public.owned_chatgpt_image_job(p_id,p_holder);
 update public.chatgpt_image_jobs set lease_until=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp() where id=p_id returning * into job;
 return to_jsonb(job);
end $$;

create function public.dispatch_chatgpt_image_job(p_id uuid,p_holder uuid,p_manifest_sha256 text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.chatgpt_image_jobs;
begin
 if p_manifest_sha256 is null or p_manifest_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'A frozen input manifest hash is required'; end if;
 job:=public.owned_chatgpt_image_job(p_id,p_holder);
 -- Never return dispatch authorization twice, even for the same holder/hash.
 if job.state<>'preparing' or job.dispatched_at is not null then raise exception 'This image was already dispatched. Do not generate it again'; end if;
 update public.chatgpt_image_jobs set state='generating',dispatched_at=clock_timestamp(),manifest_sha256=p_manifest_sha256,lease_until=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp() where id=p_id returning * into job;
 return to_jsonb(job);
end $$;

create function public.fail_chatgpt_image_job(p_id uuid,p_holder uuid,p_kind text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.chatgpt_image_jobs; kind text;
begin
 if p_kind is null or p_kind not in ('preflight','uncertain') then raise exception 'Unknown image worker failure'; end if;
 job:=public.owned_chatgpt_image_job(p_id,p_holder,true);
 if job.state='succeeded' then return to_jsonb(job); end if;
 kind:=case when job.dispatched_at is not null then 'uncertain' else 'preflight' end;
 update public.chatgpt_image_jobs set state=case when kind='uncertain' then 'uncertain' else 'blocked' end,
  error_code=kind,error=case when kind='uncertain' then 'The ChatGPT generation outcome needs reconciliation. No replacement will be generated automatically.' else 'ChatGPT image preparation failed before generation. Check the worker login and saved references, then retry explicitly.' end,
  lease_until=null,updated_at=clock_timestamp() where id=p_id returning * into job;
 perform public.chatgpt_job_artwork_status(job,'awaiting_import',job.error);
 return to_jsonb(job);
end $$;

create function public.complete_chatgpt_image_job(p_id uuid,p_holder uuid,p_path text,p_sha256 text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.chatgpt_image_jobs; artifact jsonb; refs uuid[]; outcome jsonb;
begin
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'A valid output hash is required'; end if;
 job:=public.owned_chatgpt_image_job(p_id,p_holder,true);
 if job.state='succeeded' then
  if job.output_sha256 is distinct from p_sha256 or job.output_path is distinct from p_path then raise exception 'A different image was already committed'; end if;
  return job.result;
 end if;
 if job.dispatched_at is null or job.state not in ('generating','uncertain') then raise exception 'This job has not dispatched an image generation'; end if;
 if p_path is null or p_path !~ ('^chatgpt-imports/'||job.source||'/'||job.item_id::text||'/'||job.request_id::text||'/'||job.id::text||'\.(png|jpg|webp)$') then raise exception 'The output path does not belong to this image job'; end if;
 artifact:=public.lock_generation_artwork(job.source,job.item_id);
 select coalesce(array_agg((ref->>'id')::uuid order by ordinal),'{}'::uuid[]) into refs
  from jsonb_array_elements(coalesce(artifact#>'{artwork_handoff,refs}','[]'::jsonb)) with ordinality as selected(ref,ordinal);
 -- Transaction-private transition lets the established import RPC retain all
 -- history, actor, request, campaign, reference and human review checks.
 perform public.chatgpt_job_artwork_status(job,'awaiting_import');
 outcome:=public.commit_external_artwork_import(job.source,job.item_id,job.request_id,p_path,job.requested_by,'chatgpt',refs);
 update public.chatgpt_image_jobs set state='succeeded',output_path=p_path,output_sha256=p_sha256,result=outcome,error_code=null,error=null,lease_until=null,completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
 return outcome;
end $$;

revoke all on function public.chatgpt_job_artwork_status(public.chatgpt_image_jobs,text,text),public.guard_higgsfield_chatgpt_overlap(),public.owned_chatgpt_image_job(uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.reserve_chatgpt_image_job(text,uuid,uuid,uuid),public.claim_chatgpt_image_job(uuid,uuid),public.heartbeat_chatgpt_image_job(uuid,uuid),public.dispatch_chatgpt_image_job(uuid,uuid,text),public.fail_chatgpt_image_job(uuid,uuid,text),public.complete_chatgpt_image_job(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_chatgpt_image_job(text,uuid,uuid,uuid),public.claim_chatgpt_image_job(uuid,uuid),public.heartbeat_chatgpt_image_job(uuid,uuid),public.dispatch_chatgpt_image_job(uuid,uuid,text),public.fail_chatgpt_image_job(uuid,uuid,text),public.complete_chatgpt_image_job(uuid,uuid,text,text) to service_role;
commit;
