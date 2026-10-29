export type TaskUsageIdentity={kind:'campaign'|'conversation'|'head_task';id:string};
export type UsageScope={run_id?:string|null;feature?:string;stage?:string;agent?:string;scheduled?:boolean;task?:TaskUsageIdentity|null};
export type TaskUsageEvent={event:'provider_attempt'|'cache_reuse'|'inflight_reuse'|'deterministic_reuse'|'checkpoint_reuse';provider?:string;model?:string;agent?:string;feature?:string;reservationId?:string;status?:'pending'|'complete'|'failed';inputTokens?:number;outputTokens?:number;usageKnown?:boolean;estimatedTokens?:number};
export function taskUsageIdentity(value:unknown):TaskUsageIdentity|null;
export function mergeUsageScope(parent:UsageScope|undefined,scope:UsageScope):UsageScope;
export function taskUsageEventRow(scope:UsageScope,input:TaskUsageEvent):Record<string,string|number|null>|null;
export function taskUsageSettlement(value:{status:'complete'|'failed';inputTokens?:number;outputTokens?:number;usageKnown?:boolean}):{status:'complete'|'failed';input_tokens:number|null;output_tokens:number|null};
