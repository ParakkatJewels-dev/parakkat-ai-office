export const AGENT_WORK_LABELS: Readonly<Record<'text'|'conversation'|'image'|'review'|'classification'|'library'|'library_scan'|'campaign'|'opportunities'|'sync'|'sync_shopify'|'sync_odoo'|'sync_meta'|'sync_instagram'|'sync_google'|'learning'|'seo'|'seo_trends'|'seo_keywords'|'stock'|'sales'|'ads'|'rivals'|'festivals'|'budget'|'planner',string>>;
export type AgentWorkKind=keyof typeof AGENT_WORK_LABELS;
export type AgentWorkScope={agentId?:string|null;kind?:AgentWorkKind;timeoutMs?:number;signal?:AbortSignal};
export type AgentWorkStatus={state:'working';label:string;startedAt:string;expiresAt:string};
export function createAgentWorkRuntime(options:{people:readonly {id:string;human?:boolean}[];now?:()=>number;makeId?:()=>string;setInterval?:typeof setInterval;clearInterval?:typeof clearInterval;setTimeout?:typeof setTimeout;clearTimeout?:typeof clearTimeout}):{
  run<T>(scope:AgentWorkScope,fn:()=>Promise<T>):Promise<T>;
  read(allowedAgentIds:Iterable<string>,now?:number):Record<string,AgentWorkStatus>;
};
