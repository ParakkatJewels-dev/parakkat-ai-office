-- Keep approved logo files immutable. The existing brand_logo singleton chooses
-- the default used by new artwork and preserves the current generation contract.
create table public.brand_logo_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index brand_logo_assets_sha256_idx on public.brand_logo_assets (sha256);
insert into public.brand_logo_assets (name, path, sha256, created_at, created_by)
select 'Previously active logo', path, sha256, updated_at, updated_by
from public.brand_logo where id = 1
on conflict (path) do nothing;
alter table public.brand_logo_assets enable row level security;
revoke all on public.brand_logo_assets from public, anon, authenticated;
grant select, insert on public.brand_logo_assets to service_role;

alter table public.designs add column artwork_logo_id uuid references public.brand_logo_assets(id);
alter table public.creatives add column artwork_logo_id uuid references public.brand_logo_assets(id);
