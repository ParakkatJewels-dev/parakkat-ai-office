-- When each background job of the agents last ran, so the every-minute tick knows which one is due.
create table if not exists autopilot_jobs (
  name text primary key,
  last_run_at timestamptz,
  last_result text
);
alter table autopilot_jobs enable row level security;
create policy "signed-in read" on autopilot_jobs for select using (auth.uid() is not null);
grant select on autopilot_jobs to authenticated;
grant all on autopilot_jobs to service_role;
