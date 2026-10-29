import 'server-only';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Used only after the caller's Super Admin check. The request deadline ends before this lease can expire. */
export async function withLibraryFolderEdit<T>(work:(db:SupabaseClient,check:()=>Promise<void>)=>Promise<T>):Promise<T> {
  const signal=AbortSignal.timeout(120_000),holder=randomUUID();
  const db=createClient(env('NEXT_PUBLIC_SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{
    auth:{persistSession:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal})},
  });
  const lease=await db.rpc('acquire_job_lock',{p_name:'design_library',p_holder:holder,p_seconds:150});
  if(lease.error)throw new Error('Could not check the library worker. Try again shortly.');
  if(!lease.data)throw new Error('The library worker is active. Wait until the current pass finishes before changing folders.');
  const check=async()=>{
    signal.throwIfAborted();
    const current=await db.from('job_locks').select('holder').eq('name','design_library').eq('holder',holder).gt('until',new Date().toISOString()).maybeSingle();
    if(current.error || !current.data)throw new Error('The folder edit could not keep its reservation. Refresh and try again.');
    signal.throwIfAborted();
  };
  try {await check();return await work(db,check);}
  finally {await supabaseAdmin().rpc('release_job_lock',{p_name:'design_library',p_holder:holder}).abortSignal(AbortSignal.timeout(5000)).then(()=>{},()=>{});}
}
