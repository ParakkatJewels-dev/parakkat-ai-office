import { createHash } from 'node:crypto';

// Rolling caps are opt-in. Accounting, reuse and per-request size bounds remain
// active when the office is allowed to work without an app-owned allowance.
export const AI_BUDGET_DEFAULTS = Object.freeze({ enabled: false, daily_call_limit: 40, weekly_call_limit: 200, daily_token_limit: 200000, weekly_token_limit: 1000000, max_input_chars: 100000, max_output_tokens: 8000 });
export const AI_BUDGET_BOUNDS = Object.freeze({ daily_call_limit: [1, 10000], weekly_call_limit: [1, 50000], daily_token_limit: [1000, 10000000], weekly_token_limit: [1000, 50000000], max_input_chars: [1000, 100000], max_output_tokens: [256, 8000] });
export class AiBudgetError extends Error {
  constructor(message, retryAt = null, reason = 'budget_unavailable') { super(message); this.name = 'AiBudgetError'; this.code = 'ai_budget'; this.retryAt = retryAt; this.reason = reason; }
}
export const isAiBudgetError = error => !!error && typeof error === 'object' && error.code === 'ai_budget';
export function validateAiBudgetSettings(patch, current = AI_BUDGET_DEFAULTS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Enter valid text-budget settings.');
  if (Object.keys(patch).some(key => !Object.hasOwn(AI_BUDGET_DEFAULTS, key))) throw new Error('An unknown text-budget setting was supplied.');
  const next = { ...AI_BUDGET_DEFAULTS, ...Object.fromEntries(Object.keys(AI_BUDGET_DEFAULTS).map(key => [key, current[key]])), ...patch };
  if (typeof next.enabled !== 'boolean') throw new Error('Choose whether text-call limits are enabled.');
  for (const [key, [min, max]] of Object.entries(AI_BUDGET_BOUNDS)) if (!Number.isSafeInteger(next[key]) || next[key] < min || next[key] > max) throw new Error(`${key.replaceAll('_', ' ')} must be an integer from ${min} to ${max}.`);
  if (next.weekly_call_limit < next.daily_call_limit || next.weekly_token_limit < next.daily_token_limit) throw new Error('Weekly limits must be at least as large as daily limits.');
  return next;
}
export function estimateAiInput(system, user) {
  if (typeof system !== 'string' || typeof user !== 'string') throw new Error('AI input must be text.');
  // Include the transport's JSON-only instruction in the reservation estimate.
  const text = `${system}\n${user}\nReply with one valid JSON object only. Do not include markdown fences or other text.`;
  return { chars: Array.from(text).length, estimatedTokens: Math.ceil(Buffer.byteLength(text, 'utf8') / 2) };
}
export function actualAiUsage(value) {
  if (!value || value.usageKnown !== true || !Number.isSafeInteger(value.inputTokens) || value.inputTokens < 0 || !Number.isSafeInteger(value.outputTokens) || value.outputTokens < 0) return null;
  return { inputTokens: value.inputTokens, outputTokens: value.outputTokens };
}
/** Short routing/review calls can ask for less output, never more than the saved ceiling. */
export function aiOutputLimit(requested, ceiling) {
  if (requested === undefined) return ceiling;
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('Output token limit must be a positive integer.');
  return Math.min(ceiling, Math.max(256, requested));
}
export function aiCacheEligible(feature) {
  return typeof feature === 'string' && (feature === 'opportunities' || feature.startsWith('autopilot:') || ['automation:catalogue', 'automation:advertising'].includes(feature));
}
export function aiRequestKey({ provider, accountKey, model, feature, agent, system, user, maxOutputTokens }) {
  if (!aiCacheEligible(feature) || typeof accountKey !== 'string' || !accountKey || !model) return null;
  return createHash('sha256').update(JSON.stringify([provider, accountKey, model, feature, agent || null, system, user, maxOutputTokens])).digest('hex');
}
export function waitForAiResult(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal?.reason || new Error('AI request wait was cancelled.'));
    Promise.resolve(promise).then(resolve, reject).finally(() => signal?.removeEventListener('abort', aborted));
    if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true });
  });
}
/** A cancelled waiter does not cancel work another caller is sharing. */
export function createAiRequestCoalescer() {
  const pending = new Map();
  return {
    async run(key, work, signal) {
      if (signal?.aborted) throw signal.reason || new Error('AI request wait was cancelled.');
      let promise = pending.get(key);
      if (!promise) {
        promise = Promise.resolve().then(work); pending.set(key, promise);
        const clear = () => { if (pending.get(key) === promise) pending.delete(key); };
        promise.then(clear, clear);
      }
      return structuredClone(await waitForAiResult(promise, signal));
    },
    get size() { return pending.size; },
  };
}
