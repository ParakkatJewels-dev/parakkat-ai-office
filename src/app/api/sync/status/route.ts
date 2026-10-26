import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncStatus } from '@/lib/agents/sync';

export const dynamic = 'force-dynamic';

// The sync bar polls this while a sync runs. Only the Super Admin sees syncs, so only they get an answer.
export async function GET() {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'sign in' }, { status: 401 });
  const { data: p } = await db.from('profiles').select('role').eq('id', user.id).single();
  if (p?.role !== 'super_admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json(await syncStatus(supabaseAdmin()), { headers: { 'cache-control': 'no-store' } });
}
