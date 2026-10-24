-- Keeps syncs from overlapping and lets a big store sync in several runs.
-- job_locks: a lease per job; a second sync started while one holds the lease is turned away until it ends or expires.
-- sync_cursors: where the last run stopped, so the next one carries on instead of starting over.
-- Only the server (service role) touches either.
create table if not exists job_locks (
  name text primary key,
  holder text not null,
  until timestamptz not null
);
create table if not exists sync_cursors (
  name text primary key,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table job_locks enable row level security;
alter table sync_cursors enable row level security;
revoke all on job_locks, sync_cursors from public, anon, authenticated;
grant all on job_locks, sync_cursors to service_role;

-- true when p_holder now has the lease; false while someone else's lease is still running
create or replace function acquire_job_lock(p_name text, p_holder text, p_seconds int) returns boolean
  language sql security definer set search_path = public
  as $$
  with got as (
    insert into job_locks as l (name, holder, until) values (p_name, p_holder, now() + make_interval(secs => p_seconds))
    on conflict (name) do update set holder = excluded.holder, until = excluded.until where l.until < now()
    returning 1)
  select exists (select 1 from got)
$$;

create or replace function release_job_lock(p_name text, p_holder text) returns void
  language sql security definer set search_path = public
  as $$ delete from job_locks where name = p_name and holder = p_holder $$;

revoke execute on function acquire_job_lock(text, text, int), release_job_lock(text, text) from public, anon, authenticated;
grant execute on function acquire_job_lock(text, text, int), release_job_lock(text, text) to service_role;
