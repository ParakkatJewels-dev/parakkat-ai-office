import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PEOPLE } from '@/office/roster.mjs';
import { priceFor, costUsd, agentFromPrompt, type Price } from './usage-cost.mjs';

/**
 * Every paid AI or API call is logged with its estimated cost, for the Usage page. Entry points (a campaign stage,
 * the SEO check, a design order, an autopilot job) set a scope so each call knows its run and feature;
 * the agent comes from the prompt, or from the scope for calls without one (images, Jev).
 */
type Scope = { run_id?: string | null; feature?: string; agent?: string };
const als = new AsyncLocalStorage<Scope>();
export const withUsage = <T>(scope: Scope, fn: () => Promise<T>) => als.run({ ...als.getStore(), ...scope }, fn);

let prices: { at: number; rows: Record<string, Price> } = { at: 0, rows: {} };
async function priceList() {
  if (Date.now() - prices.at < 60_000) return prices.rows;
  const { data } = await supabaseAdmin().from('usage_prices').select('key, in_per_m, out_per_m, per_unit');
  prices = { at: Date.now(), rows: Object.fromEntries((data || []).map(r => [r.key, r as Price])) };
  return prices.rows;
}

/** Log one call. Never throws: a logging problem must not stop the work. */
export async function recordUsage(u: { provider: string; model?: string; system?: string; agent?: string; input?: number; output?: number; units?: number; ok?: boolean; ms?: number }) {
  try {
    const s = als.getStore() || {};
    const who = (u.agent || s.agent) ? PEOPLE.find(p => p.id === (u.agent || s.agent)) : agentFromPrompt(u.system || '', PEOPLE);
    const cost = costUsd(priceFor(await priceList(), u.provider, u.model || ''), { input: u.input, output: u.output, units: u.units ?? 1 });
    await supabaseAdmin().from('api_usage').insert({
      provider: u.provider, model: u.model || null, agent_id: who?.id || null, dept: who?.room || null, run_id: s.run_id || null, feature: s.feature || null,
      input_tokens: u.input || 0, output_tokens: u.output || 0, units: u.units ?? 1, cost_usd: u.ok === false ? 0 : cost, ok: u.ok !== false, ms: u.ms ?? null,
    });
  } catch { /* usage is best effort */ }
}
