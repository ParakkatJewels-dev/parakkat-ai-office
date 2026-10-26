-- Design library: Parakkat's past designs, read from Google Drive, so the designers start from that level of work
-- and vary it instead of drawing the same banner every time. Also a redesign queue for any AI image.

-- 1. Drive folders the Super Admin picked. Subfolders found while scanning get their own row under the same root.
create table if not exists design_library_folders (
  id text primary key,                    -- Google Drive folder id
  root_id text not null,                  -- the folder that was picked; equals id for a picked folder
  name text not null,
  added_by uuid references auth.users on delete set null,
  page_token text,                        -- where the current scan of this folder stopped
  scanned_at timestamptz,                 -- when the last full pass of this folder finished
  files integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists design_library_folders_root on design_library_folders (root_id);
create index if not exists design_library_folders_due on design_library_folders (scanned_at nulls first);
alter table design_library_folders enable row level security;
create policy "creative heads and admin read" on design_library_folders for select using (is_admin() or 'creative' in (select my_depts()));
grant select on design_library_folders to authenticated;
grant all on design_library_folders to service_role;

-- 2. One row per past design. The describer fills occasion, style, palette, layout and tags from the image itself.
create table if not exists design_refs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'drive',   -- drive
  drive_id text unique,
  folder_id text references design_library_folders on delete cascade,
  name text not null,
  mime text,
  modified_at timestamptz,
  image_path text,                        -- a copy, sized for the model, in the creatives bucket (library/...)
  status text not null default 'new',     -- new | ready | skipped | failed
  error text,
  kind text,                              -- post | story | banner | poster | other
  occasion text,
  style text,
  palette text,
  layout text,
  typography text,
  tags text[] not null default '{}',
  quality smallint,                       -- 1 to 5, the describer's view of the finish
  pinned boolean not null default false,  -- a head wants this one used more
  hidden boolean not null default false,  -- a head never wants this one used
  uses integer not null default 0,
  last_used_at timestamptz,
  search tsvector,
  created_at timestamptz not null default now()
);
create index if not exists design_refs_new on design_refs (created_at) where status = 'new';
create index if not exists design_refs_ready on design_refs (status, hidden, created_at desc);
create index if not exists design_refs_search on design_refs using gin (search);
alter table design_refs enable row level security;
create policy "creative heads and admin read" on design_refs for select using (is_admin() or 'creative' in (select my_depts()));
grant select on design_refs to authenticated;
grant all on design_refs to service_role;

create or replace function design_refs_search() returns trigger language plpgsql as $$
begin
  new.search := to_tsvector('simple', concat_ws(' ', new.name, new.kind, new.occasion, new.style, new.palette, new.layout, new.typography, array_to_string(new.tags, ' ')));
  return new;
end $$;
drop trigger if exists design_refs_search on design_refs;
create trigger design_refs_search before insert or update of name, kind, occasion, style, palette, layout, typography, tags on design_refs
  for each row execute function design_refs_search();

-- The references for one design: the closest matches to the brief, with pinned and well-finished ones first,
-- recently used ones pushed back and a little chance mixed in, so two banners for the same occasion still differ.
create or replace function pick_design_refs(p_query text, p_limit integer default 3, p_exclude uuid[] default '{}')
returns setof design_refs language sql volatile security invoker set search_path = public as $$
  with q as (select case when coalesce(p_query, '') = '' then null else websearch_to_tsquery('simple', p_query) end as t)
  select r.* from design_refs r, q
  where r.status = 'ready' and not r.hidden and r.image_path is not null and not (r.id = any (coalesce(p_exclude, '{}')))
  order by (case when q.t is null then 0 when r.search @@ q.t then 3 + ts_rank(r.search, q.t) * 10 else 0 end)
    + (case when r.pinned then 2 else 0 end) + coalesce(r.quality, 3) * 0.4
    - (case when r.last_used_at > now() - interval '3 days' then 1.5 else 0 end)
    + random() * 1.5 desc
  limit greatest(1, least(coalesce(p_limit, 3), 6));
$$;
grant execute on function pick_design_refs(text, integer, uuid[]) to service_role;

create or replace function mark_design_refs_used(p_ids uuid[]) returns void language sql security invoker set search_path = public as $$
  update design_refs set uses = uses + 1, last_used_at = now() where id = any (p_ids);
$$;
grant execute on function mark_design_refs_used(uuid[]) to service_role;
revoke execute on function pick_design_refs(text, integer, uuid[]) from public, anon, authenticated;
revoke execute on function mark_design_refs_used(uuid[]) from public, anon, authenticated;

-- 3. What each AI image was built from, its earlier versions, and the redesign queue.
alter table designs add column if not exists concept text;
alter table designs add column if not exists ref_ids uuid[] not null default '{}';
alter table designs add column if not exists versions jsonb not null default '[]';
alter table designs add column if not exists redo_note text;
alter table designs add column if not exists queued_at timestamptz;

alter table creatives add column if not exists format text not null default 'post';
alter table creatives add column if not exists concept text;
alter table creatives add column if not exists ref_ids uuid[] not null default '{}';
alter table creatives add column if not exists versions jsonb not null default '[]';
alter table creatives add column if not exists redo_note text;
alter table creatives add column if not exists queued_at timestamptz;
alter table creatives add column if not exists art_status text;     -- null | queued | making | ready | needs_fix | failed
alter table creatives add column if not exists review_note text;    -- the AI team lead's check
alter table creatives add column if not exists art_error text;

create index if not exists designs_queue on designs (queued_at) where status in ('queued', 'making');
create index if not exists creatives_queue on creatives (queued_at) where art_status in ('queued', 'making');

-- the gallery's list gains the concept, the version count and the queue state
drop view if exists ai_images;
create view ai_images with (security_invoker = true) as
  select x.*, r.verdict, r.note as review, r.reviewer_role, r.updated_at as reviewed_at
  from (
    select 'design'::text as source, d.id, d.format as kind, d.brief, d.headline, d.language, d.image_path, d.status,
           d.review_note as lead_note, d.error, d.created_at, null::uuid as campaign_id, null::text as campaign_name,
           d.concept, d.ref_ids, jsonb_array_length(d.versions) as versions, d.redo_note
    from designs d
    union all
    select 'creative', c.id, c.kind, coalesce(c.body, ''), c.headline, c.language, c.image_path, coalesce(c.art_status, 'ready'),
           c.review_note, c.art_error, c.created_at, c.campaign_id, cp.name,
           c.concept, c.ref_ids, jsonb_array_length(c.versions), c.redo_note
    from creatives c left join campaigns cp on cp.id = c.campaign_id
    where c.image_path is not null or c.art_status is not null
  ) x left join image_reviews r on r.source = x.source and r.item_id = x.id;
grant select on ai_images to authenticated;
