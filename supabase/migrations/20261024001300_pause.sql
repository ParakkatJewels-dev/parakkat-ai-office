-- The Super Admin's pause switch. While paused, the agents make no AI or API calls and publish nothing.
create table if not exists system_state (
  id int primary key default 1 check (id = 1),
  paused boolean not null default false,
  paused_at timestamptz,
  paused_by uuid references auth.users on delete set null,
  reason text
);
insert into system_state (id) values (1) on conflict do nothing;
alter table system_state enable row level security;
-- everyone signed in sees whether the office is paused (for the banner); only the server changes it
create policy "signed in read" on system_state for select using (auth.uid() is not null);
revoke all on system_state from anon;
grant select on system_state to authenticated;
grant all on system_state to service_role;
