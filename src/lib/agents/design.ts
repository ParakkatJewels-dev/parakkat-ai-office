import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bannerImage, geminiJSON, imagePart } from '@/lib/llm/gemini';
import { chatJSON } from '@/lib/llm/openai';
import { has } from '@/lib/env';
import { headsDept } from '@/lib/auth/depts';
import { emit } from './events';
import { loadMemory, memoryFor } from './memory';
import { byId, persona, teamLead, HUMAN_HEAD } from './people';
import { errText } from '@/lib/errors';
import { withUsage } from '@/lib/usage';

/** What the Design Studio can make, with the shape Gemini draws it in. */
export const FORMATS = {
  post: { label: 'Instagram post', ratio: '1:1', size: '1080 × 1080', maker: 'designer' },
  portrait: { label: 'Instagram portrait', ratio: '4:5', size: '1080 × 1350', maker: 'designer' },
  story: { label: 'Story or reel cover', ratio: '9:16', size: '1080 × 1920', maker: 'designer' },
  web_banner: { label: 'Website banner', ratio: '16:9', size: '1920 × 1080', maker: 'designer' },
  poster: { label: 'In-store poster', ratio: '3:4', size: 'A-series portrait', maker: 'printDesigner' },
} as const;
export type Format = keyof typeof FORMATS;
export const LANGS = { en: 'English', ml: 'Malayalam' } as const;

type Check = { ok: boolean; note: string };

/** The head of the Creative Studio and the Super Admin can order designs. */
export const canDesign = (db: SupabaseClient, role: string) => headsDept(db, role, 'creative');

/**
 * A head asks for a banner or poster. The Banner Designer (or the Print Designer for posters) builds it with Gemini
 * around the real Shopify photos, then their AI team lead compares it with those photos before the Creative Head sees it.
 * One redo is allowed when the lead finds a problem; after that the design is kept with the lead's note.
 */
export async function makeDesign(db: SupabaseClient, o: { format: Format; brief: string; headline: string; language: keyof typeof LANGS; productIds: number[]; userId: string }) {
  await loadMemory(db);
  const f = FORMATS[o.format];
  if (!f) throw new Error('Pick a format.');
  if (!o.brief.trim()) throw new Error('Describe what the design is for.');
  if (!has('GEMINI_API_KEY')) throw new Error('GEMINI_API_KEY is not set, so the designers cannot draw yet.');
  const { data: prods } = await db.from('products').select('id, title, price, image_url').in('id', o.productIds.slice(0, 3));
  const photos = (prods || []).map(p => p.image_url).filter(Boolean) as string[];
  if (!photos.length) throw new Error('Pick at least one product that has a photo in Shopify.');

  const { data: d, error } = await db.from('designs').insert({ requested_by: o.userId, format: o.format, brief: o.brief, headline: o.headline || null, language: o.language, product_ids: o.productIds.slice(0, 3) }).select().single();
  if (error) throw error;
  const maker = f.maker, lead = teamLead(byId[maker].room) || 'creativeDirector', head = HUMAN_HEAD[byId[maker].room];
  try {
    let headline = o.headline.trim();
    if (!headline && has('OPENAI_API_KEY')) {
      await emit(db, null, 'think', 'copywriter', `Writing a headline for a ${f.label.toLowerCase()}`);
      headline = (await withUsage({ feature: 'design' }, () => chatJSON<{ headline: string }>('worker', persona('copywriter', `Write one headline of at most 6 words in ${LANGS[o.language]}. Shape: {"headline": "..."}`), `${o.brief}\nProducts: ${(prods || []).map(p => p.title).join(', ')}`))).headline;
    }
    await emit(db, null, 'think', maker, `Designing a ${f.label.toLowerCase()}: ${o.brief.slice(0, 80)}`);
    const parts = await Promise.all(photos.map(imagePart));
    const text = headline ? `Set the headline "${headline}" in elegant ${o.language === 'ml' ? 'Malayalam script, spelled exactly as given,' : 'serif type'} with generous margins. Add the small wordmark "PARAKKAT JEWELS". No other text, no prices.` : 'No text on the image.';
    const prompt = (fix = '') => `${f.label} (${f.size}, ${f.ratio}) for Parakkat Jewels, a heritage Kerala jeweller. Brief: ${o.brief}.
Look: luxurious and warm, deep green or black with champagne-gold accents, soft studio light, tasteful Kerala touches. ${o.format === 'poster' ? 'Print-ready poster layout with the jewellery as the hero.' : ''}
${text}${fix ? `\nFix this from the last attempt: ${fix}` : ''}
${memoryFor(byId[maker].room)}`;

    let img = await withUsage({ feature: 'design', agent: maker }, () => bannerImage(prompt(), photos, f.ratio, parts)), check: Check = { ok: true, note: '' };
    for (let attempt = 1; ; attempt++) {
      await emit(db, null, 'think', lead, `Checking the ${f.label.toLowerCase()} against the product photos`);
      check = await geminiJSON<Check>(`You are ${byId[lead].name}, checking a design before the ${byId[head].name} sees it. The first image is the design; the others are the real product photos.
ok is false if the jewellery differs from the photos (shape, stones, colour), any text is misspelled or not "${headline || 'none'}" plus the wordmark, there are prices or offers, or it looks cheap.
Shape: {"ok": true|false, "note": "one sentence"}`, [{ inlineData: { mimeType: img.mimeType, data: img.data.toString('base64') } }, ...parts]);
      if (check.ok || attempt === 2) break;
      await emit(db, null, 'feedback', lead, `Redo: ${check.note}`, maker);
      img = await withUsage({ feature: 'design', agent: maker }, () => bannerImage(prompt(check.note), photos, f.ratio, parts));
    }
    const path = `designs/${d.id}.${img.mimeType.split('/')[1] || 'png'}`;
    const up = await db.storage.from('creatives').upload(path, img.data, { contentType: img.mimeType, upsert: true });
    if (up.error) throw up.error;
    await db.from('designs').update({ image_path: path, headline: headline || null, status: check.ok ? 'ready' : 'needs_fix', review_note: check.note }).eq('id', d.id);
    await emit(db, null, 'walk', maker, `${f.label} is ready: ${o.brief.slice(0, 60)}`, lead, { design_id: d.id });
    await emit(db, null, check.ok ? 'report' : 'feedback', lead, check.ok ? `Checked and sent to the ${byId[head].name}: ${check.note}` : `Kept with a note: ${check.note}`, head, { design_id: d.id });
    return d.id as string;
  } catch (e) {
    await db.from('designs').update({ status: 'failed', error: (errText(e)).slice(0, 500) }).eq('id', d.id);
    throw e;
  }
}
