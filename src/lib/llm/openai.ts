import 'server-only';
import { env, opt } from '@/lib/env';

export type Tier = 'manager' | 'worker';
const model = (tier: Tier) => tier === 'manager' ? opt('OPENAI_MANAGER_MODEL', 'gpt-4.1') : opt('OPENAI_WORKER_MODEL', 'gpt-4.1-mini');

/** Ask an OpenAI model for a JSON object. Agent prompts describe the shape they want in `system`. */
export async function chatJSON<T>(tier: Tier, system: string, user: string): Promise<T> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model(tier),
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `${system}\nReply with one JSON object only.` }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '{}';
  try { return JSON.parse(text) as T; } catch { throw new Error(`OpenAI returned text that is not JSON: ${text.slice(0, 200)}`); }
}
