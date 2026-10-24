import 'server-only';
import { has, opt } from '@/lib/env';
import { recordUsage } from '@/lib/usage';
import { geminiChat } from './gemini';

export type Tier = 'manager' | 'worker';
const model = (tier: Tier) => tier === 'manager' ? opt('OPENAI_MANAGER_MODEL', 'gpt-4.1') : opt('OPENAI_WORKER_MODEL', 'gpt-4.1-mini');

/** Errors that mean OpenAI cannot answer anything right now (no key, no credits, bad key, overloaded), not a bad prompt. */
const down = (status: number) => status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;
const PAUSE = 10 * 60_000;
let openaiDownUntil = 0;

/** Which text model answers first. LLM_PROVIDER=gemini makes Gemini the main one; the other is the fallback. */
const order = (): ('openai' | 'gemini')[] => {
  const all: ('openai' | 'gemini')[] = opt('LLM_PROVIDER', 'openai') === 'gemini' ? ['gemini', 'openai'] : ['openai', 'gemini'];
  return all.filter(p => p === 'openai' ? has('OPENAI_API_KEY') && Date.now() >= openaiDownUntil : has('GEMINI_API_KEY'));
};

/** True when at least one text model is set up, so agents that write can work. */
export const canWrite = () => has('OPENAI_API_KEY') || has('GEMINI_API_KEY');

class Down extends Error {}

async function openaiJSON<T>(tier: Tier, system: string, user: string): Promise<T> {
  const t0 = Date.now(), m = model(tier);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: m,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `${system}\nReply with one JSON object only.` }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    await recordUsage({ provider: 'openai', model: m, system, ok: false, ms: Date.now() - t0 });
    const msg = `OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`;
    throw down(res.status) ? new Down(msg) : new Error(msg);
  }
  const data = await res.json();
  await recordUsage({ provider: 'openai', model: data.model?.replace(/-\d{4}-\d{2}-\d{2}$/, '') || m, system, input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens, ms: Date.now() - t0 });
  const text: string = data.choices?.[0]?.message?.content ?? '{}';
  try { return JSON.parse(text) as T; } catch { throw new Error(`OpenAI returned text that is not JSON: ${text.slice(0, 200)}`); }
}

/**
 * Ask a text model for a JSON object. Agent prompts describe the shape they want in `system`.
 * OpenAI answers by default; when it is out of credits, rejects the key or is down, Gemini answers instead
 * and OpenAI is skipped for ten minutes, so the agents never stall on one provider.
 */
export async function chatJSON<T>(tier: Tier, system: string, user: string): Promise<T> {
  const providers = order();
  if (!providers.length) throw new Error('No text model is set up. Add OPENAI_API_KEY or GEMINI_API_KEY in Vercel > Project Settings > Environment Variables.');
  let last: unknown;
  for (const p of providers) {
    try {
      return p === 'openai' ? await openaiJSON<T>(tier, system, user) : await geminiChat<T>(tier, system, user);
    } catch (e) {
      if (p === 'openai' && e instanceof Down) { openaiDownUntil = Date.now() + PAUSE; last = e; continue; }
      throw e;
    }
  }
  throw last;
}
