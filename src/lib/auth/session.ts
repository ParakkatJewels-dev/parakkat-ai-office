import 'server-only';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import type { AppRole } from '@/lib/roles';

/** The signed-in person and their role, or a redirect to the login page. */
export async function requireUser() {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await db.from('profiles').select('full_name, role').eq('id', user.id).single();
  return { db, user, name: profile?.full_name || user.email || 'You', role: (profile?.role || 'viewer') as AppRole };
}

/** True when a request comes from Vercel Cron or Supabase pg_cron with the shared secret. */
export function isCron(req: Request) {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.get('authorization') === `Bearer ${s}`;
}
