-- One image-generated style background per five-card set. Cards still use the
-- exact Shopify photograph. Read access matches the existing Creative Studio.
begin;
create table if not exists public.carousel_sets (
  id uuid primary key,
  requested_by uuid not null references auth.users,
  category text not null,
  window_from date not null,
  window_to date not null,
  ref_ids uuid[] not null default '{}',
  background_status text not null default 'queued' check (background_status in ('queued','making','ready','failed')),
  background_path text,
  error text,
  started_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.carousel_sets enable row level security;
create policy "creative heads and admin read carousel sets" on public.carousel_sets for select to authenticated
  using (public.is_admin() or 'creative' in (select public.my_depts()));
grant select on public.carousel_sets to authenticated;
grant all on public.carousel_sets to service_role;
commit;
