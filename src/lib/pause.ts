import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { emit } from '@/lib/agents/events';

/**
 * The Super Admin's pause switch. Every paid call (OpenAI, Gemini, Jev, SerpApi), each platform sync, each publish
 * and every tick checks it first, so work in flight stops at its next step. A paused campaign keeps its stage and
 * carries on from there after Resume. The budget guard turns the switch on by itself when the month's budget is spent.
 */
export class Paused extends Error {
  constructor() { super('The agents are paused by the Super Admin. Resume them on the Admin page.'); this.name = 'Paused'; }
}

let cache = { at: 0, paused: false };
let budgetAt = 0;

/**
 * Budget guard: once this month's spend reaches the budget on Usage and billing, pause everything and tell the
 * Super Admin. Checked at most once a minute. It fires once per month and budget, so a Resume is respected
 * until next month or until the budget changes.
 */
async function budgetGuard() {
  if (Date.now() - budgetAt < 60_000) return;
  budgetAt = Date.now();
  const db = supabaseAdmin();
  const { data: m, error } = await db.rpc('month_spend');
  if (error || !m?.budget_inr) return;
  const cap = Number(m.budget_inr), spent = Number(m.spent_inr);
  if (spent < cap || (m.autopaused_month === m.month && Number(m.autopaused_cap) === cap)) return;
  await db.from('system_state').upsert({ id: 1, paused: true, paused_at: new Date().toISOString(), paused_by: null, reason: 'budget' });
  await db.from('billing_settings').update({ autopaused_month: m.month, autopaused_cap: cap }).eq('id', 1);
  cache = { at: Date.now(), paused: true };
  const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  await emit(db, null, 'feedback', 'budgetGuard', `This month's AI and API spend reached ${inr(spent)}, the ${inr(cap)} budget. I paused every agent. Raise the budget on Usage and billing or press Resume to carry on.`, 'superAdmin');
}
export async function isPaused(fresh = false) {
  if (!fresh && Date.now() - cache.at < 3000) return cache.paused;
  const { data, error } = await supabaseAdmin().from('system_state').select('paused').eq('id', 1).maybeSingle();
  // if the switch cannot be read, keep the last known state rather than guessing
  if (!error) cache = { at: Date.now(), paused: !!data?.paused };
  return cache.paused;
}

/** Throws Paused when the switch is on. Call before anything that costs money or changes a platform. */
export async function checkPause() {
  try { await budgetGuard(); } catch { /* the guard must never stop work by failing */ }
  if (await isPaused()) throw new Paused();
}

export async function setPaused(paused: boolean, by: string | null) {
  const { error } = await supabaseAdmin().from('system_state').upsert({ id: 1, paused, paused_at: paused ? new Date().toISOString() : null, paused_by: paused ? by : null, reason: paused ? 'manual' : null });
  if (error) throw error;
  cache = { at: Date.now(), paused };
}
