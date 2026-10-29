import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { NimError, type NimConfig } from './nim-core.mjs';
import { createNimStore } from './nim-store.mjs';

const store=createNimStore();
export const getNimConfig=()=>store.getConfig();
export const getNimStatus=()=>store.getStatus();
export const saveNimKey=(key:string)=>store.saveKey(key);
export const removeNimOverride=()=>store.useEnvironment();
/** Fallback becomes active only after a real synthetic response verifies the saved key/model. */
export async function canUseNim(){return (await store.getStatus()).status==='connected';}
export const safeNimError=(error:unknown)=>error instanceof NimError?error.message:'The NVIDIA NIM connection could not be updated. Check its key and model.';
export async function syncNimStatus(){
  const status=await store.getStatus();
  await supabaseAdmin().from('connections').upsert({provider:'nim',status:status.status,account_ref:status.model,last_error:status.error,last_synced_at:status.checkedAt});
}
export async function recordNimResult(config:NimConfig,error?:unknown){
  try{await store.recordResult(config,error);await syncNimStatus();}catch{/* Health logging must not retry inference. */}
}
