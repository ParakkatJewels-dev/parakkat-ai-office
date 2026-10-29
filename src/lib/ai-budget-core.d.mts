export type AiBudgetSettings = {enabled:boolean;daily_call_limit:number;weekly_call_limit:number;daily_token_limit:number;weekly_token_limit:number;max_input_chars:number;max_output_tokens:number;updated_at?:string};
export const AI_BUDGET_DEFAULTS: Readonly<AiBudgetSettings>;
export const AI_BUDGET_BOUNDS: Readonly<Record<string,readonly [number,number]>>;
export class AiBudgetError extends Error {code:'ai_budget';retryAt:string|null;reason:string;constructor(message:string,retryAt?:string|null,reason?:string)}
export function isAiBudgetError(error:unknown):error is AiBudgetError;
export function validateAiBudgetSettings(patch:unknown,current?:AiBudgetSettings):AiBudgetSettings;
export function estimateAiInput(system:string,user:string):{chars:number;estimatedTokens:number};
export function actualAiUsage(value:unknown):{inputTokens:number;outputTokens:number}|null;
export function aiOutputLimit(requested:number|undefined,ceiling:number):number;
export function aiCacheEligible(feature:unknown):boolean;
export function aiRequestKey(value:{provider:string;accountKey:string;model:string;feature?:string;agent?:string;system:string;user:string;maxOutputTokens:number}):string|null;
export function waitForAiResult<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>;
export function createAiRequestCoalescer():{run<T>(key:string,work:()=>Promise<T>,signal?:AbortSignal):Promise<T>;readonly size:number};
