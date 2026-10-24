import 'server-only';
import { env, opt } from '@/lib/env';

const URL = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

type Part = { text?: string; inlineData?: { mimeType: string; data: string } };

async function generate(model: string, parts: Part[], imageOut: boolean) {
  const res = await fetch(URL(model), {
    method: 'POST',
    headers: { 'x-goog-api-key': env('GEMINI_API_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], ...(imageOut ? { generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } } : {}) }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
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
 * Gemini only builds the scene, light and layout around it.
 */
export async function bannerImage(prompt: string, productPhotos: string[]): Promise<{ data: Buffer; mimeType: string }> {
  const photos = await Promise.all(productPhotos.slice(0, 3).map(imagePart));
  const parts = await generate(opt('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image'), [
    { text: `${prompt}\nKeep every piece of jewellery exactly as in the attached product photos: same design, stones, colour and proportions. Do not invent jewellery. Leave clear space for a headline.` },
    ...photos,
  ], true);
  const img = parts.find(p => p.inlineData)?.inlineData;
  if (!img) throw new Error('Gemini did not return an image: ' + (parts.find(p => p.text)?.text || 'no reason given'));
  return { data: Buffer.from(img.data, 'base64'), mimeType: img.mimeType };
}

/** Plain text from Gemini, used by the trend and festival agents. */
export async function geminiText(prompt: string): Promise<string> {
  const parts = await generate(opt('GEMINI_TEXT_MODEL', 'gemini-2.5-flash'), [{ text: prompt }], false);
  return parts.map(p => p.text || '').join('').trim();
}
