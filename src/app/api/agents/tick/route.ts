import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { advance } from '@/lib/agents/campaign';
import { runAutopilot } from '@/lib/agents/autopilot';
import { isCron } from '@/lib/auth/session';
import { errText } from '@/lib/errors';
import { isPaused } from '@/lib/pause';

export const maxDuration = 300;

// Moves every running campaign on by one stage, then runs the agents' own background job that is due (sync, watchers,
// the CMO's daily planner). Supabase pg_cron calls this every minute (see docs/DEPLOY.md).
export async function POST(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  if (await isPaused(true)) return NextResponse.json({ paused: true });
  const db = supabaseAdmin(), holder = randomUUID();
  const moved: Record<string, string> = {};
  // a stage can take longer than the minute between ticks; the lock stops the next tick running the same stage again
  const { data: got } = await db.rpc('acquire_job_lock', { p_name: 'tick', p_holder: holder, p_seconds: 290 });
  if (got) try {
    // runs waiting out a retry are skipped until their time comes
    const { data: all } = await db.from('agent_runs').select('id, state').eq('kind', 'campaign').eq('status', 'running').order('started_at').limit(50);
    const runs = (all || []).filter(r => !r.state?.retry?.at || Date.parse(r.state.retry.at) <= Date.now()).slice(0, 3);
    for (const r of runs) {
      if (await isPaused(true)) break;
      try { moved[r.id] = await advance(db, r.id); } catch (e) { moved[r.id] = 'failed: ' + errText(e); }
    }
  } finally { await db.rpc('release_job_lock', { p_name: 'tick', p_holder: holder }); }
  let autopilot: unknown = null;
  try { autopilot = await runAutopilot(db); } catch (e) { autopilot = 'failed: ' + errText(e); }
  return NextResponse.json({ moved, autopilot });
}
