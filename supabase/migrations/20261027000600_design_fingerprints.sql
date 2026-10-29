-- Preserve a reusable description of each studied design. The imported preview
-- is removed through the Storage API after the description is committed.
begin;
alter table public.design_refs add column if not exists fingerprint jsonb;
update public.design_refs
set fingerprint = jsonb_build_object(
  'visualBrief', coalesce(style,''),
  'composition', coalesce(layout,''),
  'palette', coalesce(palette,''),
  'lighting', '',
  'materials', '',
  'typography', coalesce(typography,''),
  'productionNotes', concat_ws(' ', nullif(style,''), nullif(layout,'')),
  'avoid', 'Use only the art direction; do not copy the original jewellery or words.'
)
where status = 'ready' and fingerprint is null;
alter table public.design_refs add constraint design_refs_fingerprint_object
  check (fingerprint is null or jsonb_typeof(fingerprint) = 'object');
create or replace function public.pick_design_refs(p_query text, p_limit integer default 3, p_exclude uuid[] default '{}')
returns setof public.design_refs language sql volatile security invoker set search_path = public as $$
  with q as (select case when coalesce(p_query, '') = '' then null else websearch_to_tsquery('simple', p_query) end as t)
  select r.* from public.design_refs r, q
  where r.status = 'ready' and not r.hidden and r.fingerprint is not null and not (r.id = any (coalesce(p_exclude, '{}')))
  order by (case when q.t is null then 0 when r.search @@ q.t then 3 + ts_rank(r.search, q.t) * 10 else 0 end)
    + (case when r.pinned then 2 else 0 end) + coalesce(r.quality, 3) * 0.4
    - (case when r.last_used_at > now() - interval '3 days' then 1.5 else 0 end)
    + random() * 1.5 desc
  limit greatest(1, least(coalesce(p_limit, 3), 6));
$$;
revoke execute on function public.pick_design_refs(text, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.pick_design_refs(text, integer, uuid[]) to service_role;
commit;
