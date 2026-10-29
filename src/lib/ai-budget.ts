import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { currentUsageScope, recordTaskUsageEvent, settleTaskUsageEvent } from '@/lib/usage';
import { AiBudgetError, isAiBudgetError, validateAiBudgetSettings, estimateAiInput, actualAiUsage, aiOutputLimit, aiRequestKey, createAiRequestCoalescer, type AiBudgetSettings } from './ai-budget-core.mjs';

export { AiBudgetError, isAiBudgetError };
export type { AiBudgetSettings };
export type AiBudgetStatus = {settings:AiBudgetSettings;daily:{calls:number;tokens:number};weekly:{calls:number;tokens:number};blocked:boolean;blockedReason:string|null;nextAvailableAt:string|null};
const unavailable = () => new AiBudgetError('Text work is waiting because its usage budget could not be checked. Ask an administrator to check the budget service.', null, 'budget_unavailable');

export async function getAiBudgetStatus(db = supabaseAdmin()):Promise<AiBudgetStatus> {
  const response = await db.rpc('get_ai_budget_status');
  if (response.error || !response.data?.settings || !response.data?.daily || !response.data?.weekly) throw unavailable();
  return response.data as AiBudgetStatus;
}
export async function saveAiBudgetSettings(db:SupabaseClient, patch:unknown):Promise<AiBudgetStatus> {
  const current = await getAiBudgetStatus(db), settings = validateAiBudgetSettings(patch, current.settings);
  const saved = await db.from('ai_usage_settings').update(settings).eq('id',1).select('id').maybeSingle();
  if (saved.error || !saved.data) throw new Error('The text-budget settings could not be saved.');
  return getAiBudgetStatus(db);
}

export async function reserveAiRequest(input:{provider:'chatgpt'|'openai'|'gemini'|'jev'|'nim';system:string;user:string;feature?:string;agent?:string;scheduled?:boolean;extraInputTokens?:number}, db = supabaseAdmin()) {
  const estimate = estimateAiInput(input.system,input.user);
  const extra=input.extraInputTokens??0;
  if(!Number.isSafeInteger(extra)||extra<0||extra>1000000)throw unavailable();
  const response = await db.rpc('reserve_ai_request',{p_provider:input.provider,p_feature:(input.feature||'unspecified').slice(0,100),p_agent_id:input.agent?.slice(0,100)||null,p_input_chars:estimate.chars,p_input_tokens_estimate:estimate.estimatedTokens+extra,p_scheduled:input.scheduled??scheduledFeature(input.feature)});
  if (response.error || !response.data) throw unavailable();
  const value=response.data;
  if (!value.allowed) {
    const reason=String(value.reason||'budget_unavailable'),retry=typeof value.retryAt==='string'?value.retryAt:null;
    if (reason==='input_too_long') throw new AiBudgetError(`This task contains more than ${value.maxInputChars} input characters. Narrow its date range or evidence before retrying; nothing was sent to the model.`,null,reason);
    if (reason==='request_exceeds_token_limit') throw new AiBudgetError('This request is larger than the configured rolling token limit. Shorten its input or ask an administrator to review the text budget.',null,reason);
    throw new AiBudgetError('AI Office has reached its configured text-work allowance. This task will wait for the rolling allowance to become available.',retry,reason);
  }
  return {id:String(value.id),maxOutputTokens:Number(value.maxOutputTokens),estimatedTokens:Number(value.estimatedTokens)};
}

/** Failed/unknown requests retain the reserved amount. A failed settlement never releases allowance. */
export async function settleAiRequest(id:string, outcome:{status:'complete'|'failed';inputTokens?:number;outputTokens?:number;usageKnown?:boolean}, db = supabaseAdmin()) {
  const actual=actualAiUsage(outcome);
  try {
    const response=await db.rpc('settle_ai_request',{p_id:id,p_status:outcome.status,p_input_tokens:actual?.inputTokens??null,p_output_tokens:actual?.outputTokens??null});
    return !response.error&&response.data===true;
  } catch { return false; }
}

type Usage = {inputTokens?:number;outputTokens?:number;usageKnown?:boolean};
type BudgetedRequest = {provider:'chatgpt'|'openai'|'gemini'|'jev'|'nim';accountKey:string;model:string;system:string;user:string;signal?:AbortSignal;timeoutMs?:number;extraInputTokens?:number;maxOutputTokens?:number};
type BudgetedRun = {signal:AbortSignal;maxOutputTokens:number;reportUsage:(usage:Usage)=>void};
const globalKey=Symbol.for('parakkat.ai-request-coalescer.v1');
const globals=globalThis as typeof globalThis&{[globalKey]?:ReturnType<typeof createAiRequestCoalescer>};
const coalescer=globals[globalKey] ||= createAiRequestCoalescer();

/** Exact automatic requests may reuse a private 24-hour result, without spending a reservation. */
export async function runAiBudgetedText<T>(input:BudgetedRequest, work:(run:BudgetedRun)=>Promise<T>):Promise<T> {
  input.signal?.throwIfAborted();
  const db=supabaseAdmin(),scope=currentUsageScope(),estimate=estimateAiInput(input.system,input.user);
  const read=await db.from('ai_usage_settings').select('*').eq('id',1).maybeSingle();
  if (read.error||!read.data)throw unavailable();
  const settings=read.data as AiBudgetSettings;
  if(estimate.chars>settings.max_input_chars)throw new AiBudgetError(`This task contains more than ${settings.max_input_chars} input characters. Narrow its date range or evidence before retrying; nothing was sent to the model.`,null,'input_too_long');
  const outputCap=aiOutputLimit(input.maxOutputTokens,settings.max_output_tokens);
  const key=aiRequestKey({...input,feature:scope.feature,agent:scope.agent,maxOutputTokens:outputCap});
  let ownsWork=false;
  const run=async()=>{
    ownsWork=true;
    if(key) {
      const cached=await db.from('ai_response_cache').select('value').eq('cache_key',key).gt('expires_at',new Date().toISOString()).maybeSingle();
      if(!cached.error&&cached.data){
        await recordTaskUsageEvent({event:'cache_reuse'});
        return structuredClone(cached.data.value) as T;
      }
    }
    const reserved=await reserveAiRequest({...input,feature:scope.feature,agent:scope.agent,scheduled:scope.scheduled},db);
    let observed:Usage={usageKnown:false};
    // Shared work owns its own deadline. One caller abandoning its wait must not
    // abort a provider request another caller is already using.
    const signal=key?AbortSignal.timeout(Math.max(1,Math.min(input.timeoutMs||240000,240000))):input.signal||AbortSignal.timeout(240000);
    let taskEvent:Promise<string|null>|undefined;
    try {
      signal.throwIfAborted();
      taskEvent=recordTaskUsageEvent({event:'provider_attempt',provider:input.provider,model:input.model,reservationId:reserved.id,estimatedTokens:reserved.estimatedTokens});
      const value=await work({signal,maxOutputTokens:Math.min(outputCap,reserved.maxOutputTokens),reportUsage:usage=>{observed=usage;}});
      await settleAiRequest(reserved.id,{status:'complete',...observed},db);
      await settleTaskUsageEvent(await taskEvent,{status:'complete',...observed});
      if(key && reserved.maxOutputTokens===settings.max_output_tokens && value!==undefined && Buffer.byteLength(JSON.stringify(value),'utf8')<=262144) {
        // Cache failure does not turn a successful provider response into a retry.
        try { await db.rpc('store_ai_response_cache',{p_key:key,p_value:value}); } catch { /* Keep the successful answer. */ }
      }
      return value;
    } catch(error) {
      await settleAiRequest(reserved.id,{status:'failed',...observed},db);
      if(taskEvent)await settleTaskUsageEvent(await taskEvent,{status:'failed',...observed});
      throw error;
    }
  };
  const value=await (key?coalescer.run(key,run,input.signal):run());
  if(key&&!ownsWork)await recordTaskUsageEvent({event:'inflight_reuse'});
  return value;
}

/** With optional rolling caps enabled, background work preserves half for user tasks. */
function scheduledFeature(feature?:string) {
  return !['agent_conversation','automation:head_task','automation:customer','automation:follow_up','campaign','studio','design','connection_test'].includes(feature||'');
}

export type ImageBudgetStatus={enabled:boolean;daily:number;weekly:number;dailyLimit:number;weeklyLimit:number;blocked:boolean;retryAt:string|null};
export async function getImageBudgetStatus(db=supabaseAdmin()):Promise<ImageBudgetStatus> {
  const r=await db.rpc('get_image_budget_status');
  if(r.error||!r.data)throw new AiBudgetError('Image usage limits are unavailable. No image request was sent.',null,'budget_unavailable');
  return r.data;
}
/** Each attempt consumes one image request, including failures and uncertain results. */
export async function runAiBudgetedImage<T>(work:()=>Promise<T>):Promise<T> {
  const db=supabaseAdmin(),scope=currentUsageScope();
  const r=await db.rpc('reserve_image_request',{p_feature:(scope.feature||'image').slice(0,100),p_agent_id:scope.agent||null});
  if(r.error||!r.data)throw new AiBudgetError('Image usage limits are unavailable. No image request was sent.',null,'budget_unavailable');
  if(!r.data.allowed)throw new AiBudgetError('AI Office has reached its image-request allowance. Wait for the rolling allowance before requesting another image.',r.data.retryAt||null,'image_budget');
  return work();
}
