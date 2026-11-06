-- Studio "Send for approval": a head asks the Super Admin to sign off one exact image.
-- Additive: one new table and two functions. Nothing existing changes, and the app hides the feature until this is applied.

create table if not exists public.design_approvals (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('design', 'creative')),
  item_id uuid not null,
  image_path text not null,
  title text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes', 'rejected')),
  requested_by uuid not null,
  requested_role public.app_role not null,
  request_note text check (request_note is null or char_length(request_note) <= 600),
  decided_by uuid,
  decided_role public.app_role,
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
-- One open request per image at a time; history is kept.
create unique index if not exists design_approvals_one_pending on public.design_approvals(source, item_id) where status = 'pending';
create index if not exists design_approvals_open on public.design_approvals(created_at desc) where status = 'pending';
create index if not exists design_approvals_item on public.design_approvals(source, item_id, created_at desc);

alter table public.design_approvals enable row level security;
drop policy if exists design_approvals_read on public.design_approvals;
-- The Super Admin sees every request; a head sees the ones they sent.
create policy design_approvals_read on public.design_approvals for select to authenticated
  using (public.is_admin() or requested_by = auth.uid());
-- Rows change only through the two functions below.
revoke insert, update, delete on public.design_approvals from anon, authenticated;

create or replace function public.request_design_approval(p_source text, p_item uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare actor public.app_role; img text; ttl text; existing uuid; created uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in' using errcode = '42501'; end if;
  -- the same check Studio uses for importing artwork: Super Admin, the requester, or the creative head
  actor := public.artwork_actor_role(p_source, p_item, auth.uid());
  if p_source = 'design' then
    select d.image_path, coalesce(nullif(d.headline, ''), left(d.brief, 120)) into img, ttl from public.designs d where d.id = p_item for update;
  else
    select c.image_path, coalesce(nullif(c.headline, ''), left(coalesce(c.body, ''), 120)) into img, ttl from public.creatives c where c.id = p_item for update;
  end if;
  if img is null then raise exception 'This design has no finished image yet' using errcode = '22023'; end if;
  select id into existing from public.design_approvals where source = p_source and item_id = p_item and status = 'pending';
  if existing is not null then return existing; end if;
  insert into public.design_approvals(source, item_id, image_path, title, requested_by, requested_role, request_note)
    values (p_source, p_item, img, coalesce(ttl, ''), auth.uid(), actor, nullif(trim(coalesce(p_note, '')), ''))
    returning id into created;
  return created;
end $$;

create or replace function public.decide_design_approval(p_id uuid, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare request public.design_approvals; me public.app_role;
begin
  if not public.is_admin() then raise exception 'Only the Super Admin signs off designs' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'changes', 'rejected') then raise exception 'Unknown decision %', p_decision; end if;
  if p_decision <> 'approved' and coalesce(trim(p_note), '') = '' then raise exception 'Add a note so the team knows why'; end if;
  select * into request from public.design_approvals where id = p_id for update;
  if request.id is null or request.status <> 'pending' then raise exception 'This design is not waiting on anyone'; end if;
  select role into me from public.profiles where id = auth.uid();
  update public.design_approvals
     set status = p_decision, decided_by = auth.uid(), decided_role = me,
         decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now()
   where id = p_id;
  return p_decision;
end $$;

revoke all on function public.request_design_approval(text, uuid, text) from public, anon;
revoke all on function public.decide_design_approval(uuid, text, text) from public, anon;
grant execute on function public.request_design_approval(text, uuid, text) to authenticated;
grant execute on function public.decide_design_approval(uuid, text, text) to authenticated;
