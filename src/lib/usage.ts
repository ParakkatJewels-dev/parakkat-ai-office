import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PEOPLE } from '@/office/roster.mjs';
import { usageCostUsd, agentFromPrompt, type Price, type UsageBilling } from './usage-cost.mjs';
import { mergeUsageScope, taskUsageEventRow, taskUsageSettlement, type UsageScope, type TaskUsageEvent } from './task-usage-core.mjs';

/**
 * Every paid AI or API call is logged with its estimated cost, for the Usage page. Entry points (a campaign stage,
 * the SEO check, a design order, an autopilot job) set a scope so each call knows its run and feature;
 * the agent comes from the prompt, or from the scope for calls without one (images, Jev).
 */
type Scope = UsageScope;
const als = new AsyncLocalStorage<Scope>();
export const withUsage = <T>(scope: Scope, fn: () => Promise<T>) => als.run(mergeUsageScope(als.getStore(), scope), fn);
export const currentUsageScope = (): Readonly<Scope> => als.getStore() || {};

/** Separate telemetry: reuse never inflates paid-call totals or changes budget admission. */
export async function recordTaskUsageEvent(input:TaskUsageEvent):Promise<string|null> {
  try {
    const row=taskUsageEventRow(currentUsageScope(),input);
    if(!row)return null;
    const result=await supabaseAdmin().from('task_usage_events').insert(row).select('id').abortSignal(AbortSignal.timeout(1500)).maybeSingle();
    return !result.error&&typeof result.data?.id==='string'?result.data.id:null;
  } catch { return null; }
}
export async function settleTaskUsageEvent(id:string|null,outcome:{status:'complete'|'failed';inputTokens?:number;outputTokens?:number;usageKnown?:boolean}):Promise<void> {
  if(!id)return;
  try { await supabaseAdmin().from('task_usage_events').update(taskUsageSettlement(outcome)).eq('id',id).eq('event_kind','provider_attempt').abortSignal(AbortSignal.timeout(1500)); }
  catch { /* A telemetry failure cannot repeat, fail or release an AI request. */ }
}

let prices: { at: number; rows: Record<string, Price> } = { at: 0, rows: {} };
async function priceList() {
  if (Date.now() - prices.at < 60_000) return prices.rows;
  const { data } = await supabaseAdmin().from('usage_prices').select('key, in_per_m, out_per_m, per_unit');
  prices = { at: Date.now(), rows: Object.fromEntries((data || []).map(r => [r.key, r as Price])) };
  return prices.rows;
}

/** Log one call. Never throws: a logging problem must not stop the work. */
export async function recordUsage(u: UsageBilling & { provider: string; model?: string; system?: string; agent?: string; input?: number; output?: number; units?: number; ok?: boolean; ms?: number }) {
  try {
    const s = als.getStore() || {};
    const who = (u.agent || s.agent) ? PEOPLE.find(p => p.id === (u.agent || s.agent)) : agentFromPrompt(u.system || '', PEOPLE);
    // ChatGPT usage is billed/limited by the user's plan and credit settings, not our API price list.
    // A zero here means no API-cost estimate; the Usage page links to ChatGPT's authoritative meter.
    const cost = u.provider === 'chatgpt' ? 0 : usageCostUsd(await priceList(), u);
    await supabaseAdmin().from('api_usage').insert({
      provider: u.provider, model: u.model || null, agent_id: who?.id || null, dept: who?.room || null, run_id: s.run_id || null, feature: s.stage && s.feature ? `${s.feature}:${s.stage}`.slice(0, 100) : s.feature || null,
      input_tokens: u.input || 0, output_tokens: u.output || 0, units: u.units ?? 1, cost_usd: u.ok === false ? 0 : cost, ok: u.ok !== false, ms: u.ms ?? null,
      ...(u.costNote ? { cost_note: u.costNote.slice(0, 1000) } : {}),
    });
  } catch { /* usage is best effort */ }
}
