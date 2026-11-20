create table public.chatgpt_image_worker_health (
  id boolean primary key default true check (id),
  ready boolean not null,
  checked_at timestamptz not null default now()
);
alter table public.chatgpt_image_worker_health enable row level security;
revoke all on public.chatgpt_image_worker_health from public,anon,authenticated;
grant select,insert,update on public.chatgpt_image_worker_health to service_role;
