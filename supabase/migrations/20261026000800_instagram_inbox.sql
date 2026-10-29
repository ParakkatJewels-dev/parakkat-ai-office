-- Instagram messages enter a private CRM inbox. Credentials remain in the existing
-- encrypted Meta vault; these fields contain provider identifiers and message data.
alter table public.automation_inquiries
  add column provider_account_id text,
  add column provider_received_at timestamptz,
  add column provider_deleted_at timestamptz,
  add column conversation_ref text,
  add column reply_text text,
  add column reply_message_id text,
  add column replied_at timestamptz;
create index automation_inquiries_instagram_received on public.automation_inquiries(provider_received_at desc) where channel='instagram';

-- Atomic persistence makes webhook retries and simultaneous polling safe. A
-- deletion leaves a tombstone, preventing a later historical read from restoring
-- the deleted message or reopening its task. Customer contents never enter map events.
create function public.ingest_instagram_message(
  p_account_id text,
  p_message_id text,
  p_sender_id text,
  p_received_at timestamptz,
  p_body text,
  p_contact_name text default '',
  p_conversation_ref text default null,
  p_deleted boolean default false
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  inquiry public.automation_inquiries;
  created boolean := false;
  linked_task_id uuid;
  recent boolean;
begin
  if p_account_id is null or p_account_id !~ '^[0-9]{1,50}$'
    or p_sender_id is null or p_sender_id !~ '^[0-9]{1,50}$' or p_sender_id=p_account_id
    or p_message_id is null or char_length(p_message_id) not between 1 and 1024
    or p_received_at is null or p_received_at > now()+interval '5 minutes'
    or p_body is null or char_length(p_body) not between 1 and 6000
    or p_contact_name is null or char_length(p_contact_name)>200
    or char_length(p_conversation_ref)>1024 or p_deleted is null then
    raise exception 'Invalid Instagram message fields' using errcode='22023';
  end if;

  insert into public.automation_inquiries(channel,external_id,contact_name,contact_ref,body,consent,status,
    provider_account_id,provider_received_at,provider_deleted_at,conversation_ref,created_at)
  values ('instagram',p_message_id,p_contact_name,p_sender_id,
    case when p_deleted then '[This Instagram message was deleted by its sender.]' else p_body end,
    false,case when p_deleted then 'closed' else 'new' end,p_account_id,p_received_at,
    case when p_deleted then now() else null end,p_conversation_ref,p_received_at)
  on conflict (channel,external_id) do nothing
  returning * into inquiry;
  created := found;

  if not created then
    select * into inquiry from public.automation_inquiries i
      where i.channel='instagram' and i.external_id=p_message_id for update;
    if inquiry.provider_account_id is distinct from p_account_id or inquiry.contact_ref is distinct from p_sender_id then
      raise exception 'Instagram message identifiers conflict with the saved account' using errcode='22023';
    end if;
  end if;

  if p_deleted or inquiry.provider_deleted_at is not null then
    update public.automation_inquiries i set body='[This Instagram message was deleted by its sender.]',
      contact_name='',reply_text=null,provider_deleted_at=coalesce(i.provider_deleted_at,now()),status='closed'
      where i.id=inquiry.id;
    if inquiry.task_id is not null then
      update public.automation_tasks t set status='cancelled',brief='The customer deleted this Instagram message.',
        input=jsonb_build_object('inquiryId',inquiry.id,'channel','instagram','deleted',true),
        result=null,state='{}',error=null,claimed_by=null,lease_until=null,finished_at=now()
        where t.id=inquiry.task_id;
      -- Saved action receipts remain a restricted audit. Pending execution must
      -- recheck the inquiry tombstone before any send; the action payload is frozen.
      update public.automation_events e set text='The customer deleted the source Instagram message.'
        where e.task_id=inquiry.task_id;
    end if;
    return jsonb_build_object('inquiryId',inquiry.id,'taskId',inquiry.task_id,'created',created,'deleted',true);
  end if;

  if inquiry.task_id is null then
    recent := p_received_at >= now()-interval '24 hours' and p_received_at <= now();
    insert into public.automation_tasks(kind,department_id,owner_agent,title,brief,status,input,source_key,due_at,error)
    values ('customer','crm','crmLead','Instagram customer enquiry',
      'Review the saved Instagram enquiry and prepare a helpful reply for a human to review. Never send automatically.',
      case when recent then 'queued' else 'blocked' end,
      jsonb_build_object('inquiryId',inquiry.id,'channel','instagram'),
      'instagram:'||p_message_id,p_received_at+interval '24 hours',
      case when recent then null else 'Historical Instagram enquiry: the 24-hour reply window is closed. Handle it manually in Instagram.' end)
    on conflict (source_key) do nothing
    returning id into linked_task_id;
    if linked_task_id is null then
      select t.id into linked_task_id from public.automation_tasks t where t.source_key='instagram:'||p_message_id
        and t.kind='customer' and t.department_id='crm' and t.input->>'inquiryId'=inquiry.id::text;
      if linked_task_id is null then
        raise exception 'The Instagram task identity conflicts with existing work' using errcode='22023';
      end if;
    end if;
    update public.automation_inquiries i set task_id=linked_task_id,
      status=case when recent then 'drafting' else 'review' end where i.id=inquiry.id;
    insert into public.automation_events(task_id,kind,agent_id,text)
      values(linked_task_id,'queued','crmLead',case when recent then 'An Instagram enquiry is saved for reply drafting and human review.'
        else 'An older Instagram enquiry is saved for manual handling. No reply will be sent automatically.' end);
  else
    linked_task_id:=inquiry.task_id;
  end if;
  return jsonb_build_object('inquiryId',inquiry.id,'taskId',linked_task_id,'created',created,'deleted',false);
end $$;
revoke all on function public.ingest_instagram_message(text,text,text,timestamptz,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.ingest_instagram_message(text,text,text,timestamptz,text,text,text,boolean) to service_role;

notify pgrst, 'reload schema';
