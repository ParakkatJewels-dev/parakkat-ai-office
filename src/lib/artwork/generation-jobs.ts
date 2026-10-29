import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type GenerationState = 'queued'|'submitting'|'submitted'|'collecting'|'succeeded'|'blocked'|'failed'|'uncertain'|'cancelled';
export type GenerationJob = {
  id:string;source:'design'|'creative';item_id:string;request_id:string;requested_by:string;provider:'higgsfield';
  model:string;account_id:string;settings:Record<string,unknown>;state:GenerationState;provider_request_id:string|null;
  lease_holder:string|null;lease_until:string|null;next_poll_at:string;error_code:string|null;error:string|null;
  usage:Record<string,unknown>;created_at:string;updated_at:string;completed_at:string|null;
};
async function rpc<T>(db:SupabaseClient,name:string,args:Record<string,unknown>):Promise<T> {
  const {data,error}=await db.rpc(name,args);
  if(error)throw new Error(error.message || 'The generation job could not be saved.');
  return data as T;
}
/** Explicit request only. Reusing a revision never blindly starts a second paid request. */
export function reserveGenerationJob(db:SupabaseClient,input:{source:'design'|'creative';id:string;requestId:string;userId:string;model:string;accountId:string;settings?:Record<string,unknown>}) {
  return rpc<GenerationJob>(db,'reserve_higgsfield_generation',{p_source:input.source,p_id:input.id,p_request_id:input.requestId,p_user_id:input.userId,p_model:input.model,p_account_id:input.accountId,p_settings:input.settings||{}});
}
export function claimGenerationJob(db:SupabaseClient,input:{id:string;holder:string;expectedState:GenerationState;leaseSeconds?:number}) {
  return rpc<GenerationJob|null>(db,'claim_higgsfield_generation',{p_id:input.id,p_holder:input.holder,p_expected_state:input.expectedState,p_lease_seconds:input.leaseSeconds??180});
}
export function updateGenerationJob(db:SupabaseClient,input:{id:string;holder:string;expectedState:GenerationState;state:GenerationState;providerRequestId?:string;nextPollAt?:string;errorCode?:string;error?:string;usage?:Record<string,unknown>}) {
  return rpc<GenerationJob>(db,'update_higgsfield_generation',{p_id:input.id,p_holder:input.holder,p_expected_state:input.expectedState,p_state:input.state,p_provider_request_id:input.providerRequestId??null,p_next_poll_at:input.nextPollAt??null,p_error_code:input.errorCode??null,p_error:input.error??null,p_usage:input.usage||{}});
}
export function completeGenerationJob(db:SupabaseClient,input:{id:string;holder:string;path:string;refIds?:string[]}) {
  return rpc<{id:string;source:'design'|'creative';status:'ready';version:number;image_path:string}>(db,'complete_higgsfield_generation',{p_id:input.id,p_holder:input.holder,p_path:input.path,p_ref_ids:input.refIds||[]});
}
export async function dueGenerationJobs(db:SupabaseClient,limit=2):Promise<GenerationJob[]> {
  const now=new Date().toISOString();
  const {data,error}=await db.from('artwork_generation_jobs').select('*').in('state',['queued','submitting','submitted','collecting'])
    .lte('next_poll_at',now).or(`lease_until.is.null,lease_until.lte.${now}`).order('next_poll_at').order('created_at').limit(Math.max(1,Math.min(5,Math.trunc(limit)||2)));
  if(error)throw new Error(error.message || 'Generation progress could not be read.');
  return (data||[]) as GenerationJob[];
}
export async function generationJobForArtwork(db:SupabaseClient,source:'design'|'creative',id:string,requestId:string):Promise<GenerationJob|null> {
  const {data,error}=await db.from('artwork_generation_jobs').select('*').eq('source',source).eq('item_id',id).eq('request_id',requestId).maybeSingle();
  if(error)throw new Error(error.message || 'Generation progress could not be read.');
  return data as GenerationJob|null;
}

export function authorizeGenerationPreparation(db:SupabaseClient,input:{source:'design'|'creative';id:string;requestId:string;userId:string}) {
  return rpc<{requestId:string;status:string;carouselId:string|null;campaignId:string|null}>(db,'authorize_generation_preparation',{p_source:input.source,p_id:input.id,p_request_id:input.requestId,p_user_id:input.userId});
}
export function renewGenerationLease(db:SupabaseClient,input:{id:string;holder:string;expectedState:GenerationState;leaseSeconds?:number}) {
  return rpc<GenerationJob>(db,'renew_higgsfield_generation_lease',{p_id:input.id,p_holder:input.holder,p_expected_state:input.expectedState,p_lease_seconds:input.leaseSeconds??600});
}
export type GenerationProject = {state:'ready';id:string;projectId:string;folderId:string}|{state:'claimed';id:string;token:string}|{state:'waiting'|'uncertain';id:string};
export function beginGenerationProject(db:SupabaseClient,job:Pick<GenerationJob,'id'>,holder:string) {
  return rpc<GenerationProject>(db,'begin_higgsfield_generation_project',{p_job_id:job.id,p_holder:holder});
}
export function commitGenerationProject(db:SupabaseClient,input:{jobId:string;holder:string;id:string;token:string;projectId:string;folderId:string}) {
  return rpc<{state:'ready';id:string;projectId:string;folderId:string}>(db,'commit_higgsfield_generation_project',{p_job_id:input.jobId,p_holder:input.holder,p_id:input.id,p_token:input.token,p_project_id:input.projectId,p_folder_id:input.folderId});
}
export function failGenerationProject(db:SupabaseClient,input:{jobId:string;holder:string;id:string;token:string;error?:string}) {
  return rpc<{state:'ready'|'uncertain';id:string}>(db,'fail_higgsfield_generation_project',{p_job_id:input.jobId,p_holder:input.holder,p_id:input.id,p_token:input.token,p_error:input.error??null});
}
