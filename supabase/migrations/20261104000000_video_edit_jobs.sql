-- A local editing computer claims work here; source media and exports stay on it.
update public.agents set role_desc = 'Edits and exports video on the editing computer',
  model = 'Claude Code + DaVinci Resolve Studio' where id = 'videoEditor';

create table public.video_edit_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  agent_id text not null default 'videoEditor' references public.agents(id) check (agent_id = 'videoEditor'),
  brief text not null check (char_length(btrim(brief)) between 1 and 6000),
  source_folder text not null check (char_length(btrim(source_folder)) between 1 and 240),
  output_name text not null check (char_length(btrim(output_name)) between 1 and 120),
  status text not null default 'queued' check (status in ('queued','running','review','failed','cancelled')),
  progress text,
  worker_id text,
  claim_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 10),
  project_path text,
  export_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (created_by, client_id)
);
create index video_edit_jobs_queue on public.video_edit_jobs(created_at) where status = 'queued';
create index video_edit_jobs_owner on public.video_edit_jobs(created_by, created_at desc);
alter table public.video_edit_jobs enable row level security;
create policy "video jobs visible to creator and creative heads" on public.video_edit_jobs
  for select to authenticated using (
    auth.uid() = created_by or public.is_admin() or
    (public.my_role() <> 'viewer' and exists (
      select 1 from public.departments d where d.id = 'reels' and d.human_head_role = public.my_role()
    ))
  );
revoke all on public.video_edit_jobs from public, anon, authenticated, service_role;
grant select on public.video_edit_jobs to authenticated;
grant all on public.video_edit_jobs to service_role;

-- The worker uses the service-only endpoint. Claiming is atomic even with two workers.
create or replace function public.claim_video_edit_job(p_worker_id text)
returns setof public.video_edit_jobs language plpgsql security definer set search_path = public as $$
declare picked public.video_edit_jobs%rowtype;
begin
  if length(btrim(coalesce(p_worker_id,''))) not between 1 and 80 then
    raise exception 'Invalid worker id';
  end if;
  select * into picked from public.video_edit_jobs
    where status = 'queued' order by created_at, id for update skip locked limit 1;
  if not found then return; end if;
  update public.video_edit_jobs set status = 'running', worker_id = p_worker_id,
    claim_token = gen_random_uuid(), lease_until = now() + interval '3 minutes',
    attempts = attempts + 1, progress = 'Picked up by editing computer', updated_at = now(), error = null
    where id = picked.id returning * into picked;
  return next picked;
end $$;
revoke all on function public.claim_video_edit_job(text) from public, anon, authenticated, service_role;
grant execute on function public.claim_video_edit_job(text) to service_role;
