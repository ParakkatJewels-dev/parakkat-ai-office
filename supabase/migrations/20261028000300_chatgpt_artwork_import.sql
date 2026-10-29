-- Native ChatGPT images are imported as private, versioned drafts. No provider call is made by these functions.
begin;

alter table public.designs
  add column if not exists artwork_request_id uuid,
  add column if not exists artwork_handoff jsonb,
  add column if not exists artwork_origin text,
  add column if not exists imported_at timestamptz,
  add column if not exists imported_by uuid references auth.users(id) on delete set null;
alter table public.creatives
  add column if not exists artwork_request_id uuid,
  add column if not exists artwork_handoff jsonb,
  add column if not exists artwork_origin text,
  add column if not exists imported_at timestamptz,
  add column if not exists imported_by uuid references auth.users(id) on delete set null;

alter table public.carousel_sets drop constraint if exists carousel_sets_background_status_check;
alter table public.carousel_sets add constraint carousel_sets_background_status_check
  check (background_status in ('queued','making','ready','failed','unused'));

-- An old unstarted request can safely become a handoff. Unknown in-flight outcomes
-- remain untouched here; the runtime only converts them after their stale deadline.
update public.designs set status='awaiting_import', queued_at=null, artwork_request_id=gen_random_uuid(), artwork_handoff=null
  where status='queued';
update public.creatives c set art_status='awaiting_import', queued_at=null, artwork_request_id=gen_random_uuid(), artwork_handoff=null
  where art_status='queued' and not exists (select 1 from public.campaigns cp where cp.id=c.campaign_id and cp.status in ('approved','publishing','publish_review','live'));
update public.carousel_sets set background_status='unused', started_at=null where background_status='queued';

create or replace view public.ai_images with (security_invoker = true) as
  select x.source, x.id, x.kind, x.brief, x.headline, x.language, x.image_path, x.status, x.lead_note, x.error, x.created_at, x.campaign_id, x.campaign_name,
         r.verdict, r.note as review, r.reviewer_role, r.updated_at as reviewed_at, x.concept, x.ref_ids, x.versions, x.redo_note,
         x.carousel_id, x.carousel_index, x.artwork_request_id, x.artwork_origin, x.imported_at, x.imported_by
  from (
    select 'design'::text as source, d.id, d.format as kind, d.brief, d.headline, d.language, d.image_path, d.status,
           d.review_note as lead_note, d.error, d.created_at, null::uuid as campaign_id, null::text as campaign_name,
           d.concept, d.ref_ids, jsonb_array_length(d.versions) as versions, d.redo_note, d.carousel_id, d.carousel_index,
           d.artwork_request_id, d.artwork_origin, d.imported_at, d.imported_by
    from public.designs d
    union all
    select 'creative', c.id, c.kind, coalesce(c.body, ''), c.headline, c.language, c.image_path, coalesce(c.art_status, 'ready'),
           c.review_note, c.art_error, c.created_at, c.campaign_id, cp.name,
           c.concept, c.ref_ids, jsonb_array_length(c.versions), c.redo_note, null::uuid, null::smallint,
           c.artwork_request_id, c.artwork_origin, c.imported_at, c.imported_by
    from public.creatives c left join public.campaigns cp on cp.id = c.campaign_id
    where c.image_path is not null or c.art_status is not null
  ) x left join public.image_reviews r on r.source = x.source and r.item_id = x.id;

-- Internal authorization mirrors the existing requester, department and campaign read scopes.
create or replace function public.artwork_actor_role(p_source text,p_id uuid,p_user_id uuid) returns public.app_role
language plpgsql security definer set search_path=public as $$
declare actor public.app_role; allowed boolean;
begin
  select role into actor from public.profiles where id=p_user_id for share;
  if actor is null or actor='viewer' then raise exception 'An authorized department head is required'; end if;
  if p_source='design' then
    select actor='super_admin' or d.requested_by=p_user_id or exists
      (select 1 from public.departments where id='creative' and human_head_role=actor)
      into allowed from public.designs d where d.id=p_id;
  elsif p_source='creative' then
    select actor='super_admin' or exists
      (select 1 from public.approvals a where a.campaign_id=c.campaign_id and actor=any(a.required_roles))
      into allowed from public.creatives c where c.id=p_id;
  else raise exception 'Unknown artwork source'; end if;
  if allowed is distinct from true then raise exception 'That artwork is not available to this account'; end if;
  return actor;
end $$;
revoke all on function public.artwork_actor_role(text,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.commit_chatgpt_artwork_import(
  p_source text,p_id uuid,p_request_id uuid,p_path text,p_user_id uuid,p_ref_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare artifact jsonb; history jsonb; at timestamptz:=clock_timestamp(); campaign_status text; refs uuid[]:=coalesce(p_ref_ids,'{}'); cached_refs uuid[];
begin
  if p_source not in ('design','creative') or p_source is null or p_id is null or p_request_id is null then raise exception 'Invalid artwork request'; end if;
  if p_path is null or p_path !~ ('^chatgpt-imports/'||p_source||'/'||p_id::text||'/'||p_request_id::text||'/[0-9a-f-]{36}\.(png|jpg|webp)$') then
    raise exception 'The import path does not belong to this artwork request';
  end if;
  if cardinality(refs)>3 or exists (select 1 from unnest(refs) ref where ref is null or not exists
      (select 1 from public.design_refs r where r.id=ref and r.status='ready' and not r.hidden)) then
    raise exception 'The selected style references are unavailable';
  end if;
  if p_source='design' then
    select to_jsonb(d) into artifact from public.designs d where id=p_id for update;
  else
    -- Match the existing campaign freeze trigger's parent lock before locking the creative.
    select cp.status into campaign_status from public.campaigns cp
      where cp.id=(select campaign_id from public.creatives where id=p_id) for share;
    if campaign_status in ('approved','publishing','publish_review','live') then raise exception 'This campaign is approved. Its banner and copy are frozen'; end if;
    select to_jsonb(c) into artifact from public.creatives c where id=p_id for update;
  end if;
  if artifact is null then raise exception 'Artwork not found'; end if;
  perform public.artwork_actor_role(p_source,p_id,p_user_id);
  if (artifact->>case when p_source='design' then 'status' else 'art_status' end) is distinct from 'awaiting_import'
      or (artifact->>'artwork_request_id')::uuid is distinct from p_request_id then
    raise exception 'This artwork request changed. Refresh its brief before importing';
  end if;
  if artifact->'artwork_handoff' is not null and artifact->'artwork_handoff' <> 'null'::jsonb then
    if artifact#>>'{artwork_handoff,packet,requestId}' is distinct from p_request_id::text or
      jsonb_typeof(artifact#>'{artwork_handoff,refs}') is distinct from 'array' then raise exception 'The saved ChatGPT brief does not match this request'; end if;
    select coalesce(array_agg((ref->>'id')::uuid order by ordinal),'{}'::uuid[]) into cached_refs
      from jsonb_array_elements(artifact#>'{artwork_handoff,refs}') with ordinality as selected(ref,ordinal);
    if refs is distinct from cached_refs then raise exception 'The imported references do not match the saved ChatGPT brief'; end if;
  end if;
  history:=coalesce(artifact->'versions','[]'::jsonb);
  if artifact->>'image_path' is not null then
    history:=history||jsonb_build_array(jsonb_build_object('image_path',artifact->>'image_path','concept',artifact->>'concept',
      'note',artifact->>'redo_note','at',at,'artwork_origin',artifact->>'artwork_origin','imported_at',artifact->>'imported_at','imported_by',artifact->>'imported_by'));
  end if;
  if p_source='design' then
    update public.designs set image_path=p_path,status='ready',versions=history,ref_ids=refs,queued_at=null,error=null,
      artwork_origin='chatgpt_import',imported_at=at,imported_by=p_user_id,
      review_note='Imported from ChatGPT. Human review required; no automated image check was run.' where id=p_id;
  else
    update public.creatives set image_path=p_path,art_status='ready',versions=history,ref_ids=refs,queued_at=null,art_error=null,
      artwork_origin='chatgpt_import',imported_at=at,imported_by=p_user_id,
      review_note='Imported from ChatGPT. Human review required; no automated image check was run.' where id=p_id;
  end if;
  delete from public.image_reviews where source=p_source and item_id=p_id;
  return jsonb_build_object('id',p_id,'source',p_source,'status','ready','version',jsonb_array_length(history)+1,'image_path',p_path);
end $$;
revoke all on function public.commit_chatgpt_artwork_import(text,uuid,uuid,text,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.commit_chatgpt_artwork_import(text,uuid,uuid,text,uuid,uuid[]) to service_role;

-- Both review and import lock the same artwork row. A form opened for the previous
-- artifact can never approve a replacement that arrived while that form was open.
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
  if artifact->>'image_path' is null or state in ('awaiting_import','queued','making') then raise exception 'Import the finished artwork before reviewing it'; end if;
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
    if NEW.art_status in ('queued','making','awaiting_import') or
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
    if exists (select 1 from public.creatives where campaign_id=NEW.id and art_status in ('queued','making','awaiting_import')) then
      raise exception 'Wait for the banner import or redesign to finish before final approval';
    end if;
    if exists (select 1 from public.creatives c where c.campaign_id=NEW.id and c.artwork_origin='chatgpt_import' and
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
revoke all on function public.guard_approved_campaign_artwork(),public.guard_campaign_artwork_approval() from public,anon,authenticated;
commit;
