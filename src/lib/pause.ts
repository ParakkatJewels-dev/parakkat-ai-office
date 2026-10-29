import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * The Super Admin's pause switch. Every paid call (OpenAI, Gemini, Jev, SerpApi), each platform sync, each publish
 * and every tick checks it first, so work in flight stops at its next step. A paused campaign keeps its stage and
 * carries on from there after Resume. Spending thresholds are monitored by the Budget Guard; only an explicit
 * pause stops the office. Crossing an estimated spending target must not interrupt a task.
 */
export class Paused extends Error {
  constructor() { super('The agents are paused by the Super Admin. Resume them on the Admin page.'); this.name = 'Paused'; }
}

let cache = { at: 0, paused: false };
export async function isPaused(fresh = false) {
  if (!fresh && Date.now() - cache.at < 3000) return cache.paused;
  const { data, error } = await supabaseAdmin().from('system_state').select('paused').eq('id', 1).maybeSingle();
  // if the switch cannot be read, keep the last known state rather than guessing
  if (!error) cache = { at: Date.now(), paused: !!data?.paused };
  return cache.paused;
}

/** Throws Paused when the switch is on. Call before anything that costs money or changes a platform. */
export async function checkPause() {
  if (await isPaused()) throw new Paused();
}

export async function setPaused(paused: boolean, by: string | null) {
  const { error } = await supabaseAdmin().from('system_state').upsert({ id: 1, paused, paused_at: paused ? new Date().toISOString() : null, paused_by: paused ? by : null, reason: paused ? 'manual' : null });
  if (error) throw error;
  cache = { at: Date.now(), paused };
}
