-- Department-scoped, versioned instructions. No existing agent or business data is rewritten.
create table public.agent_instructions (
  agent_id text primary key references public.agents(id),
  instructions text not null check (char_length(instructions) <= 6000),
  revision integer not null check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.agent_instruction_history (
  id bigint generated always as identity primary key,
  agent_id text not null references public.agents(id),
  instructions text not null check (char_length(instructions) <= 6000),
  old_revision integer not null check (old_revision >= 0),
  revision integer not null check (revision = old_revision + 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (agent_id, revision)
);

alter table public.agent_instructions enable row level security;
alter table public.agent_instruction_history enable row level security;

create policy "heads read their agent instructions" on public.agent_instructions for select to authenticated
using (auth.uid() is not null and public.my_role() <> 'viewer' and exists (
  select 1 from public.agents a join public.departments d on d.id = a.department_id
  where a.id = agent_instructions.agent_id and (public.is_admin() or d.human_head_role = public.my_role())
));
create policy "heads read their instruction history" on public.agent_instruction_history for select to authenticated
using (auth.uid() is not null and public.my_role() <> 'viewer' and exists (
  select 1 from public.agents a join public.departments d on d.id = a.department_id
  where a.id = agent_instruction_history.agent_id and (public.is_admin() or d.human_head_role = public.my_role())
));

-- Revoke Supabase's default table privileges too: all changes go through the authenticated RPC.
revoke all on public.agent_instructions, public.agent_instruction_history from public, anon, authenticated, service_role;
revoke all on sequence public.agent_instruction_history_id_seq from public, anon, authenticated, service_role;
grant select on public.agent_instructions, public.agent_instruction_history to authenticated, service_role;

create or replace function public.save_agent_instructions(
  p_agent_id text, p_instructions text, p_expected_revision integer
) returns public.agent_instructions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  actor uuid := auth.uid();
  actor_role public.app_role;
  department text;
  head_role public.app_role;
  clean_text text;
  previous_revision integer;
  saved public.agent_instructions;
begin
  -- Keep the authorized role stable until commit; concurrent role revocation waits for this save.
  select p.role into actor_role from public.profiles p where p.id = actor for share;
  if actor is null or actor_role is null or actor_role = 'viewer' then
    raise exception 'You cannot edit agent instructions' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'A non-negative expected revision is required' using errcode = '22023';
  end if;
  if p_instructions is null then
    raise exception 'Instructions must be text; use an empty string to clear them' using errcode = '22023';
  end if;
  clean_text := regexp_replace(p_instructions, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if char_length(clean_text) > 6000 then
    raise exception 'Agent instructions must be at most 6000 characters' using errcode = '22023';
  end if;

  -- Lock an existing parent even before the first instruction row exists, so simultaneous
  -- expected-revision-zero inserts serialize. Each call edits only one agent.
  select a.department_id into department from public.agents a where a.id = p_agent_id for update;
  if not found then
    raise exception 'Agent not found' using errcode = 'P0002';
  end if;
  -- A head reassignment cannot commit midway through the authorization and save.
  select d.human_head_role into head_role from public.departments d where d.id = department for share;
  if actor_role <> 'super_admin' and actor_role is distinct from head_role then
    raise exception 'You cannot edit instructions for this department' using errcode = '42501';
  end if;

  select i.revision into previous_revision from public.agent_instructions i where i.agent_id = p_agent_id;
  previous_revision := coalesce(previous_revision, 0);
  if p_expected_revision <> previous_revision then
    raise exception 'Agent instructions changed. Reload the latest revision before saving.' using errcode = '40001';
  end if;

  insert into public.agent_instructions as i (agent_id, instructions, revision, updated_at, updated_by)
    values (p_agent_id, clean_text, previous_revision + 1, now(), actor)
    on conflict (agent_id) do update set instructions = excluded.instructions,
      revision = excluded.revision, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    returning i.* into saved;
  insert into public.agent_instruction_history (agent_id, instructions, old_revision, revision, updated_at, updated_by)
    values (saved.agent_id, saved.instructions, previous_revision, saved.revision, saved.updated_at, actor);
  return saved;
end $$;

revoke all on function public.save_agent_instructions(text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.save_agent_instructions(text, text, integer) to authenticated;
notify pgrst, 'reload schema';
