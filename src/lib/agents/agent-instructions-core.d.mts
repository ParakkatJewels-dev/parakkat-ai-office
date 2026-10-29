export type RuntimeAgent = { id:string; name:string; role_desc:string; department_id:string; enabled?:boolean; is_lead?:boolean };
export type AgentRuntime = { agent:RuntimeAgent; instructions:string; revision:number; updatedAt:string|null; context:{brand:Record<string,string>|null;lessons:{department_id:string;lesson:string;source:string;created_at:string}[]} };
export const AGENT_HOUSE_RULES:string;
export function defaultAgentGuidance(agent:RuntimeAgent):string;
export function composeAgentPrompt(agent:RuntimeAgent,instructions:string,task:string,context?:{brand?:Record<string,string>|string|null;lessons?:any[]}):string;
export function agentPromptId(prompt:string):string|undefined;
export function isAgentRuntimeError(error:unknown):boolean;
export function readAgentRuntime(db:any,id:string,options?:{signal?:AbortSignal;artifactOnly?:boolean}):Promise<AgentRuntime>;
