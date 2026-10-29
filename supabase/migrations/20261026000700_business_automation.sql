-- Durable business workflows. Provider credentials and customer conversations are not
-- stored in public map events. The signed-in API authorizes mutations before using
-- the service role; browser clients have scoped read access only.
create table public.automation_tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('briefing', 'data_quality', 'campaign', 'inventory', 'customer', 'catalogue', 'advertising', 'follow_up')),
  department_id text not null references public.departments(id),
  owner_agent text not null references public.agents(id),
  created_by uuid references auth.users(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 180),
  brief text not null default '' check (char_length(brief) <= 6000),
  priority integer not null default 2 check (priority between 1 and 3),
  status text not null default 'queued' check (status in ('queued', 'running', 'blocked', 'review', 'completed', 'cancelled', 'failed')),
  input jsonb not null default '{}',
  state jsonb not null default '{}',
  result jsonb,
  source_key text unique,
  parent_id uuid references public.automation_tasks(id) on delete set null,
  depends_on uuid[] not null default '{}',
  due_at timestamptz,
  next_run_at timestamptz not null default now(),
  claimed_by uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  revision integer not null default 1 check (revision > 0),
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is distinct from id),
  check (not (id = any(depends_on))),
  check (array_position(depends_on, null) is null)
);
create index automation_tasks_scope on public.automation_tasks(department_id, created_at desc);
create index automation_tasks_queue on public.automation_tasks(priority, next_run_at, created_at) where status = 'queued';
create index automation_tasks_leases on public.automation_tasks(lease_until) where status = 'running';
create index automation_tasks_parent on public.automation_tasks(parent_id) where parent_id is not null;

create table public.automation_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.automation_tasks(id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 64),
  agent_id text references public.agents(id),
  text text not null check (char_length(text) <= 6000),
  created_at timestamptz not null default now()
);
create index automation_events_task on public.automation_events(task_id, id);

-- Inserting this unique row is the execution claim, before any provider mutation.
-- An uncertain provider outcome remains under review; it is not a retry ticket.
create table public.automation_actions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.automation_tasks(id) on delete cascade,
  action_index integer not null check (action_index >= 0),
  kind text not null check (char_length(kind) between 1 and 100),
  status text not null default 'executing' check (status in ('executing', 'completed', 'review', 'failed')),
  requested_by uuid references auth.users(id) on delete set null,
  payload jsonb not null,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (task_id, action_index)
);

create function public.automation_action_payload_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.task_id is distinct from old.task_id or new.action_index is distinct from old.action_index
    or new.kind is distinct from old.kind or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at then
    raise exception 'An execution claim and its approved payload cannot be changed' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger automation_action_payload_guard before update on public.automation_actions
for each row execute function public.automation_action_payload_guard();

create table public.automation_schedules (
  kind text primary key check (kind in ('briefing', 'data_quality', 'inventory', 'catalogue', 'advertising')),
  enabled boolean not null default false,
  cadence_hours integer not null check (cadence_hours between 6 and 168),
  local_hour integer not null default 9 check (local_hour between 0 and 23),
  last_queued_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.automation_schedules(kind, cadence_hours) values
  ('briefing', 24), ('data_quality', 6), ('inventory', 24), ('catalogue', 24), ('advertising', 6);

create table public.automation_settings (
  id integer primary key default 1 check (id = 1),
  inventory_rules jsonb not null default '{}',
  customer_channel text not null default 'unconfigured' check (customer_channel in ('unconfigured', 'manual', 'whatsapp', 'instagram', 'email')),
  updated_at timestamptz not null default now()
);
insert into public.automation_settings(id) values (1);

create table public.automation_inquiries (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('manual', 'whatsapp', 'instagram', 'email')),
  external_id text,
  contact_name text not null default '' check (char_length(contact_name) <= 200),
  contact_ref text not null default '' check (char_length(contact_ref) <= 300),
  body text not null check (char_length(body) between 1 and 6000),
  consent boolean not null default false,
  status text not null default 'new' check (status in ('new', 'drafting', 'review', 'replied', 'closed')),
  task_id uuid references public.automation_tasks(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_id)
);
create index automation_inquiries_status on public.automation_inquiries(status, created_at);

create function public.automation_task_revision() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end $$;
create trigger automation_task_revision before update on public.automation_tasks
for each row execute function public.automation_task_revision();

create function public.automation_updated_at() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger automation_schedules_updated before update on public.automation_schedules
for each row execute function public.automation_updated_at();
create trigger automation_settings_updated before update on public.automation_settings
for each row execute function public.automation_updated_at();
create trigger automation_inquiries_updated before update on public.automation_inquiries
for each row execute function public.automation_updated_at();

alter table public.automation_tasks enable row level security;
alter table public.automation_events enable row level security;
alter table public.automation_actions enable row level security;
alter table public.automation_schedules enable row level security;
alter table public.automation_settings enable row level security;
alter table public.automation_inquiries enable row level security;

create policy "heads read department automation tasks" on public.automation_tasks for select to authenticated
using (auth.uid() is not null and public.my_role() <> 'viewer' and exists (
  select 1 from public.departments d where d.id = automation_tasks.department_id
  and (public.is_admin() or d.human_head_role = public.my_role())
));
create policy "heads read department automation events" on public.automation_events for select to authenticated
using (exists (select 1 from public.automation_tasks t where t.id = automation_events.task_id));
create policy "heads read department automation actions" on public.automation_actions for select to authenticated
using (exists (select 1 from public.automation_tasks t where t.id = automation_actions.task_id));
create policy "admin reads automation schedules" on public.automation_schedules for select to authenticated
using (auth.uid() is not null and public.is_admin());
create policy "admin reads automation settings" on public.automation_settings for select to authenticated
using (auth.uid() is not null and public.is_admin());
create policy "crm head reads customer inquiries" on public.automation_inquiries for select to authenticated
using (auth.uid() is not null and public.my_role() <> 'viewer' and (
  public.is_admin() or exists (
    select 1 from public.departments d where d.id = 'crm' and d.human_head_role = public.my_role()
  )
));

-- Explicitly replace Supabase's default grants so clients cannot forge a task,
-- result, customer consent, completion, schedule, or lease.
revoke all on public.automation_tasks, public.automation_events, public.automation_actions, public.automation_schedules,
  public.automation_settings, public.automation_inquiries from public, anon, authenticated, service_role;
revoke all on sequence public.automation_events_id_seq from public, anon, authenticated, service_role;
grant select on public.automation_tasks, public.automation_events, public.automation_actions, public.automation_schedules,
  public.automation_settings, public.automation_inquiries to authenticated;
grant all on public.automation_tasks, public.automation_events, public.automation_schedules,
  public.automation_settings, public.automation_inquiries to service_role;
grant usage, select on sequence public.automation_events_id_seq to service_role;
-- Claims are retained so deleting an attempt cannot silently permit a repeated action.
grant select, insert, update on public.automation_actions to service_role;
revoke all on function public.automation_task_revision(), public.automation_updated_at(),
  public.automation_action_payload_guard() from public, anon, authenticated;

-- Returns zero or one row. A reclaim changes both holder and revision. Every
-- runner checkpoint must match id + status=running + claimed_by + unexpired
-- lease (and expected revision when needed), so a stale worker cannot finish
-- another worker's task. External actions require their own durable checkpoint.
create function public.claim_automation_task(p_holder uuid, p_seconds integer default 240)
returns setof public.automation_tasks
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_holder is null or p_seconds is null or p_seconds < 30 or p_seconds > 270 then
    raise exception 'A worker ID and a lease between 30 and 270 seconds are required' using errcode = '22023';
  end if;
  return query
  with candidate as (
    select t.id from public.automation_tasks t
    where t.next_run_at <= now()
      and (t.status = 'queued' or (t.status = 'running' and t.lease_until <= now()))
      and not exists (
        select 1 from unnest(t.depends_on) as dependency(id)
        where not exists (
          select 1 from public.automation_tasks finished
          where finished.id = dependency.id and finished.status = 'completed'
        )
      )
    order by t.priority, t.created_at, t.id
    for update of t skip locked
    limit 1
  )
  update public.automation_tasks t set
    status = 'running', claimed_by = p_holder,
    lease_until = now() + make_interval(secs => p_seconds),
    attempts = t.attempts + 1, started_at = coalesce(t.started_at, now()),
    finished_at = null, error = null
  from candidate c where t.id = c.id returning t.*;
end $$;
revoke all on function public.claim_automation_task(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_automation_task(uuid, integer) to service_role;

-- A campaign can be requested again after a crash without creating a second run.
alter table public.agent_runs add column automation_task_id uuid references public.automation_tasks(id) on delete set null;
create unique index agent_runs_automation_task on public.agent_runs(automation_task_id) where automation_task_id is not null;

notify pgrst, 'reload schema';
