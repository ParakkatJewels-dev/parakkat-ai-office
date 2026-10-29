export type CampaignCheckpointState = { version: 1; retryAuthorizedAt?:string; entries: Record<string, {status:'pending';fingerprint:string;startedAt:string;resourceId?:string}|{status:'complete';fingerprint:string;value:unknown}> };
export type CampaignCheckpoint = {
  adopt(key:string,input:unknown,value:unknown):Promise<void>;
  memo<T>(key:string,input:unknown,make:()=>T):Promise<T>;
  run<T>(key:string,input:unknown,operation:()=>Promise<T>,options?:{uncertainOnError?:boolean;resourceId?:string}):Promise<T>;
};
export function campaignCheckpointFingerprint(input:unknown):string;
export function campaignHasPendingCall(state:unknown):boolean;
export function campaignPendingCall():Error & {code:string};
export function prepareCampaignRetry<T extends Record<string,any>>(state:T):T;
export function createCampaignCheckpoint(state:{checkpoints?:CampaignCheckpointState},options:{persist:()=>Promise<void>;assertActive?:()=>Promise<void>;isSafeFailure?:(error:unknown)=>boolean;onReuse?:()=>Promise<void>}):CampaignCheckpoint;
