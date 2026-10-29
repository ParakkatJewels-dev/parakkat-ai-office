'use server';

import {randomUUID} from 'node:crypto';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireUser} from '@/lib/auth/session';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {getNimConfig,saveNimKey,removeNimOverride,safeNimError,syncNimStatus} from '@/lib/llm/nim-config';
import {cleanNimKey,NimError} from '@/lib/llm/nim-core.mjs';
import {testNim} from '@/lib/llm/nim';
import {withUsage} from '@/lib/usage';
import {isAiBudgetError} from '@/lib/ai-budget';

async function requireAdmin(){const user=await requireUser();if(user.role!=='super_admin')redirect('/office');}
function back(message:string,error=false):never{
  revalidatePath('/admin');revalidatePath('/usage');
  redirect(`/admin?tab=ai&${error?'error':'msg'}=${encodeURIComponent(message)}#nim`);
}
export async function saveNimKeyAction(form:FormData){
  await requireAdmin();
  try{
    const current=await getNimConfig(),entered=String(form.get('key')||'').trim();
    await saveNimKey(cleanNimKey(entered||current.apiKey));
    await syncNimStatus();
  }catch(error){back(safeNimError(error),true);}
  back('NVIDIA NIM key saved privately. Run the test to enable eligible text work.');
}
export async function testNimAction(form:FormData){
  await requireAdmin();
  if(form.get('test')!=='yes')back('Press Run test to verify NVIDIA NIM.',true);
  const db=supabaseAdmin(),holder=randomUUID();
  const lock=await db.rpc('acquire_job_lock',{p_name:'nim-connection-test',p_holder:holder,p_seconds:150});
  if(lock.error||!lock.data)back('A NVIDIA NIM test is already running, or its lock is unavailable.',true);
  let message='',failed=false;
  try{await withUsage({feature:'connection_test'},()=>testNim());message='NVIDIA NIM answered the synthetic test. It is ready for eligible text work.';}
  catch(error){failed=true;message=isAiBudgetError(error)?error.message:safeNimError(error);}
  finally{await db.rpc('release_job_lock',{p_name:'nim-connection-test',p_holder:holder});}
  back(message,failed);
}
export async function useNimServerKey(){
  await requireAdmin();
  try{
    if(!(await getNimConfig()).apiKey)throw new NimError('No NVIDIA NIM key is configured.','missing_key');
    await removeNimOverride();await syncNimStatus();
  }catch(error){back(safeNimError(error),true);}
  back('Saved NVIDIA NIM override removed. The installed server key is used if configured.');
}
