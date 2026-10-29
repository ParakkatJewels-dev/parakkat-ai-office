export type DeterministicConversationMatch = { kind:'status' } | { kind:'metrics'; metric:'shopify_revenue'|'shopify_units'|'ad_spend'|'ad_revenue'|'ad_roas'|'totals'; window:{from:string;to:string} };
export function matchDeterministicConversation(prompt:unknown, options?:{meetingRequested?:boolean;now?:Date}):DeterministicConversationMatch|null;
export function deterministicPreferencesSupported(runtime:unknown):boolean;
export function deterministicStatusAnswer(input:{hostName:string;observedAt:string;live:{available:boolean;work?:{state:string;label:string;startedAt:string;expiresAt:string}};activity:unknown;reports:unknown}):string;
export function deterministicMetricsAnswer(match:DeterministicConversationMatch,result:unknown,observedAt:string):string|null;
