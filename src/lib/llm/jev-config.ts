import 'server-only';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {JevError,type JevConfig} from './jev-core.mjs';
import {createJevStore} from './jev-store.mjs';
const store=createJevStore();
export const getJevConfig=()=>store.getConfig();
export const getJevStatus=()=>store.getStatus();
export const saveJevOverride=(key:string)=>store.saveKey(key);
export const removeJevOverride=()=>store.useEnvironment();
/** Missing configuration is not permission for the lightweight router to spend on another provider. */
export async function canClassifyWithJev(){return !!(await store.getConfig()).apiKey;}
export const safeJevError=(error:unknown)=>error instanceof JevError?error.message:'The Jev connection could not be updated. Check the server setup and try again.';
export async function syncJevStatus(){
 const status=await store.getStatus();
 await supabaseAdmin().from('connections').upsert({provider:'jev',status:status.status,account_ref:status.model,last_error:status.error,last_synced_at:status.checkedAt});
}
export async function recordJevResult(config:JevConfig,error?:unknown){
 try{await store.recordResult(config,error);await syncJevStatus();}catch{/* Diagnostics never repeat a provider request. */}
}
