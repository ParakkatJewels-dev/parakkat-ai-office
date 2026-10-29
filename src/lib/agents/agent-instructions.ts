import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readAgentRuntime, composeAgentPrompt } from './agent-instructions-core.mjs';
export type AgentPromptContext = { db:SupabaseClient; id:string; signal?:AbortSignal };
export const loadAgentRuntime = (db:SupabaseClient,id:string,options:{signal?:AbortSignal;artifactOnly?:boolean}={}) => readAgentRuntime(db,id,options);
/** The supplied client determines which brand and department context this work may read. */
export async function agentPrompt(db:SupabaseClient,id:string,task:string,options:{signal?:AbortSignal;artifactOnly?:boolean}={}) {
  const runtime=await loadAgentRuntime(db,id,options);
  return composeAgentPrompt(runtime.agent,runtime.instructions,task,runtime.context);
}
