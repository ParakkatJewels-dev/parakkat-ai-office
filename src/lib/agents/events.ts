import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { byId } from './people';

export type EventKind = 'think' | 'say' | 'walk' | 'feedback' | 'report' | 'approval' | 'live';

/**
 * Record one moment between agents. The office animates it, and each head only receives it
 * if it touches one of their departments (row-level security on agent_events).
 * People (the heads) are not agents, so they travel in the payload and count as the Leadership Suite.
 */
export async function emit(db: SupabaseClient, runId: string | null, kind: EventKind, from: string, text: string, to?: string, payload: Record<string, unknown> = {}) {
  const f = byId[from], t = to ? byId[to] : undefined;
  const row = {
    run_id: runId, kind, text,
    from_agent: f && !f.human ? from : null, from_dept: f ? f.room : null,
    to_agent: t && !t.human ? to : null, to_dept: t ? t.room : null,
    payload: { ...payload, ...(f?.human ? { from_person: from } : {}), ...(t?.human ? { to_person: to } : {}) },
  };
  const { error } = await db.from('agent_events').insert(row);
  if (error) throw error;
}
