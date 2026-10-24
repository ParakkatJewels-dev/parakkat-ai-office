import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { advance } from '@/lib/agents/campaign';
import { runAutopilot } from '@/lib/agents/autopilot';
import { isCron } from '@/lib/auth/session';
import { errText } from '@/lib/errors';

export const maxDuration = 300;

// Moves every running campaign on by one stage, then runs the agents' own background job that is due (sync, watchers,
// the CMO's daily planner). Supabase pg_cron calls this every minute (see docs/DEPLOY.md).
export async function POST(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  const db = supabaseAdmin(), holder = randomUUID();
  const moved: Record<string, string> = {};
  // a stage can take longer than the minute between ticks; the lock stops the next tick running the same stage again
  const { data: got } = await db.rpc('acquire_job_lock', { p_name: 'tick', p_holder: holder, p_seconds: 290 });
  if (got) try {
    const { data: runs } = await db.from('agent_runs').select('id').eq('kind', 'campaign').eq('status', 'running').limit(3);
    for (const r of runs || []) {
      try { moved[r.id] = await advance(db, r.id); } catch (e) { moved[r.id] = 'failed: ' + errText(e); }
    }
  } finally { await db.rpc('release_job_lock', { p_name: 'tick', p_holder: holder }); }
  let autopilot: unknown = null;
  try { autopilot = await runAutopilot(db); } catch (e) { autopilot = 'failed: ' + errText(e); }
  return NextResponse.json({ moved, autopilot });
}
