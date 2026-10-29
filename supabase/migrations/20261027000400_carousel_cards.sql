-- Five-card Studio sets keep their source snapshot and remain under the existing
-- creative-head read policy. No provider credential or new browser permission is exposed.
begin;
alter table public.designs add column if not exists carousel_id uuid;
alter table public.designs add column if not exists carousel_index smallint;
alter table public.designs add column if not exists carousel_source jsonb;
alter table public.designs add constraint designs_carousel_index_check
  check (carousel_index is null or carousel_index between 1 and 5);
create unique index if not exists designs_carousel_card on public.designs (carousel_id, carousel_index)
  where carousel_id is not null;

create or replace view public.ai_images with (security_invoker = true) as
  select x.source, x.id, x.kind, x.brief, x.headline, x.language, x.image_path, x.status, x.lead_note, x.error, x.created_at, x.campaign_id, x.campaign_name,
         r.verdict, r.note as review, r.reviewer_role, r.updated_at as reviewed_at, x.concept, x.ref_ids, x.versions, x.redo_note,
         x.carousel_id, x.carousel_index
  from (
    select 'design'::text as source, d.id, d.format as kind, d.brief, d.headline, d.language, d.image_path, d.status,
           d.review_note as lead_note, d.error, d.created_at, null::uuid as campaign_id, null::text as campaign_name,
           d.concept, d.ref_ids, jsonb_array_length(d.versions) as versions, d.redo_note, d.carousel_id, d.carousel_index
    from public.designs d
    union all
    select 'creative', c.id, c.kind, coalesce(c.body, ''), c.headline, c.language, c.image_path, coalesce(c.art_status, 'ready'),
           c.review_note, c.art_error, c.created_at, c.campaign_id, cp.name,
           c.concept, c.ref_ids, jsonb_array_length(c.versions), c.redo_note, null::uuid, null::smallint
    from public.creatives c left join public.campaigns cp on cp.id = c.campaign_id
    where c.image_path is not null or c.art_status is not null
  ) x left join public.image_reviews r on r.source = x.source and r.item_id = x.id;
grant select on public.ai_images to authenticated;
commit;
