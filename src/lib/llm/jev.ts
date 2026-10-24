import 'server-only';
import { has } from '@/lib/env';
import { chatJSON } from './openai';
import { recordUsage } from '@/lib/usage';
import { checkPause } from '@/lib/pause';

/** One typed question for Jev: pick one of the criteria keys. */
export type Choice = { instructions: string; criteria: Record<string, string> };
export type Answer = { choice: string; confidence: number; probabilities: Record<string, number> };

/**
 * Score or classify with Jev (TypeSafe AI). Returns a choice with a calibrated confidence.
 * Until JEV_API_KEY is set, an OpenAI worker answers the same questions so nothing else has to change.
 */
export async function classify<K extends string>(state: string, questions: Record<K, Choice>): Promise<Record<K, Answer>> {
  await checkPause();
  if (has('JEV_API_KEY')) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.JEV_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state, model: 'jev-latest', questions: Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, { type: 'choice', ...(q as Choice) }])) }),
    });
    await recordUsage({ provider: 'jev', model: 'jev-latest', ok: res.ok, units: 1 });
    if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return data.answers as Record<K, Answer>;
  }
  const spec = Object.entries(questions).map(([k, q]) => `- ${k}: ${(q as Choice).instructions} Options: ${Object.entries((q as Choice).criteria).map(([o, d]) => `"${o}" (${d})`).join(', ')}`).join('\n');
  const out = await chatJSON<Record<string, { choice: string; confidence: number }>>('worker',
    `You classify marketing data. For each question pick exactly one option key and give confidence from 0 to 1.\nQuestions:\n${spec}\nReturn {"<question>": {"choice": "<option>", "confidence": <0..1>}}.`, state);
  return Object.fromEntries(Object.keys(questions).map(k => {
    const a = out[k] || { choice: Object.keys((questions as Record<string, Choice>)[k].criteria)[0], confidence: 0 };
    return [k, { choice: a.choice, confidence: a.confidence, probabilities: { [a.choice]: a.confidence } }];
  })) as Record<K, Answer>;
}
