import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** True for the Super Admin and for whoever heads this department (reassignable on the Admin page). */
export async function headsDept(db: SupabaseClient, role: string, dept: string) {
  if (role === 'super_admin') return true;
  const { data } = await db.from('departments').select('human_head_role').eq('id', dept).single();
  return data?.human_head_role === role;
}
