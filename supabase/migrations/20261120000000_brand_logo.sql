-- The current, administrator-approved logo is private. Artwork files retain the
-- exact logo version used when they were rendered.
create table public.brand_logo (
  id integer primary key default 1 check (id = 1),
  path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.brand_logo enable row level security;
revoke all on public.brand_logo from public, anon, authenticated;
grant select, insert, update on public.brand_logo to service_role;
