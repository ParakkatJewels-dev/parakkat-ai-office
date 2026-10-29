-- Count NVIDIA NIM text calls in the existing shared daily/weekly admission ledger.
-- Existing limits, reservations, office settings, and reviewer access are preserved.
begin;
alter table public.ai_usage_reservations drop constraint ai_usage_reservations_provider_check;
alter table public.ai_usage_reservations add constraint ai_usage_reservations_provider_check check(provider in ('chatgpt','openai','gemini','jev','nim'));
alter table public.task_usage_events drop constraint task_usage_events_provider_check;
alter table public.task_usage_events add constraint task_usage_events_provider_check check(provider in ('chatgpt','openai','gemini','jev','nim'));

create or replace function public.reserve_ai_request_internal(p_provider text,p_feature text,p_agent_id text,p_input_chars integer,p_input_tokens_estimate bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.ai_usage_settings; usage jsonb; token_count bigint; reservation_id uuid; at timestamptz;
begin
  if p_provider is null or p_provider not in ('chatgpt','openai','gemini','jev','nim') or p_feature is null or char_length(p_feature)>100
    or char_length(p_agent_id)>100 or p_input_chars is null or p_input_chars<0 or p_input_chars>1000000
    or p_input_tokens_estimate is null or p_input_tokens_estimate<0 or p_input_tokens_estimate>2000000 then
    raise exception 'Invalid AI budget request' using errcode='22023';
  end if;
  select * into strict s from public.ai_usage_settings where id=1 for update;
  at:=clock_timestamp();
  if p_input_chars>s.max_input_chars then return jsonb_build_object('allowed',false,'reason','input_too_long','retryAt',null,'maxInputChars',s.max_input_chars); end if;
  token_count:=p_input_tokens_estimate+s.max_output_tokens;
  usage:=public.ai_budget_snapshot(token_count,at);
  if (usage->>'blocked')::boolean then return usage||jsonb_build_object('allowed',false,'reason',usage->>'blockedReason','retryAt',usage->'nextAvailableAt');end if;
  insert into public.ai_usage_reservations(provider,feature,agent_id,input_chars,estimated_input_tokens,max_output_tokens,reserved_tokens,accounted_tokens,created_at)
    values(p_provider,p_feature,p_agent_id,p_input_chars,p_input_tokens_estimate,s.max_output_tokens,token_count,token_count,at) returning id into reservation_id;
  return jsonb_build_object('allowed',true,'id',reservation_id,'maxOutputTokens',s.max_output_tokens,'estimatedTokens',token_count);
end $$;

insert into public.connections(provider,status) values('nim','not_connected') on conflict(provider) do nothing;
insert into public.usage_prices(key,in_per_m,out_per_m,per_unit,note)
  values('nim:*',0,0,0,'Enter your NVIDIA NIM account price; zero means no price configured')
  on conflict(key) do nothing;
notify pgrst,'reload schema';
commit;
