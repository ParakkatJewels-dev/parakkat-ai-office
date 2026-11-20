-- Keep pre-dispatch failures actionable without storing provider errors or paths.
create or replace function public.fail_chatgpt_image_job(p_id uuid,p_holder uuid,p_kind text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.chatgpt_image_jobs; kind text;
begin
 if p_kind is null or p_kind not in ('preflight','uncertain','logo_missing','logo_changed','logo_unavailable','references','google_login','worker_login','worker_setup') then raise exception 'Unknown image worker failure'; end if;
 job:=public.owned_chatgpt_image_job(p_id,p_holder,true);
 if job.state='succeeded' then return to_jsonb(job); end if;
 kind:=case when job.dispatched_at is not null then 'uncertain' when p_kind='uncertain' then 'preflight' else p_kind end;
 update public.chatgpt_image_jobs set state=case when kind='uncertain' then 'uncertain' else 'blocked' end,
  error_code=kind,
  error=case kind
   when 'uncertain' then 'The ChatGPT generation outcome needs reconciliation. No replacement will be generated automatically.'
   when 'logo_missing' then 'Add the approved logo in Settings → Brand guidance, then prepare a new artwork revision.'
   when 'logo_changed' then 'The approved logo changed after this brief was prepared. Prepare a new artwork revision.'
   when 'logo_unavailable' then 'Brand logo settings are unavailable. Check the database migration and saved logo, then prepare a new artwork revision.'
   when 'references' then 'An artwork reference is unavailable or changed. Refresh the product photos or Design Library references, then prepare a new revision.'
   when 'google_login' then 'Google sign-in expired or was revoked. Reconnect Google in Settings → Connections, then retry this artwork request.'
   when 'worker_login' then 'The ChatGPT image worker is not signed in. Restore its dedicated ChatGPT login before retrying this request.'
   when 'worker_setup' then 'The image worker could not prepare its workspace or saved input files. Check the worker logs before retrying.'
   else 'ChatGPT image preparation failed before generation. Check the worker login and saved references, then retry explicitly.' end,
  lease_until=null,updated_at=clock_timestamp() where id=p_id returning * into job;
 perform public.chatgpt_job_artwork_status(job,'awaiting_import',job.error);
 return to_jsonb(job);
end $$;
revoke all on function public.fail_chatgpt_image_job(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.fail_chatgpt_image_job(uuid,uuid,text) to service_role;
