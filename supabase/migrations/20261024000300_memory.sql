-- Learning memory: what the heads taught the agents, and the house rules every agent reads.

-- A lesson is a head's note on a decision, kept for the department it was about. Agents in that department
-- read their latest lessons before they work. The Super Admin can add lessons by hand or retire old ones.
create table lessons (
  id uuid primary key default gen_random_uuid(),
  department_id text not null references departments,
  source text not null,                   -- report | plan | manual
  source_id uuid,
  decision text,                          -- accepted | sent_back | rejected | approve | changes | reject
  lesson text not null,
  by_role app_role,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index lessons_dept on lessons (department_id, created_at desc) where active;
alter table lessons enable row level security;
create policy "my departments' lessons" on lessons for select using (is_admin() or department_id in (select my_depts()));

-- One brand book for the whole company.
create table brand_book (
  id integer primary key default 1 check (id = 1),
  voice text not null default '',          -- how we sound
  always text not null default '',         -- words, claims and details to always use
  never text not null default '',          -- words, offers and claims to never use
  notes text not null default '',          -- anything else: audiences, seasons, store facts
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users
);
insert into brand_book (id) values (1) on conflict do nothing;
alter table brand_book enable row level security;
create policy "signed-in read" on brand_book for select using (auth.uid() is not null);

-- A head's note on a report becomes a lesson for that report's department.
create or replace function learn_from_report() returns trigger
  language plpgsql security definer set search_path = public
  as $$ begin
  if new.status in ('accepted', 'sent_back', 'rejected') and new.status is distinct from old.status and coalesce(trim(new.head_note), '') <> '' then
    insert into lessons (department_id, source, source_id, decision, lesson, by_role)
      values (new.department_id, 'report', new.id, new.status::text,
              case new.status when 'accepted' then 'Liked' when 'sent_back' then 'Sent back' else 'Rejected' end || ' "' || new.title || '": ' || new.head_note,
              (select role from profiles where id = new.decided_by));
  end if;
  return new;
end $$;
create trigger reports_learn after update on reports for each row execute function learn_from_report();

-- A head's note on a campaign plan becomes a lesson for the team that head looks after in planning.
create or replace function learn_from_plan() returns trigger
  language plpgsql security definer set search_path = public
  as $$ declare plan_name text; begin
  if coalesce(trim(new.note), '') <> '' then
    select c.name into plan_name from approvals a join campaigns c on c.id = a.campaign_id where a.id = new.approval_id;
    insert into lessons (department_id, source, source_id, decision, lesson, by_role)
      values (case new.role when 'creative_head' then 'creative' when 'perf_marketer' then 'perf' when 'ecom_manager' then 'strategy' else 'board' end,
              'plan', new.approval_id, new.decision,
              case new.decision when 'approve' then 'Approved' when 'changes' then 'Asked for changes to' else 'Rejected' end || ' "' || coalesce(plan_name, 'a plan') || '": ' || new.note,
              new.role);
  end if;
  return new;
end $$;
create trigger approval_steps_learn after insert or update of decision, note on approval_steps for each row execute function learn_from_plan();

revoke execute on function learn_from_report() from public, anon, authenticated;
revoke execute on function learn_from_plan() from public, anon, authenticated;
