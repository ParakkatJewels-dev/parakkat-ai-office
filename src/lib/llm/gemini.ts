import 'server-only';
import { createHash } from 'node:crypto';
import { opt } from '@/lib/env';
import { recordUsage } from '@/lib/usage';
import { geminiImageBilling } from '@/lib/usage-cost.mjs';
import { checkPause } from '@/lib/pause';
import { getGeminiConfig, recordGeminiImageResult } from './gemini-config';
import { GeminiError, geminiImage, geminiImageGenerationConfig, geminiRequest, type GeminiConfig } from './gemini-core.mjs';
import { agentPrompt, type AgentPromptContext } from '@/lib/agents/agent-instructions';
import { agentPromptId } from '@/lib/agents/agent-instructions-core.mjs';
import { withModelWork } from '@/lib/agents/agent-work';
import { runAiBudgetedText, runAiBudgetedImage } from '@/lib/ai-budget';
import { isChatGPTHandoff } from '@/lib/artwork-mode.mjs';

// Google retires model names for new projects; these are the current ones (ai.google.dev/gemini-api/docs/models)
const TEXT = () => opt('GEMINI_TEXT_MODEL', 'gemini-3.8-flash');

type Part = { text?: string; thought?: boolean; inlineData?: { mimeType: string; data: string } };
type TextOptions = {maxOutputTokens?:number;onUsage?:(value:{inputTokens?:number;outputTokens?:number;usageKnown?:boolean})=>void;config?:GeminiConfig};

async function generate(model: string, parts: Part[], imageOut: boolean, aspectRatio?: string, json = false, system?: string, signal?: AbortSignal,options:TextOptions={}) {
  if (isChatGPTHandoff()) throw new Error('Gemini calls are disabled. Create artwork in ChatGPT or Higgsfield and import it in Design Studio.');
  await checkPause();
  signal?.throwIfAborted();
  const config=options.config||await getGeminiConfig();
  return withModelWork(system||'',{kind:imageOut?'image':json?'review':'text',timeoutMs:180_000,signal},()=>{
    if(imageOut)return runAiBudgetedImage(()=>generateWork(model,parts,true,aspectRatio,json,system,signal,{...options,config}));
    // Hash media into the request identity; never put base64 into a prompt ledger/cache key input.
    const user=JSON.stringify(parts.map(p=>p.inlineData?{mimeType:p.inlineData.mimeType,sha256:createHash('sha256').update(p.inlineData.data).digest('hex')}:{text:p.text||''}));
    const imageCount=parts.filter(p=>p.inlineData).length;
    return runAiBudgetedText({provider:'gemini',accountKey:createHash('sha256').update(config.apiKey).digest('hex'),model,system:system||'',user,signal,timeoutMs:180000,extraInputTokens:imageCount*8192,maxOutputTokens:options.maxOutputTokens},run=>generateWork(model,parts,false,aspectRatio,json,system,run.signal,{...options,config,maxOutputTokens:run.maxOutputTokens,onUsage:usage=>{run.reportUsage(usage);options.onUsage?.(usage);}}));
  });
}

async function generateWork(model: string, parts: Part[], imageOut: boolean, aspectRatio?: string, json = false, system?: string, signal?: AbortSignal,options:TextOptions={}) {
  if (isChatGPTHandoff()) throw new Error('Gemini calls are disabled. Create artwork in ChatGPT or Higgsfield and import it in Design Studio.');
  await checkPause();
  const config = options.config || await getGeminiConfig(), t0 = Date.now();
  const generationConfig = imageOut ? geminiImageGenerationConfig(config, aspectRatio) : { ...(json ? { responseMimeType: 'application/json' } : {}),...(options.maxOutputTokens?{maxOutputTokens:options.maxOutputTokens}:{}) };
  try {
    const data = await geminiRequest({ apiKey: config.apiKey, model, signal,
      body: { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: [{ role: 'user', parts }], ...(generationConfig ? { generationConfig } : {}) } });
    const um = data.usageMetadata || {}, result = (data.candidates?.[0]?.content?.parts ?? []) as Part[];
    const count=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
    options.onUsage?.({inputTokens:um.promptTokenCount,outputTokens:count(um.candidatesTokenCount)&&count(um.thoughtsTokenCount??0)?um.candidatesTokenCount+(um.thoughtsTokenCount??0):undefined,usageKnown:count(um.promptTokenCount)&&count(um.candidatesTokenCount)&&count(um.thoughtsTokenCount??0)});
    if (imageOut) geminiImage(result);
    const billing = imageOut ? geminiImageBilling(model, config.imageSize, um, result) : {};
    await recordUsage({ provider: 'gemini', model, system, agent: agentPromptId(system || ''), input: um.promptTokenCount, output: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0), ...billing, ...(billing.imageCharge ? { units: billing.imageCharge.units } : {}), ms: Date.now() - t0 });
    if (imageOut) await recordGeminiImageResult(config);
    return result;
  } catch (e) {
    await recordUsage({ provider: 'gemini', model, system, agent: agentPromptId(system || ''), ok: false, ms: Date.now() - t0 });
    if (imageOut) await recordGeminiImageResult(config, e);
    throw e;
  }
}

/** Fetch an image (a Shopify product photo) as an inline part for Gemini. */
export async function imagePart(url: string): Promise<Part> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not fetch product image ${url}: ${r.status}`);
  return { inlineData: { mimeType: r.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await r.arrayBuffer()).toString('base64') } };
}

/**
 * Make a newly rendered design from real product photos as identity references.
 * The physical product details must match. Visual references and their saved
 * fingerprints guide art direction; imported image bytes are not retained here.
 */
export async function bannerImage(prompt: string, productPhotos: string[], aspectRatio: string | undefined, photoParts: Part[] | undefined, refs: Part[], agent: AgentPromptContext): Promise<{ data: Buffer; mimeType: string }> {
  const fidelity = 'Use the PRODUCT PHOTOS as visual identity references. Render the same jewellery afresh in the new scene, preserving its distinctive silhouette, metal colour, stones, setting, motifs and proportions. Do not cut out, paste or frame the source photos, and do not replace the product with a generic or similar design. Product identity requirements override saved style preferences.';
  const system = await agentPrompt(agent.db,agent.id,`${prompt}\n${fidelity}`,{signal:agent.signal});
  const photos = photoParts || await Promise.all(productPhotos.slice(0, 3).map(imagePart));
  const config = await getGeminiConfig();
  const parts = await generate(config.imageModel, [
    { text: `${prompt}\n${fidelity}` },
    ...(refs.length ? [{ text: 'STYLE REFERENCES AND FINGERPRINTS: Past Parakkat Jewels designs. Match their level of finish, art direction, typography, palette and visual balance. Adapt the composition to the requested product and format. Do not copy their words, claims or jewellery.' }, ...refs] : []),
    { text: 'PRODUCT PHOTOS:' },
    ...photos,
  ], true, aspectRatio, false, system, agent.signal, {config});
  return geminiImage(parts);
}

/** One reference-led style scene shared by a carousel's five newly rendered product images. */
export async function carouselStyleBackground(refs: Part[], agent: AgentPromptContext, direction = ''): Promise<{ data: Buffer; mimeType: string }> {
  if (!refs.length) throw new Error('Choose a ready Design Library fingerprint before generating a carousel style.');
  const instruction = `Create a premium 4:5 style scene for a Parakkat Jewels product carousel based on the supplied visual reference and fingerprint of a past brand design. Follow its mood, palette, lighting, decorative details and finish. Keep the five-card series visually consistent. Use restrained decorative detail that leaves room for the hero product and brand typography. Each finished card will generate its jewellery and scene together, using this image for art direction. Do not add jewellery, gemstones, product silhouettes, people, text, letters, numerals, logos, watermarks, or offer badges.${direction.trim() ? ` The manager requested this new art direction for the whole set: ${direction.trim().slice(0, 600)}.` : ''}`;
  const system = await agentPrompt(agent.db, agent.id, `${instruction}\nThe source reference is for style only. Do not copy any product or words in it.`, {signal:agent.signal});
  const config = await getGeminiConfig();
  const parts = await generate(config.imageModel, [
    { text: instruction },
    { text: 'PAST PARAKKAT DESIGN STYLE REFERENCE AND FINGERPRINT:' },
    ...refs,
  ], true, '4:5', false, system, agent.signal, {config});
  return geminiImage(parts);
}

/** One explicitly requested billable image check; no product data or automatic retries. */
export async function generateGeminiTestImage() {
  const config = await getGeminiConfig();
  return geminiImage(await generate(config.imageModel, [{ text: 'Create a simple blue circle centered on a plain white square background. No text.' }], true, '1:1', false, undefined, undefined, {config}));
}

/** Plain text from Gemini, used by the trend and festival agents. */
export async function geminiText(prompt: string): Promise<string> {
  const parts = await generate(TEXT(), [{ text: prompt }], false);
  return parts.map(p => p.text || '').join('').trim();
}

/** Ask Gemini about images (a finished design next to the product photos) and get JSON back. */
export async function geminiJSON<T>(prompt: string, images: Part[], agent: AgentPromptContext): Promise<T> {
  const system = await agentPrompt(agent.db,agent.id,`${prompt}\nReply with one JSON object only.`,{signal:agent.signal});
  const parts = await generate(TEXT(), [{ text: 'Complete the image review described in the current task. Reply with one JSON object only.' }, ...images], false, undefined, true, system, agent.signal);
  const text = parts.map(p => p.text || '').join('').trim();
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T; } catch { throw new GeminiError('Gemini returned an invalid review. Try again.', 'invalid_json'); }
}
/** The agents' text work on Gemini, used when OpenAI cannot answer (or when LLM_PROVIDER=gemini). */
export async function geminiChat<T>(tier: 'manager' | 'worker', system: string, user: string, options: { signal?: AbortSignal }&TextOptions = {}): Promise<T> {
  const m = tier === 'manager' ? opt('GEMINI_MANAGER_MODEL', TEXT()) : TEXT();
  const parts = await generate(m, [{ text: user }], false, undefined, true, `${system}\nReply with one JSON object only.`, options.signal,options);
  const text = parts.map(p => p.text || '').join('').trim();
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T; } catch { throw new GeminiError('Gemini returned an invalid answer. Try again.', 'invalid_json'); }
}
export type { Part };
