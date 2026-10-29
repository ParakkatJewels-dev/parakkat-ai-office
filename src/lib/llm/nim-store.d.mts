import type {NimConfig} from './nim-core.mjs';
export function createNimStore(input?:{directory?:string;env?:NodeJS.ProcessEnv}):{
 getConfig():Promise<NimConfig>;
 getStatus():Promise<{configured:boolean;model:string;source:NimConfig['source'];status:string;error:string|null;checkedAt:string|null;updatedAt:string|null}>;
 saveKey(value:string):Promise<void>;
 useEnvironment():Promise<void>;
 recordResult(config:NimConfig,error?:unknown):Promise<void>;
};
