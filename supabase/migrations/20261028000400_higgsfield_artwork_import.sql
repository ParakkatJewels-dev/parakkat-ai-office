-- Manual website imports from ChatGPT and Higgsfield share the same private review lifecycle.
-- Provider is selected by the uploader; it is provenance metadata, not a verified model signature.
begin;

create or replace function public.commit_external_artwork_import(
  p_source text,p_id uuid,p_request_id uuid,p_path text,p_user_id uuid,p_provider text,p_ref_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare artifact jsonb; history jsonb; at timestamptz:=clock_timestamp(); campaign_status text; refs uuid[]:=coalesce(p_ref_ids,'{}'); cached_refs uuid[];
begin
  if p_provider is null or p_provider not in ('chatgpt','higgsfield') then raise exception 'Unknown artwork provider'; end if;
  if p_source not in ('design','creative') or p_source is null or p_id is null or p_request_id is null then raise exception 'Invalid artwork request'; end if;
  if p_path is null or p_path !~ ('^'||p_provider||'-imports/'||p_source||'/'||p_id::text||'/'||p_request_id::text||'/[0-9a-f-]{36}\.(png|jpg|webp)$') then
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
      jsonb_typeof(artifact#>'{artwork_handoff,refs}') is distinct from 'array' then raise exception 'The saved artwork brief does not match this request'; end if;
    select coalesce(array_agg((ref->>'id')::uuid order by ordinal),'{}'::uuid[]) into cached_refs
      from jsonb_array_elements(artifact#>'{artwork_handoff,refs}') with ordinality as selected(ref,ordinal);
    if refs is distinct from cached_refs then raise exception 'The imported references do not match the saved artwork brief'; end if;
  end if;
  history:=coalesce(artifact->'versions','[]'::jsonb);
  if artifact->>'image_path' is not null then
    history:=history||jsonb_build_array(jsonb_build_object('image_path',artifact->>'image_path','concept',artifact->>'concept',
      'note',artifact->>'redo_note','at',at,'artwork_origin',artifact->>'artwork_origin','imported_at',artifact->>'imported_at','imported_by',artifact->>'imported_by'));
  end if;
  if p_source='design' then
    update public.designs set image_path=p_path,status='ready',versions=history,ref_ids=refs,queued_at=null,error=null,
      artwork_origin=p_provider||'_import',imported_at=at,imported_by=p_user_id,
      review_note='Imported from '||(case when p_provider='higgsfield' then 'Higgsfield' else 'ChatGPT' end)||'. Human review required; no automated image check was run.' where id=p_id;
  else
    update public.creatives set image_path=p_path,art_status='ready',versions=history,ref_ids=refs,queued_at=null,art_error=null,
      artwork_origin=p_provider||'_import',imported_at=at,imported_by=p_user_id,
      review_note='Imported from '||(case when p_provider='higgsfield' then 'Higgsfield' else 'ChatGPT' end)||'. Human review required; no automated image check was run.' where id=p_id;
  end if;
  delete from public.image_reviews where source=p_source and item_id=p_id;
  return jsonb_build_object('id',p_id,'source',p_source,'status','ready','version',jsonb_array_length(history)+1,'image_path',p_path,'provider',p_provider);
end $$;
revoke all on function public.commit_external_artwork_import(text,uuid,uuid,text,uuid,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.commit_external_artwork_import(text,uuid,uuid,text,uuid,text,uuid[]) to service_role;

-- Keep already-open ChatGPT forms and the previous release compatible during rollout.
create or replace function public.commit_chatgpt_artwork_import(
  p_source text,p_id uuid,p_request_id uuid,p_path text,p_user_id uuid,p_ref_ids uuid[] default '{}'
) returns jsonb language sql security definer set search_path=public as $$
  select public.commit_external_artwork_import(p_source,p_id,p_request_id,p_path,p_user_id,'chatgpt',p_ref_ids);
$$;
revoke all on function public.commit_chatgpt_artwork_import(text,uuid,uuid,text,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.commit_chatgpt_artwork_import(text,uuid,uuid,text,uuid,uuid[]) to service_role;

create or replace function public.guard_campaign_artwork_approval() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if NEW.status='approved' and OLD.status is distinct from NEW.status then
    if exists (select 1 from public.creatives where campaign_id=NEW.id and art_status in ('queued','making','awaiting_import')) then
      raise exception 'Wait for the banner import or redesign to finish before final approval';
    end if;
    if exists (select 1 from public.creatives c where c.campaign_id=NEW.id and c.artwork_origin in ('chatgpt_import','higgsfield_import') and
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
