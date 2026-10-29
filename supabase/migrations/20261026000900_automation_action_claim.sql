-- A reviewed proposal and its task are claimed in one transaction. A losing
-- browser tab never leaves a spent action identifier behind.
create function public.claim_automation_action(p_task_id uuid,p_revision integer,p_index integer,p_kind text,p_payload jsonb,p_user_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare t public.automation_tasks; action_id uuid:=gen_random_uuid();
begin
  if p_user_id is null or p_index is null or p_index<0 or p_revision is null or p_payload is null then
    raise exception 'Invalid action claim' using errcode='22023';
  end if;
  select * into t from public.automation_tasks where id=p_task_id for update;
  if not found or t.revision<>p_revision or t.status not in ('review','completed') or t.state->>'executionPending' is not null then
    raise exception 'The task changed before execution' using errcode='40001';
  end if;
  if p_kind='instagram_reply' then
    if p_index<>10000 then raise exception 'Invalid reply claim' using errcode='22023'; end if;
  elsif t.status<>'review' or p_index>7 or
    (t.result->'actions'->p_index->>'kind') is distinct from p_kind or
    (t.result->'actions'->p_index->'payload') is distinct from p_payload then
    raise exception 'The saved proposal does not match' using errcode='22023';
  end if;
  insert into public.automation_actions(id,task_id,action_index,kind,status,requested_by,payload)
    values(action_id,t.id,p_index,p_kind,'executing',p_user_id,p_payload);
  update public.automation_tasks set status='blocked',state=jsonb_set(state,'{executionPending}',to_jsonb(action_id::text)) where id=t.id;
  return action_id;
end $$;
revoke all on function public.claim_automation_action(uuid,integer,integer,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_automation_action(uuid,integer,integer,text,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
