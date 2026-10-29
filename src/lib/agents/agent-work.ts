import 'server-only';
import { PEOPLE } from '@/office/roster.mjs';
import { agentFromPrompt } from '@/lib/usage-cost.mjs';
import { currentUsageScope } from '@/lib/usage';
import { createAgentWorkRuntime, type AgentWorkScope, type AgentWorkKind } from './agent-work-core.mjs';

// This deployment has one Next.js Node process. Share between separately bundled API/job modules;
// a future multi-process/replica deployment must replace this registry with a shared live store.
const key=Symbol.for('parakkat.agent-work.v1');
const globals=globalThis as typeof globalThis & {[key]?:ReturnType<typeof createAgentWorkRuntime>};
const runtime=globals[key] ||= createAgentWorkRuntime({people:PEOPLE});
export const withAgentWork=<T>(scope:AgentWorkScope,fn:()=>Promise<T>)=>runtime.run(scope,fn);
/** Caller must supply IDs permitted by the current signed-in role and department mapping. */
export const readAgentWork=(allowedAgentIds:Iterable<string>,now?:number)=>runtime.read(allowedAgentIds,now);
export type { AgentWorkStatus, AgentWorkKind } from './agent-work-core.mjs';

export function withModelWork<T>(system:string,options:{kind?:AgentWorkKind;timeoutMs?:number;signal?:AbortSignal},fn:()=>Promise<T>) {
  const scope=currentUsageScope(),agentId=agentFromPrompt(system,PEOPLE)?.id||scope.agent;
  const feature=scope.feature?.replace(/^autopilot:/,'');
  const kind=options.kind==='image'||options.kind==='classification'?options.kind:feature==='library'?'library':feature==='agent_conversation'?'conversation':feature==='opportunities'?'opportunities':feature==='campaign'?'campaign':feature==='seo'?'seo':options.kind||'text';
  return withAgentWork({agentId,kind,timeoutMs:options.timeoutMs,signal:options.signal},fn);
}
