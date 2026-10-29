export type NimConfig={apiKey:string;model:string;source:'saved'|'environment'|'none'};
export class NimError extends Error{code:string;usage?:{inputTokens?:number;outputTokens?:number;usageKnown?:boolean};constructor(message:string,code?:string)}
export const DEFAULT_NIM_MODEL:string;
export function cleanNimKey(value:unknown):string;
export function resolveNimConfig(saved:unknown,env?:NodeJS.ProcessEnv):NimConfig;
export function publicNimConfig(config:NimConfig):{configured:boolean;model:string;source:NimConfig['source']};
export function nimFailure(status:number):NimError;
export function nimUsage(data:unknown):{inputTokens?:number;outputTokens?:number;usageKnown:boolean};
export function nimJSON<T>(input:{apiKey:string;model:string;system:string;user:string;maxOutputTokens?:number;signal?:AbortSignal;fetch?:typeof fetch}):Promise<{value:T;usage:{inputTokens?:number;outputTokens?:number;usageKnown:boolean};model:string}>;
