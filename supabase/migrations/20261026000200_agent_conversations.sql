-- Private conversations and bounded task/meeting work. Existing campaign flows are unchanged.
create table agent_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  agent_id text not null references agents,
  title text not null check (char_length(title) between 1 and 160),
  status text not null default 'idle' check (status in ('idle','queued','running','completed','failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_threads_owner on agent_threads(owner_id, agent_id, updated_at desc);

create table agent_tasks (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references agent_threads on delete cascade,
  requested_by uuid not null references auth.users on delete cascade,
  agent_id text not null references agents,
  client_id uuid not null,
  prompt text not null check (char_length(prompt) between 1 and 6000),
  meeting_requested boolean not null default false,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(requested_by, client_id)
);
create unique index agent_tasks_one_active on agent_tasks(thread_id) where status in ('queued','running');
create index agent_tasks_owner on agent_tasks(requested_by, created_at desc);

create table agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references agent_threads on delete cascade,
  task_id uuid references agent_tasks on delete cascade,
  role text not null check (role in ('user','assistant','handoff','progress','error','meeting')),
  agent_id text references agents,
  recipient_agent_id text references agents,
  content text not null check (char_length(content) between 1 and 16000),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index agent_messages_thread on agent_messages(thread_id, created_at, id);

create table agent_meetings (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references agent_threads on delete cascade,
  task_id uuid not null references agent_tasks on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  status text not null default 'planned' check (status in ('planned','running','completed','failed')),
  participants text[] not null,
  summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  check (cardinality(participants) between 2 and 3)
);
create index agent_meetings_thread on agent_meetings(thread_id, created_at desc);

alter table agent_threads enable row level security;
alter table agent_tasks enable row level security;
alter table agent_messages enable row level security;
alter table agent_meetings enable row level security;
create policy "own permitted conversations" on agent_threads for select to authenticated using (
  owner_id = auth.uid() and exists (select 1 from agents a where a.id = agent_id and a.department_id in (select my_depts()))
);
create policy "own conversation tasks" on agent_tasks for select to authenticated using (
  exists (select 1 from agent_threads t where t.id = thread_id)
);
create policy "own conversation messages" on agent_messages for select to authenticated using (
  exists (select 1 from agent_threads t where t.id = thread_id)
);
create policy "own conversation meetings" on agent_meetings for select to authenticated using (
  exists (select 1 from agent_threads t where t.id = thread_id)
);
revoke all on agent_threads, agent_tasks, agent_messages, agent_meetings from public, anon, authenticated;
grant select on agent_threads, agent_tasks, agent_messages, agent_meetings to authenticated;
grant all on agent_threads, agent_tasks, agent_messages, agent_meetings to service_role;

-- A terminated server cannot leave the user's composer locked forever. No model or external action is retried.
create or replace function recover_agent_conversations() returns void
language plpgsql security definer set search_path = public as $$
declare item record; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 815));
  for item in select id, thread_id from agent_tasks
    where requested_by = uid and status in ('queued','running')
      and coalesce(started_at, created_at) < now() - interval '10 minutes' for update
  loop
    update agent_tasks set status='failed', error='This task was interrupted. Send a follow-up to try again.', finished_at=now() where id=item.id;
    update agent_threads set status='failed', error='This task was interrupted. Send a follow-up to try again.', updated_at=now() where id=item.thread_id;
    update agent_meetings set status='failed', finished_at=now() where task_id=item.id and status in ('planned','running');
    insert into agent_messages(thread_id,task_id,role,content) values (item.thread_id,item.id,'error','This task was interrupted. Send a follow-up to try again.');
  end loop;
end $$;

create or replace function enqueue_agent_task(p_agent text, p_prompt text, p_client uuid, p_thread uuid default null, p_meeting boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); th uuid := p_thread; job uuid; existing agent_tasks; message text := btrim(p_prompt);
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if my_role()='viewer' or not exists (select 1 from agents a where a.id=p_agent and a.enabled and a.department_id in (select my_depts())) then
    raise exception 'You cannot assign work to this agent';
  end if;
  if message is null or char_length(message) not between 1 and 6000 or p_client is null then raise exception 'Enter a task of 1 to 6000 characters'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,815));
  select * into existing from agent_tasks where requested_by=uid and client_id=p_client;
  if found then
    if existing.agent_id<>p_agent or existing.prompt<>message or existing.meeting_requested<>coalesce(p_meeting,false) or (p_thread is not null and existing.thread_id<>p_thread) then
      raise exception 'This request identifier was already used';
    end if;
    return jsonb_build_object('threadId',existing.thread_id,'taskId',existing.id,'created',false);
  end if;
  perform recover_agent_conversations();
  if (select count(*) from agent_tasks where requested_by=uid and status in ('queued','running')) >= 3 then raise exception 'Three tasks are already running. Wait for one to finish'; end if;
  if (select count(*) from agent_tasks where requested_by=uid and created_at > now()-interval '1 hour') >= 30 then raise exception 'Please wait before starting more tasks'; end if;
  if th is null then
    insert into agent_threads(owner_id,agent_id,title,status) values(uid,p_agent,left(message,120),'queued') returning id into th;
  else
    perform 1 from agent_threads where id=th and owner_id=uid and agent_id=p_agent for update;
    if not found then raise exception 'Conversation not found'; end if;
    if exists(select 1 from agent_tasks where thread_id=th and status in ('queued','running')) then raise exception 'This agent is still working on your previous message'; end if;
    update agent_threads set status='queued',error=null,updated_at=now() where id=th;
  end if;
  insert into agent_tasks(thread_id,requested_by,agent_id,client_id,prompt,meeting_requested)
    values(th,uid,p_agent,p_client,message,coalesce(p_meeting,false)) returning id into job;
  insert into agent_messages(thread_id,task_id,role,content) values(th,job,'user',message);
  return jsonb_build_object('threadId',th,'taskId',job,'created',true);
end $$;
revoke all on function enqueue_agent_task(text,text,uuid,uuid,boolean), recover_agent_conversations() from public,anon;
grant execute on function enqueue_agent_task(text,text,uuid,uuid,boolean), recover_agent_conversations() to authenticated;

notify pgrst, 'reload schema';
