import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bannerImage, geminiJSON, imagePart } from '@/lib/llm/gemini';
import { canWrite, chatJSON } from '@/lib/llm/openai';
import { has } from '@/lib/env';
import { headsDept } from '@/lib/auth/depts';
import { emit } from './events';
import { loadMemory, memoryFor } from './memory';
import { byId, persona, teamLead, HUMAN_HEAD } from './people';
import { errText } from '@/lib/errors';
import { withUsage } from '@/lib/usage';
import { pickRefs, refParts } from './library';
import { recentConcepts, refLine, versionPath } from './library-core.mjs';

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
export type Source = 'design' | 'creative';

type Check = { ok: boolean; note: string };
type Spec = { format: Format; brief: string; occasion?: string | null; headline: string; language: keyof typeof LANGS; productIds: number[]; note?: string | null; previous?: { concept: string | null; ref_ids: string[] } | null; runId?: string | null };

/** The head of the Creative Studio and the Super Admin can order designs. */
export const canDesign = (db: SupabaseClient, role: string) => headsDept(db, role, 'creative');

/**
 * How every AI image is made, for Studio orders and campaign banners alike:
 * 1. The closest past Parakkat designs come out of the design library as style references.
 * 2. The Creative Director writes a fresh concept from the brief and those references, told which concepts were used
 *    lately so the next one differs, and what the head asked to change on a redesign.
 * 3. The Banner Designer (or the Print Designer for posters) draws it with Gemini around the real Shopify photos.
 * 4. Their AI team lead compares it with the photos and the references; one redo is allowed.
 */
async function artwork(db: SupabaseClient, s: Spec) {
  await loadMemory(db);
  const f = FORMATS[s.format] || FORMATS.post;
  if (!has('GEMINI_API_KEY')) throw new Error('GEMINI_API_KEY is not set, so the designers cannot draw yet.');
  const { data: prods } = await db.from('products').select('id, title, price, image_url').in('id', s.productIds.slice(0, 3));
  const photos = (prods || []).map(p => p.image_url).filter(Boolean) as string[];
  if (!photos.length) throw new Error('None of the products has a photo in Shopify.');
  const maker = f.maker, lead = teamLead(byId[maker].room) || 'creativeDirector', head = HUMAN_HEAD[byId[maker].room], run = s.runId || null;
  const feature = run ? 'campaign' : 'design';

  let headline = s.headline.trim();
  if (!headline && canWrite()) {
    await emit(db, run, 'think', 'copywriter', `Writing a headline for a ${f.label.toLowerCase()}`);
    headline = (await withUsage({ feature }, () => chatJSON<{ headline: string }>('worker', persona('copywriter', `Write one headline of at most 6 words in ${LANGS[s.language]}. Shape: {"headline": "..."}`), `${s.brief}\nProducts: ${(prods || []).map(p => p.title).join(', ')}`))).headline;
  }

  // a redesign looks somewhere new: last time's references are left out unless nothing else fits
  const words = [s.occasion || '', s.brief, f.label];
  let refs = await pickRefs(db, words, 3, s.previous?.ref_ids || []);
  if (!refs.length && s.previous?.ref_ids.length) refs = await pickRefs(db, words, 3);
  const [refImgs, [{ data: d1 }, { data: d2 }]] = await Promise.all([refParts(db, refs), Promise.all([
    db.from('designs').select('concept').not('concept', 'is', null).order('created_at', { ascending: false }).limit(8),
    db.from('creatives').select('concept').not('concept', 'is', null).order('created_at', { ascending: false }).limit(8),
  ])]);
  const used = recentConcepts([...(d1 || []), ...(d2 || [])]);

  await emit(db, run, 'think', 'creativeDirector', refImgs.length ? `Art direction for a ${f.label.toLowerCase()}, from ${refImgs.length} of our past designs` : `Art direction for a ${f.label.toLowerCase()}`, maker);
  let concept = '';
  try {
    if (canWrite()) concept = (await withUsage({ feature }, () => chatJSON<{ concept: string }>('manager', persona('creativeDirector', `Write the art direction for one new design, as a brief to the designer.
It must reach the level of Parakkat's best past designs and must not repeat a concept used lately. Be concrete: the scene or background, props and Kerala touches if any,
light, how the jewellery sits in the frame, where the headline and the wordmark go, the type style, and the colour palette.
${s.note ? 'This is a redesign. Do what the head asked, and change the direction where they did not like it.' : ''}
Shape: {"concept": "4 to 6 sentences"}`), [
      `Format: ${f.label} (${f.ratio}). Brief: ${s.brief}${s.occasion ? `\nOccasion: ${s.occasion}` : ''}`,
      `Products: ${(prods || []).map(p => p.title).join(', ')}`,
      headline ? `Headline on the design: ${headline}` : 'No text on the design except the wordmark.',
      refImgs.length ? `Past Parakkat designs chosen as references (take their standard, not their layout):\n${refImgs.map((r, i) => refLine(r.ref, i)).join('\n')}` : 'No past designs in the library yet: aim for a luxury jeweller\'s campaign standard.',
      used.length ? `Concepts used lately, do not repeat these:\n${used.map(c => `- ${c}`).join('\n')}` : '',
      s.previous?.concept ? `The last version of this design: ${s.previous.concept}` : '',
      s.note ? `What the head asked to change: ${s.note}` : '',
    ].filter(Boolean).join('\n\n')))).concept || '';
  } catch { /* the designer still has the brief and the references */ }

  await emit(db, run, 'think', maker, `Designing a ${f.label.toLowerCase()}: ${(concept || s.brief).slice(0, 90)}`);
  const parts = await Promise.all(photos.map(imagePart));
  const text = headline ? `Set the headline "${headline}" in elegant ${s.language === 'ml' ? 'Malayalam script, spelled exactly as given,' : 'type'} as the art direction says. Add the small wordmark "PARAKKAT JEWELS". No other text, no prices.` : 'No text on the image except the small wordmark "PARAKKAT JEWELS".';
  const prompt = (fix = '') => `${f.label} (${f.size}, ${f.ratio}) for Parakkat Jewels, a heritage Kerala jeweller. Brief: ${s.brief}.
${concept ? `Art direction: ${concept}` : 'Look: luxurious and warm, rich colour with gold accents, soft studio light, tasteful Kerala touches.'}
${s.format === 'poster' ? 'Print-ready poster layout with the jewellery as the hero.' : ''}
${text}
It must look like a finished campaign by a top jewellery brand, not a template.${s.note ? `\nThe head asked for this change: ${s.note}` : ''}${fix ? `\nFix this from the last attempt: ${fix}` : ''}
${memoryFor(byId[maker].room)}`;
  const refsIn = refImgs.map(r => r.part);

  let img = await withUsage({ feature, agent: maker }, () => bannerImage(prompt(), photos, f.ratio, parts, refsIn)), check: Check = { ok: true, note: '' };
  for (let attempt = 1; ; attempt++) {
    await emit(db, run, 'think', lead, `Checking the ${f.label.toLowerCase()} against the product photos`);
    check = await geminiJSON<Check>(`You are ${byId[lead].name}, checking a design before the ${byId[head].name} sees it. The first image is the design; the others are the real product photos.
ok is false if the jewellery differs from the photos (shape, stones, colour), any text is misspelled or not "${headline || 'none'}" plus the wordmark, there are prices or offers, it looks cheap or generic${s.note ? `, or it ignores what the head asked: "${s.note}"` : ''}.
Shape: {"ok": true|false, "note": "one sentence"}`, [{ inlineData: { mimeType: img.mimeType, data: img.data.toString('base64') } }, ...parts]);
    if (check.ok || attempt === 2) break;
    await emit(db, run, 'feedback', lead, `Redo: ${check.note}`, maker);
    img = await withUsage({ feature, agent: maker }, () => bannerImage(prompt(check.note), photos, f.ratio, parts, refsIn));
  }
  return { img, check, concept: concept || null, refIds: refImgs.map(r => r.ref.id), headline, f, maker, lead, head };
}

/** A head orders a design. It is queued and drawn in the background, so the page is free while it is made. */
export async function queueDesign(db: SupabaseClient, o: { format: Format; brief: string; headline: string; language: keyof typeof LANGS; productIds: number[]; userId: string }) {
  if (!FORMATS[o.format]) throw new Error('Pick a format.');
  if (!o.brief.trim()) throw new Error('Describe what the design is for.');
  if (!has('GEMINI_API_KEY')) throw new Error('GEMINI_API_KEY is not set, so the designers cannot draw yet.');
  if (!o.productIds.length) throw new Error('Pick at least one product that has a photo in Shopify.');
  const { data, error } = await db.from('designs').insert({ requested_by: o.userId, format: o.format, brief: o.brief, headline: o.headline || null, language: o.language,
    product_ids: o.productIds.slice(0, 3), status: 'queued', queued_at: new Date().toISOString() }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

/** A head asks for a new version of any AI image, with an optional note on what to change. */
export async function queueRedesign(db: SupabaseClient, source: Source, id: string, note: string) {
  const at = new Date().toISOString(), redo_note = note.trim().slice(0, 600) || null;
  const q = source === 'design'
    ? db.from('designs').update({ status: 'queued', queued_at: at, redo_note, error: null }).eq('id', id).not('status', 'in', '(queued,making)')
    : db.from('creatives').update({ art_status: 'queued', queued_at: at, redo_note, art_error: null }).eq('id', id).or('art_status.is.null,art_status.not.in.(queued,making)');
  const { data, error } = await q.select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('That image is already being redesigned.');
}

const STALE_MIN = 8; // a drawing that has not finished in this long died with its server call and is taken up again

/** Take one queued image and draw it. Returns false when someone else already took it. */
export async function drawItem(db: SupabaseClient, source: Source, id: string) {
  const stale = new Date(Date.now() - STALE_MIN * 6e4).toISOString(), at = new Date().toISOString();
  const claim = source === 'design'
    ? db.from('designs').update({ status: 'making', queued_at: at }).eq('id', id).or(`status.eq.queued,and(status.eq.making,queued_at.lt.${stale})`)
    : db.from('creatives').update({ art_status: 'making', queued_at: at }).eq('id', id).or(`art_status.eq.queued,and(art_status.eq.making,queued_at.lt.${stale})`);
  const { data: got } = await claim.select('id');
  if (!got?.length) return false;

  const row = source === 'design'
    ? (await db.from('designs').select('format, brief, headline, language, product_ids, image_path, concept, ref_ids, versions, redo_note').eq('id', id).single()).data
    : (await db.from('creatives').select('format, headline, body, language, product_ids, image_path, concept, ref_ids, versions, redo_note, campaign_id, campaigns(name, occasion, run_id, plan)').eq('id', id).single()).data;
  if (!row) return false;
  const camp = (row as any).campaigns as { name: string; occasion: string; run_id: string | null; plan: any } | null;
  const spec: Spec = {
    format: (row.format in FORMATS ? row.format : 'post') as Format,
    brief: source === 'design' ? (row as any).brief : `${camp?.name || 'Campaign'} for ${camp?.occasion || 'the season'}. ${camp?.plan?.audiences ? `Audience: ${camp.plan.audiences}. ` : ''}${(row as any).body || ''}`.trim(),
    occasion: camp?.occasion || null, headline: row.headline || '', language: (row.language in LANGS ? row.language : 'en') as keyof typeof LANGS,
    productIds: (row.product_ids || []).map(Number), note: row.redo_note, runId: camp?.run_id || null,
    previous: row.image_path ? { concept: row.concept, ref_ids: row.ref_ids || [] } : null,
  };
  const table = source === 'design' ? 'designs' : 'creatives';
  try {
    const a = await artwork(db, spec);
    // a redesign keeps the earlier version's file and notes; the new one gets the next number
    const versions = row.image_path ? [...(row.versions || []), { image_path: row.image_path, concept: row.concept, note: row.redo_note, at }] : (row.versions || []);
    const ext = a.img.mimeType.split('/')[1] || 'png';
    const base = source === 'design' ? `designs/${id}.${ext}` : `${(row as any).campaign_id}/banner-${id.slice(0, 8)}.${ext}`;
    const path = versionPath(base, versions.length + 1);
    const up = await db.storage.from('creatives').upload(path, a.img.data, { contentType: a.img.mimeType, upsert: true });
    if (up.error) throw up.error;
    const status = a.check.ok ? 'ready' : 'needs_fix';
    const common = { image_path: path, headline: a.headline || null, concept: a.concept, ref_ids: a.refIds, versions, queued_at: null };
    const { error } = source === 'design'
      ? await db.from('designs').update({ ...common, status, review_note: a.check.note, error: null }).eq('id', id)
      : await db.from('creatives').update({ ...common, art_status: status, review_note: a.check.note, art_error: null }).eq('id', id);
    if (error) throw error;
    // a new version is a new image to judge: the old review stays a lesson but no longer marks this one
    if (row.image_path) await db.from('image_reviews').delete().eq('source', source).eq('item_id', id);
    const what = source === 'design' ? spec.brief.slice(0, 60) : camp?.name || 'campaign banner';
    await emit(db, spec.runId || null, 'walk', a.maker, `${a.f.label}${row.image_path ? ` version ${versions.length + 1}` : ''} is ready: ${what}`, a.lead, { [source === 'design' ? 'design_id' : 'creative_id']: id });
    await emit(db, spec.runId || null, a.check.ok ? 'report' : 'feedback', a.lead, a.check.ok ? `Checked and sent to the ${byId[a.head].name}: ${a.check.note}` : `Kept with a note: ${a.check.note}`, a.head, { [source === 'design' ? 'design_id' : 'creative_id']: id });
    return true;
  } catch (e) {
    const msg = errText(e).slice(0, 500);
    if (source === 'design') await db.from(table).update({ status: row.image_path ? 'ready' : 'failed', error: msg, queued_at: null }).eq('id', id);
    else await db.from(table).update({ art_status: row.image_path ? 'ready' : 'failed', art_error: msg, queued_at: null }).eq('id', id);
    throw e;
  }
}

/** The tick's catch-up: draws an image whose background call never ran or died. One per tick, oldest first. */
export async function drainDesignQueue(db: SupabaseClient) {
  const stale = new Date(Date.now() - STALE_MIN * 6e4).toISOString(), late = new Date(Date.now() - 6e4).toISOString();
  // queued for over a minute means the call that queued it did not start it; making for long means it died
  const pick = `and(status.eq.queued,queued_at.lt.${late}),and(status.eq.making,queued_at.lt.${stale})`;
  const [{ data: d }, { data: c }] = await Promise.all([
    db.from('designs').select('id, queued_at').or(pick).order('queued_at').limit(1),
    db.from('creatives').select('id, queued_at').or(pick.replace(/status/g, 'art_status')).order('queued_at').limit(1),
  ]);
  const next = [...(d || []).map(x => ({ ...x, source: 'design' as const })), ...(c || []).map(x => ({ ...x, source: 'creative' as const }))]
    .sort((a, b) => String(a.queued_at).localeCompare(String(b.queued_at)))[0];
  if (!next) return null;
  try { await drawItem(db, next.source, next.id); return `${next.source} ${next.id}: drawn`; } catch (e) { return `${next.source} ${next.id}: ${errText(e).slice(0, 120)}`; }
}
