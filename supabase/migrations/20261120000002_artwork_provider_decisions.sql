-- One provider is selected for each immutable artwork request before any image job is reserved.
create table public.artwork_provider_decisions (
  source text not null check (source in ('design','creative')),
  item_id uuid not null,
  request_id uuid not null,
  provider text not null check (provider in ('chatgpt','higgsfield')),
  model text,
  basis text not null check (basis in ('explicit','ai','policy','availability')),
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (source,item_id,request_id)
);
alter table public.artwork_provider_decisions enable row level security;
revoke all on public.artwork_provider_decisions from public,anon,authenticated;
grant select,insert on public.artwork_provider_decisions to service_role;
