import type {JevConfig} from './jev-core.mjs';
export type JevStatus=Omit<JevConfig,'apiKey'>&{configured:boolean;status:'not_connected'|'configured'|'connected'|'error';error:string|null;checkedAt:string|null;updatedAt:string|null};
export function createJevStore(options?:{directory?:string;env?:NodeJS.ProcessEnv}):{
 getConfig():Promise<JevConfig>;getStatus():Promise<JevStatus>;saveKey(key:string):Promise<void>;useEnvironment():Promise<void>;recordResult(config:JevConfig,error?:unknown):Promise<void>;
};
