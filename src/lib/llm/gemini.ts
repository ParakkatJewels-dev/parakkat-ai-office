import 'server-only';
import { env, opt } from '@/lib/env';
import { recordUsage } from '@/lib/usage';
import { checkPause } from '@/lib/pause';

// Google retires model names for new projects; these are the current ones (ai.google.dev/gemini-api/docs/models)
const TEXT = () => opt('GEMINI_TEXT_MODEL', 'gemini-3.8-flash');
const URL = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

type Part = { text?: string; inlineData?: { mimeType: string; data: string } };

async function generate(model: string, parts: Part[], imageOut: boolean, aspectRatio?: string, json = false, system?: string) {
  const generationConfig = imageOut ? { responseModalities: ['TEXT', 'IMAGE'], ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}) } : json ? { responseMimeType: 'application/json' } : undefined;
  await checkPause();
  const t0 = Date.now();
  const res = await fetch(URL(model), {
    method: 'POST',
    headers: { 'x-goog-api-key': env('GEMINI_API_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: [{ role: 'user', parts }], ...(generationConfig ? { generationConfig } : {}) }),
  });
  if (!res.ok) { await recordUsage({ provider: 'gemini', model, system, ok: false, ms: Date.now() - t0 }); throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`); }
  const data = await res.json();
  const um = data.usageMetadata || {};
  await recordUsage({ provider: 'gemini', model, system, input: um.promptTokenCount, output: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0), ms: Date.now() - t0 });
  return (data.candidates?.[0]?.content?.parts ?? []) as Part[];
}

/** Fetch an image (a Shopify product photo) as an inline part for Gemini. */
export async function imagePart(url: string): Promise<Part> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not fetch product image ${url}: ${r.status}`);
  return { inlineData: { mimeType: r.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await r.arrayBuffer()).toString('base64') } };
}

/**
 * Make a banner from real product photos. The product must stay exactly as photographed:
 * Gemini only builds the scene, light and layout around it. Reference images are Parakkat's own past designs,
 * labelled as such so the model takes their finish and art direction, never their jewellery or their exact layout.
 */
export async function bannerImage(prompt: string, productPhotos: string[], aspectRatio?: string, photoParts?: Part[], refs: Part[] = []): Promise<{ data: Buffer; mimeType: string }> {
  const photos = photoParts || await Promise.all(productPhotos.slice(0, 3).map(imagePart));
  const parts = await generate(opt('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image'), [
    { text: `${prompt}\nKeep every piece of jewellery exactly as in the PRODUCT PHOTOS: same design, stones, colour and proportions. Do not invent jewellery.` },
    ...(refs.length ? [{ text: `STYLE REFERENCES: ${refs.length} past Parakkat Jewels design${refs.length === 1 ? '' : 's'}. Match their level of finish, art direction and typography. Do not copy their layout, their text or the jewellery in them.` }, ...refs] : []),
    { text: 'PRODUCT PHOTOS:' },
    ...photos,
  ], true, aspectRatio);
  const img = parts.find(p => p.inlineData)?.inlineData;
  if (!img) throw new Error('Gemini did not return an image: ' + (parts.find(p => p.text)?.text || 'no reason given'));
  return { data: Buffer.from(img.data, 'base64'), mimeType: img.mimeType };
}

/** Plain text from Gemini, used by the trend and festival agents. */
export async function geminiText(prompt: string): Promise<string> {
  const parts = await generate(TEXT(), [{ text: prompt }], false);
  return parts.map(p => p.text || '').join('').trim();
}

/** Ask Gemini about images (a finished design next to the product photos) and get JSON back. */
export async function geminiJSON<T>(prompt: string, images: Part[]): Promise<T> {
  const parts = await generate(TEXT(), [{ text: `${prompt}\nReply with one JSON object only.` }, ...images], false, undefined, true);
  const text = parts.map(p => p.text || '').join('').trim();
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T; } catch { throw new Error(`Gemini returned text that is not JSON: ${text.slice(0, 200)}`); }
}
/** The agents' text work on Gemini, used when OpenAI cannot answer (or when LLM_PROVIDER=gemini). */
export async function geminiChat<T>(tier: 'manager' | 'worker', system: string, user: string): Promise<T> {
  const m = tier === 'manager' ? opt('GEMINI_MANAGER_MODEL', TEXT()) : TEXT();
  const parts = await generate(m, [{ text: user }], false, undefined, true, `${system}\nReply with one JSON object only.`);
  const text = parts.map(p => p.text || '').join('').trim();
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T; } catch { throw new Error(`Gemini returned text that is not JSON: ${text.slice(0, 200)}`); }
}
export type { Part };
