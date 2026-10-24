-- The memory also learns from the AI team leads: when a lead stops a report outright, its reason becomes a lesson
-- for that department, so the staff stop repeating the mistake before it ever reaches a head.
create or replace function learn_from_report() returns trigger
  language plpgsql security definer set search_path = public
  as $$ begin
  if new.status in ('accepted', 'sent_back', 'rejected') and new.status is distinct from old.status and coalesce(trim(new.head_note), '') <> '' then
    insert into lessons (department_id, source, source_id, decision, lesson, by_role)
      values (new.department_id, 'report', new.id, new.status::text,
              case new.status when 'accepted' then 'Liked' when 'sent_back' then 'Sent back' else 'Rejected' end || ' "' || new.title || '": ' || new.head_note,
              (select role from profiles where id = new.decided_by));
  elsif new.status = 'rejected_by_lead' and new.status is distinct from old.status and coalesce(trim(new.lead_note), '') <> '' then
    insert into lessons (department_id, source, source_id, decision, lesson)
      values (new.department_id, 'lead', new.id, 'rejected_by_lead', 'Team lead stopped "' || new.title || '": ' || new.lead_note);
  end if;
  return new;
end $$;
revoke execute on function learn_from_report() from public, anon, authenticated;

-- lessons the memory writes from data are found by what they are about, to be updated rather than repeated
create index if not exists lessons_source on lessons (source, source_id);
