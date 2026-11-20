import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canDesign } from '@/lib/agents/design';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { geminiConfigured } from '@/lib/llm/gemini-config';
import { projectLibraryRuntime } from './library-status.mjs';

/** Private worker state is projected only after the same department check as the Studio page. */
export async function readLibraryRuntime(db:SupabaseClient,role:string) {
  if(!await canDesign(db,role))throw new Error('You cannot view this design library.');
  const admin=supabaseAdmin();
  const signal=AbortSignal.timeout(8000);
  try {
  const [cursor,lease,pause,designer,gemini]=await Promise.all([
    admin.from('sync_cursors').select('state,updated_at').eq('name','design_library').abortSignal(signal).maybeSingle(),
    admin.from('job_locks').select('holder,until').eq('name','design_library').abortSignal(signal).maybeSingle(),
    db.from('system_state').select('paused').eq('id',1).abortSignal(signal).maybeSingle(),
    db.from('agents').select('enabled').eq('id','designer').abortSignal(signal).maybeSingle(),
    geminiConfigured().then(value=>({value,error:false}),()=>({value:null,error:true})),
  ]);
  return projectLibraryRuntime({cursor:cursor.data,lease:lease.data,paused:pause.data?.paused ?? null,designerEnabled:designer.data?.enabled ?? null,
    geminiConfigured:gemini.value,readError:!!(cursor.error || lease.error || pause.error || designer.error || gemini.error || !pause.data || !designer.data)});
  } catch {return projectLibraryRuntime({cursor:null,lease:null,paused:null,designerEnabled:null,geminiConfigured:null,readError:true});}
}
