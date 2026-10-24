import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { advance } from '@/lib/agents/campaign';
import { isCron } from '@/lib/auth/session';

export const maxDuration = 300;

// Moves every running campaign on by one stage. Supabase pg_cron calls this every minute (see docs/DEPLOY.md).
export async function POST(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  const db = supabaseAdmin();
  const { data: runs } = await db.from('agent_runs').select('id').eq('kind', 'campaign').eq('status', 'running').limit(3);
  const moved: Record<string, string> = {};
  for (const r of runs || []) {
    try { moved[r.id] = await advance(db, r.id); } catch (e) { moved[r.id] = 'failed: ' + (e instanceof Error ? e.message : String(e)); }
  }
  return NextResponse.json(moved);
}
