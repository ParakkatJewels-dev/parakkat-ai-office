export type JevConfig = {apiKey:string;model:string;source:'saved'|'environment'|'none'};
export class JevError extends Error {code:string;constructor(message:string,code?:string)}
export function cleanJevKey(value:unknown):string;
export function resolveJevConfig(saved?:{apiKey?:string}|null,env?:NodeJS.ProcessEnv):JevConfig;
export function publicJevConfig(config:JevConfig):Omit<JevConfig,'apiKey'>&{configured:boolean};
export function jevFailure(status:number):JevError;
export function jevRequest(options:{apiKey:string;body:unknown;signal?:AbortSignal;fetch?:typeof fetch}):Promise<any>;
export function checkJevModels(apiKey:string,model?:string,request?:typeof fetch):Promise<boolean>;
export function jevUsage(data:unknown):{inputTokens?:number;outputTokens?:number;usageKnown:boolean};
export function validateJevAnswers(data:unknown,questions:Record<string,{instructions:string;criteria:Record<string,string>}>):Record<string,{choice:string;confidence:number;probabilities:Record<string,number>}>;
export function buildJevBody(system:string,state:string,questions:Record<string,{instructions:string;criteria:Record<string,string>}>,model:string):{model:string;state:{agentGuidance:string;evidence:string};questions:Record<string,{type:string;instructions:string;criteria:Record<string,string>}>};
