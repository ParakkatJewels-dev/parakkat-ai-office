import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bannerImage, geminiJSON, imagePart } from '@/lib/llm/gemini';
import { canWrite, chatJSON } from '@/lib/llm/openai';
import { geminiConfigured } from '@/lib/llm/gemini-config';
import { headsDept } from '@/lib/auth/depts';
import { emit } from './events';
import { loadMemory } from './memory';
import { byId, persona, teamLead, HUMAN_HEAD } from './people';
import { errText } from '@/lib/errors';
import { withUsage } from '@/lib/usage';
import { withAgentWork } from './agent-work';
import { pickRefs, refParts } from './library';
import { recentConcepts, refLine, versionPath } from './library-core.mjs';
import { fetchShopifyPhoto, imageReferencePart, renderCarouselCard, shopifyPhotoUrl } from './carousel-card.mjs';
import { carouselBackgroundFor } from './carousel';
import { isChatGPTHandoff } from '@/lib/artwork-mode.mjs';

/** What the Design Studio can make, with the shape Gemini draws it in. */
export const FORMATS = {
  carousel_card: { label: 'Carousel card', ratio: '4:5', size: '1080 × 1350', maker: 'designer' },
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

export async function carouselArtwork(db: SupabaseClient, row: any) {
  if (isChatGPTHandoff()) throw new Error('Generate this card in ChatGPT or Higgsfield, then import the chosen image for human review.');
  const source = row.carousel_source, index = Number(row.carousel_index);
  if (!source || index < 1 || index > 5 || String(row.product_ids?.[0]) !== String(source.product_id) || !shopifyPhotoUrl(source.image_url))
    throw new Error('The saved carousel source is incomplete.');
  await emit(db, null, 'think', 'designer', `Generating carousel card ${index} of 5 using the Shopify product photo as the reference.`, 'creativeDirector');
  const [imageBytes, background] = await Promise.all([fetchShopifyPhoto(source.image_url), carouselBackgroundFor(db, row.carousel_id)]);
  const [photoPart, stylePart] = await Promise.all([imageReferencePart(imageBytes), imageReferencePart(background.bytes)]);
  const brief = `Create the complete photographic scene for card ${index} of a premium five-card Parakkat Jewels ${source.category} carousel. Use the PRODUCT PHOTO as the identity reference for the one hero product. Render that same product afresh in the scene: preserve its distinctive shape, metal colour, stone count, colours, arrangement, prongs, motifs, band and proportions. Do not cut out, paste, collage, trace or frame the source photo. Do not substitute a similar-looking product or add other jewellery. Use the supplied STYLE image for its mood, materials, lighting and palette, not as a product source. Leave the top 18% and bottom 20% of the canvas free of jewellery for brand typography added later. No words, logos, prices, badges or watermarks. The result should be one cohesive luxury photograph, 4:5 aspect ratio.${row.redo_note ? ` Art direction requested by the manager: ${String(row.redo_note).slice(0,600)}.` : ''}`;
  let scene = await withUsage({ feature: 'design', agent: 'designer' }, () => bannerImage(brief, [], '4:5', [photoPart], [stylePart], {db,id:'designer'}));
  let img = await renderCarouselCard({ title: source.title, index, category: source.category, sceneBytes: scene.data });
  let check: Check = { ok: false, note: 'Product identity and design quality have not been checked.' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    await emit(db, null, 'think', 'creativeDirector', `Checking card ${index} against its official product photo, style and art direction.`, 'designer');
    const verdict = await withUsage({ feature: 'design', agent: 'creativeDirector' }, () => geminiJSON<{sameProduct:boolean;designQuality:boolean;followsDirection:boolean;note:string}>(`Review the FINISHED CARD (first image), OFFICIAL SHOPIFY PRODUCT PHOTO (second image), and STYLE REFERENCE (third image). Return three independent checks; all must pass.
sameProduct: compare distinctive silhouette, metal tone, stone count, colour and arrangement, setting, prongs, band and motifs. Pose, lighting and scale may change. Fail if a distinguishing feature differs, the product is hidden or cropped so it cannot be verified, extra jewellery appears, or the match is uncertain. Do not infer hidden details.
designQuality: require a cohesive premium jewellery photograph, realistic materials, controlled lighting, clear product emphasis, balanced composition, readable typography and clean spacing. Fail for visible rendering defects, clutter, flat or cheap-looking treatment, awkward crop, overlapping text, or a pasted photo/white product-photo panel. Check the finish of the complete card, including the brand typography added after generation.
followsDirection: compare the scene's palette, mood, materials and lighting to the STYLE REFERENCE and the requested art direction below. The style image is not a product source. Do not require a literal copy of its layout. Fail if the requested change is ignored.
Requested art direction: ${brief}
The finished card may include only the added PARAKKAT JEWELS branding, product title ${JSON.stringify(source.title)}, category ${JSON.stringify(source.category)}, card number and brand call to action; no prices, offers or unrequested claims/badges such as "24K gold layered" or "trusted quality". Treat any uncertain check as failed.
Reply with JSON: {"sameProduct":true|false,"designQuality":true|false,"followsDirection":true|false,"note":"specific visible defects and corrections for every failed check, or concise evidence when all pass"}.`, [{inlineData:{mimeType:img.mimeType,data:img.data.toString('base64')}},photoPart,stylePart], {db,id:'creativeDirector'}));
    if (typeof verdict?.sameProduct !== 'boolean' || typeof verdict.designQuality !== 'boolean' || typeof verdict.followsDirection !== 'boolean' || typeof verdict.note !== 'string' || !verdict.note.trim()) throw new Error('The carousel quality review did not return a valid verdict.');
    check = { ok: verdict.sameProduct && verdict.designQuality && verdict.followsDirection, note: verdict.note.trim() };
    if (check.ok || attempt === 2) break;
    await emit(db, null, 'feedback', 'creativeDirector', `Carousel needs correction: ${check.note}`, 'designer');
    scene = await withUsage({ feature: 'design', agent: 'designer' }, () => bannerImage(`${brief}\nCorrect these findings from the previous attempt: ${check.note}. Preserve the exact Shopify product identity, premium finish and requested art direction.`, [], '4:5', [photoPart], [stylePart], {db,id:'designer'}));
    img = await renderCarouselCard({ title: source.title, index, category: source.category, sceneBytes: scene.data });
  }
  return {
    img, check,
    concept: 'The jewellery and scene were generated together from the official Shopify product photo and the selected Design Library style. Product identity was checked against the photo; design finish and requested art direction were also reviewed. Human visual review is still required.',
    refIds: background.refIds, headline: source.title, f: FORMATS.carousel_card,
    maker: 'designer', lead: 'creativeDirector', head: HUMAN_HEAD[byId.designer.room],
  };
}

/** The head of the Creative Studio and the Super Admin can order designs. */
export const canDesign = (db: SupabaseClient, role: string) => headsDept(db, role, 'creative');
/** Any human department head may request and review their own Studio images. */
export const canUseStudio = (_db: SupabaseClient, role: string) => Promise.resolve(['super_admin','creative_head','ecom_manager','perf_marketer'].includes(role));

/**
 * How every AI image is made, for Studio orders and campaign banners alike:
 * 1. The closest past Parakkat designs come out of the design library as style references.
 * 2. The Creative Director writes a fresh concept from the brief and those references, told which concepts were used
 *    lately so the next one differs, and what the head asked to change on a redesign.
 * 3. The Banner Designer (or the Print Designer for posters) renders a new scene using real Shopify photos as product identity references.
 * 4. Their AI team lead compares it with the photos and the references; one redo is allowed.
 */
async function artwork(db: SupabaseClient, s: Spec) {
  await loadMemory(db);
  const f = FORMATS[s.format] || FORMATS.post;
  if (!await geminiConfigured()) throw new Error('Add a Gemini key in Settings → AI providers before generating images.');
  const { data: prods } = await db.from('products').select('id, title, price, image_url').in('id', s.productIds.slice(0, 3));
  const photos = (prods || []).map(p => p.image_url).filter(Boolean) as string[];
  if (!photos.length) throw new Error('None of the products has a photo in Shopify.');
  const maker = f.maker, lead = teamLead(byId[maker].room) || 'creativeDirector', head = HUMAN_HEAD[byId[maker].room], run = s.runId || null;
  const feature = run ? 'campaign' : 'design';
  if (!await canWrite()) throw new Error('Creative Director art direction is unavailable. Restore the text provider before requesting an image.');

  let headline = s.headline.trim();
  if (!headline) {
    await emit(db, run, 'think', 'copywriter', `Writing a headline for a ${f.label.toLowerCase()}`);
    const copy = await withUsage({ feature }, async () => chatJSON<{ headline?: unknown }>('worker', await persona(db, 'copywriter', `Write one headline of at most 6 words in ${LANGS[s.language]}. Shape: {"headline": "..."}`), `${s.brief}\nProducts: ${(prods || []).map(p => p.title).join(', ')}`));
    headline = typeof copy?.headline === 'string' ? copy.headline.trim() : '';
    if (!headline) throw new Error('The copywriter did not return a valid headline. No image was requested.');
  }

  // Product and requested direction determine relevance; a redesign can keep
  // its strongest reference instead of trading brand fit for random variety.
  const productTitles = (prods || []).map(p => p.title);
  const words = [...productTitles, s.occasion || '', s.brief, s.note || '', f.label];
  const refs = await pickRefs(db, words, 3, s.previous?.ref_ids || [], {productTitles, direction:s.note || '', format:f.label});
  const [refImgs, [{ data: d1 }, { data: d2 }]] = await Promise.all([refParts(db, refs), Promise.all([
    db.from('designs').select('concept').not('concept', 'is', null).order('created_at', { ascending: false }).limit(8),
    db.from('creatives').select('concept').not('concept', 'is', null).order('created_at', { ascending: false }).limit(8),
  ])]);
  const used = recentConcepts([...(d1 || []), ...(d2 || [])]);

  await emit(db, run, 'think', 'creativeDirector', refImgs.length ? `Art direction for a ${f.label.toLowerCase()}, from ${refImgs.length} of our past designs` : `Art direction for a ${f.label.toLowerCase()}`, maker);
  const direction = await withUsage({ feature }, async () => chatJSON<{ concept?: unknown }>('manager', await persona(db, 'creativeDirector', `Write the art direction for one new design, as a brief to the designer.
It must reach the level of Parakkat's best past designs and must not repeat a concept used lately. Be concrete: the scene or background, props and Kerala touches if any,
light, how the jewellery sits in the frame, where the headline and the wordmark go, the type style, and the colour palette.
Use the first selected reference as the primary visual direction unless the manager asks otherwise. Other references support craftsmanship and finish; do not blend conflicting palettes, scenes or props into that direction.
${s.note ? 'This is a redesign. Do what the head asked, and change the direction where they did not like it.' : ''}
Shape: {"concept": "4 to 6 sentences"}`), [
      `Format: ${f.label} (${f.ratio}). Brief: ${s.brief}${s.occasion ? `\nOccasion: ${s.occasion}` : ''}`,
      `Products: ${(prods || []).map(p => p.title).join(', ')}`,
      headline ? `Headline on the design: ${headline}` : 'No text on the design except the wordmark.',
      refImgs.length ? `Past Parakkat designs chosen as references (take their standard, not their layout):\n${refImgs.map((r, i) => refLine(r.ref, i)).join('\n')}` : 'No past designs in the library yet: aim for a luxury jeweller\'s campaign standard.',
      used.length ? `Concepts used lately, do not repeat these:\n${used.map(c => `- ${c}`).join('\n')}` : '',
      s.previous?.concept ? `The last version of this design: ${s.previous.concept}` : '',
      s.note ? `What the head asked to change: ${s.note}` : '',
    ].filter(Boolean).join('\n\n'),{useCase:'decision'}));
  const concept = typeof direction?.concept === 'string' ? direction.concept.trim() : '';
  if (!concept) throw new Error('The Creative Director did not return valid art direction. No image was requested.');

  await emit(db, run, 'think', maker, `Designing a ${f.label.toLowerCase()}: ${concept.slice(0, 90)}`);
  const parts = await Promise.all(photos.map(imagePart));
  const text = `Set the headline "${headline}" in elegant ${s.language === 'ml' ? 'Malayalam script, spelled exactly as given,' : 'type'} as the art direction says. Add the small wordmark "PARAKKAT JEWELS". No other text, prices, offer badges or added product/quality claims such as "24K gold layered" or "trusted quality".`;
  const prompt = (fix = '') => `${f.label} (${f.size}, ${f.ratio}) for Parakkat Jewels, a heritage Kerala jeweller. Brief: ${s.brief}.
Art direction: ${concept}
${s.format === 'poster' ? 'Print-ready poster layout with the jewellery as the hero.' : ''}
${text}
It must look like a finished campaign by a top jewellery brand, not a template.${s.note ? `\nThe head asked for this change: ${s.note}` : ''}${fix ? `\nFix this from the last attempt: ${fix}` : ''}`;
  const refsIn = refImgs.flatMap(r => r.parts || [r.part]);

  let img = await withUsage({ feature, agent: maker }, () => bannerImage(prompt(), photos, f.ratio, parts, refsIn, {db,id:maker})), check: Check = { ok: false, note: 'Image quality has not been reviewed.' };
  for (let attempt = 1; ; attempt++) {
    await emit(db, run, 'think', lead, `Checking the ${f.label.toLowerCase()} against the product photos`);
    check = await withUsage({ feature, agent: lead }, () => geminiJSON<Check>(`Check the finished design before the ${byId[head].name} sees it. Image 1 is the finished design. The next ${parts.length} image(s) are the real product photos, used only to check product identity. Labelled style fingerprints and original design images follow the product photos; use them to judge the visual standard, never as product evidence.
Return ok=false if any requirement fails or cannot be verified:
- The jewellery must preserve the source products' distinctive shape, stones, settings, metal colour and proportions. Reject missing, extra, obscured or mismatched jewellery; do not infer hidden details.
- Require a polished finish, realistic materials and lighting, clear product emphasis, balanced composition, readable typography and intentional spacing. Reject visible rendering defects, awkward cropping, clutter, overlapping text, or cheap/generic treatment.
- The scene, palette, lighting and layout must satisfy the brief and Creative Director direction below, with the original style images and saved fingerprints guiding the brand's standard of finish. Do not require literal copying of a reference.
- The only permitted text is the exact headline ${JSON.stringify(headline)} and the wordmark "PARAKKAT JEWELS". Reject misspellings, prices, offers, and unrequested badges or product/quality claims, including "24K gold layered" and "trusted quality". A claim appearing in a reference does not authorize adding it.
Format: ${f.label} (${f.size}, ${f.ratio}). Language: ${LANGS[s.language]}.
Brief: ${s.brief}
Creative Director art direction: ${concept}
${s.note ? `The head's requested change, which must also be checked: ${s.note}\n` : ''}Shape: {"ok": true|false, "note": "specific visible defects and corrections if failed, or concise evidence if passed"}`, [{ inlineData: { mimeType: img.mimeType, data: img.data.toString('base64') } }, ...parts, ...(refsIn.length ? [{ text: 'SAVED PARAKKAT STYLE FINGERPRINTS AND VISUAL REFERENCES (art direction only):' }, ...refsIn] : [])], {db,id:lead}));
    if (typeof check?.ok !== 'boolean' || typeof check.note !== 'string' || !check.note.trim()) throw new Error('The image reviewer did not return a valid quality verdict.');
    if (check.ok === true || attempt === 2) break;
    await emit(db, run, 'feedback', lead, `Redo: ${check.note}`, maker);
    img = await withUsage({ feature, agent: maker }, () => bannerImage(prompt(check.note), photos, f.ratio, parts, refsIn, {db,id:maker}));
  }
  return { img, check, concept, refIds: refImgs.map(r => r.ref.id), headline, f, maker, lead, head };
}

/** A head orders a design; manual artwork generation waits for the chosen image to be imported. */
export async function queueDesign(db: SupabaseClient, o: { format: Format; brief: string; headline: string; language: keyof typeof LANGS; productIds: number[]; userId: string }) {
  if (!FORMATS[o.format]) throw new Error('Pick a format.');
  if (o.format === 'carousel_card') throw new Error('Use the five-card carousel order for this format.');
  if (!o.brief.trim()) throw new Error('Describe what the design is for.');
  const handoff = isChatGPTHandoff();
  if (!handoff && !await geminiConfigured()) throw new Error('Add a Gemini key in Settings → AI providers before generating images.');
  if (!o.productIds.length) throw new Error('Pick at least one product that has a photo in Shopify.');
  const { data, error } = await db.from('designs').insert({ requested_by: o.userId, format: o.format, brief: o.brief, headline: o.headline || null, language: o.language,
    product_ids: o.productIds.slice(0, 3), status: handoff ? 'awaiting_import' : 'queued', queued_at: handoff ? null : new Date().toISOString(),
    artwork_request_id: handoff ? randomUUID() : null, artwork_handoff: null }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

/** A head asks for a new version of any AI image, with an optional note on what to change. */
export async function queueRedesign(db: SupabaseClient, source: Source, id: string, note: string) {
  // A saved note also distinguishes an explicit request for a campaign's first
  // image from an initial row left queued by an interrupted campaign stage.
  const at = new Date().toISOString(), redo_note = note.trim().slice(0, 600) || (source === 'creative' ? 'Try a different direction using the existing brief.' : null);
  const handoff = isChatGPTHandoff(), request = { queued_at: handoff ? null : at, artwork_request_id: handoff ? randomUUID() : null, artwork_handoff: null, redo_note };
  const q = source === 'design'
    ? db.from('designs').update({ status: handoff ? 'awaiting_import' : 'queued', ...request, error: null }).eq('id', id).not('status', 'in', '(queued,making,generating)')
    : db.from('creatives').update({ art_status: handoff ? 'awaiting_import' : 'queued', ...request, art_error: null }).eq('id', id).or('art_status.is.null,art_status.not.in.(queued,making,generating)');
  const { data, error } = await q.select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('That image is already being redesigned.');
}

const STALE_MIN = 8; // a drawing that has not finished in this long died with its server call and is taken up again

/** Convert an unclaimed or stale legacy job to a new import request, without replaying its model call. */
export async function prepareArtworkImport(db: SupabaseClient, source: Source, id: string, options?: { includeFailed?: boolean }) {
  if (!isChatGPTHandoff()) return false;
  const table = source === 'design' ? 'designs' : 'creatives', field = source === 'design' ? 'status' : 'art_status';
  const found = await db.from(table).select(`id,${field},queued_at,artwork_request_id,image_path${source === 'creative' ? ',campaigns(status)' : ''}`).eq('id', id).maybeSingle();
  if (found.error) throw found.error;
  const row = found.data as any;
  if (!row || row[field] === 'awaiting_import') return false;
  if (source === 'creative' && ['approved','publishing','publish_review','live'].includes(row.campaigns?.status)) {
    if (['queued','making'].includes(row[field])) {
      const cancelled = await db.from(table).update({art_status:row.image_path?'needs_fix':'failed',queued_at:null,
        art_error:'This campaign is approved. Its banner is frozen; the pending image request was cancelled.'}).eq('id',id).eq(field,row[field]);
      if (cancelled.error) throw cancelled.error;
    }
    return false;
  }
  const stale = Date.now() - STALE_MIN * 60000;
  const eligible = row[field] === 'queued' || (row[field] === 'making' && Date.parse(row.queued_at || '') < stale) ||
    (options?.includeFailed && !row.image_path && (row[field] === 'failed' || row[field] == null));
  if (!eligible) return false;
  let update = db.from(table).update({ [field]: 'awaiting_import', queued_at: null, artwork_request_id: randomUUID(), artwork_handoff: null,
    [source === 'design' ? 'error' : 'art_error']: null }).eq('id', id);
  update = row[field] == null ? update.is(field, null) : update.eq(field, row[field]);
  update = row.queued_at == null ? update.is('queued_at', null) : update.eq('queued_at', row.queued_at);
  update = row.artwork_request_id == null ? update.is('artwork_request_id', null) : update.eq('artwork_request_id', row.artwork_request_id);
  const saved = await update.select('id');
  if (saved.error) throw saved.error;
  return !!saved.data?.length;
}

/** Take one queued image and draw it. Returns false when someone else already took it. */
export async function drawItem(db: SupabaseClient, source: Source, id: string, options?:{campaignCheckpoint?:boolean}) {
  if (isChatGPTHandoff()) return prepareArtworkImport(db, source, id);
  // One background is shared by every card. Serialize workers for the same set,
  // including a Studio after() callback racing the minute scheduler.
  if (source === 'design') {
    const membership = await db.from('designs').select('carousel_id').eq('id', id).maybeSingle();
    if (membership.error) throw membership.error;
    if (membership.data?.carousel_id) {
      const holder = randomUUID(), lockName = `carousel:${membership.data.carousel_id}`;
      const lock = await db.rpc('acquire_job_lock',{p_name:lockName,p_holder:holder,p_seconds:900});
      if (lock.error) throw lock.error;
      if (!lock.data) return false;
      try { return await drawItemClaimed(db,source,id,options); }
      finally { await db.rpc('release_job_lock',{p_name:lockName,p_holder:holder}); }
    }
  }
  return drawItemClaimed(db,source,id,options);
}

async function drawItemClaimed(db: SupabaseClient, source: Source, id: string, options?:{campaignCheckpoint?:boolean}) {
  if (source === 'creative') {
    const { data, error } = await db.from('creatives').select('image_path,art_status,queued_at,redo_note,campaigns(status,run_id)').eq('id', id).maybeSingle();
    if (error) throw new Error('Could not check whether this campaign banner is editable.');
    if (['approved', 'publishing', 'publish_review', 'live'].includes((data?.campaigns as any)?.status)) {
      if (['queued', 'making'].includes(data?.art_status)) {
        const saved = await db.from('creatives').update({ art_status: data?.image_path ? 'needs_fix' : 'failed', queued_at: null,
          art_error: 'This campaign is approved. Its banner is frozen; the queued redesign was cancelled.' }).eq('id', id);
        if (saved.error) throw saved.error;
      }
      return false;
    }
    const runId = (data?.campaigns as any)?.run_id;
    if (runId && !options?.campaignCheckpoint) {
      const run = await db.from('agent_runs').select('state').eq('id',runId).maybeSingle();
      if (run.error) throw new Error('Could not verify the saved campaign image attempt.');
      const pending = run.data?.state?.checkpoints?.entries?.['create.artwork'];
      const explicitInitialRedesign = data?.art_status === 'queued' && typeof data?.redo_note === 'string' && !!data.redo_note.trim();
      const initialOwnedByCampaign = !data?.image_path && !explicitInitialRedesign;
      // A later explicit Studio redesign is a new request. Stale "making" work
      // is never permission to repeat an image call with an unknown outcome.
      const explicitRedesign = data?.art_status==='queued' && Date.parse(data.queued_at || '')>Date.parse(pending?.startedAt || '');
      const uncertainAttempt = pending?.status==='pending' && (!pending.resourceId || pending.resourceId===id) && !explicitRedesign;
      if (initialOwnedByCampaign || uncertainAttempt) {
        const stale = Date.now()-STALE_MIN*60000;
        // An untouched queued row still belongs to the campaign checkpoint. A
        // stale making row may have spent tokens and needs an explicit retry.
        if ((uncertainAttempt || data?.art_status === 'making') && Date.parse(data?.queued_at || '')<stale) {
          const stopped = await db.from('creatives').update({art_status:data?.image_path?'needs_fix':'failed',queued_at:null,
            art_error:'The previous campaign image attempt has an unknown outcome. Review the saved work, then explicitly retry the campaign or request a new Studio version.'})
            .eq('id',id).eq('art_status',data!.art_status).eq('queued_at',data!.queued_at);
          if (stopped.error) throw stopped.error;
        }
        return false;
      }
    }
  }
  const stale = new Date(Date.now() - STALE_MIN * 6e4).toISOString(), at = new Date().toISOString();
  const claim = source === 'design'
    ? db.from('designs').update({ status: 'making', queued_at: at }).eq('id', id).or(`status.eq.queued,and(status.eq.making,queued_at.lt.${stale})`)
    : db.from('creatives').update({ art_status: 'making', queued_at: at }).eq('id', id).or(`art_status.eq.queued,and(art_status.eq.making,queued_at.lt.${stale})`);
  const { data: got, error: claimError } = await claim.select('id');
  if (claimError) throw claimError;
  if (!got?.length) return false;

  const row = source === 'design'
    ? (await db.from('designs').select('format, brief, headline, language, product_ids, image_path, concept, ref_ids, versions, redo_note, carousel_source, carousel_index, carousel_id').eq('id', id).single()).data
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
  return withAgentWork({ agentId: FORMATS[spec.format].maker, kind: 'image', timeoutMs: 300_000 }, async () => {
  try {
    const a = source === 'design' && row.format === 'carousel_card' ? await carouselArtwork(db, row) : await artwork(db, spec);
    // a redesign keeps the earlier version's file and notes; the new one gets the next number
    const versions = row.image_path ? [...(row.versions || []), { image_path: row.image_path, concept: row.concept, note: row.redo_note, at }] : (row.versions || []);
    const ext = a.img.mimeType.split('/')[1] || 'png';
    const base = source === 'design' ? `designs/${id}.${ext}` : `${(row as any).campaign_id}/banner-${id.slice(0, 8)}.${ext}`;
    // Concurrent or resumed workers must never overwrite a file already approved
    // at this path. Each attempt produces a distinct, immutable artifact.
    const path = versionPath(base.replace(`.${ext}`, `-${randomUUID()}.${ext}`), versions.length + 1);
    const up = await db.storage.from('creatives').upload(path, a.img.data, { contentType: a.img.mimeType, upsert: false });
    if (up.error) throw up.error;
    const status = a.check.ok ? 'ready' : 'needs_fix';
    const common = { image_path: path, headline: a.headline || null, concept: a.concept, ref_ids: a.refIds, versions, queued_at: null,
      artwork_origin: 'gemini', artwork_request_id: null, artwork_handoff: null, imported_at: null, imported_by: null };
    const { error } = source === 'design'
      ? await db.from('designs').update({ ...common, status, review_note: a.check.note, error: null }).eq('id', id)
      : await db.from('creatives').update({ ...common, art_status: status, review_note: a.check.note, art_error: null }).eq('id', id);
    if (error) throw error;
    // a new version is a new image to judge: the old review stays a lesson but no longer marks this one
    if (row.image_path) await db.from('image_reviews').delete().eq('source', source).eq('item_id', id);
    const what = source === 'design' ? spec.brief.slice(0, 60) : camp?.name || 'campaign banner';
    if (source === 'design' && row.format === 'carousel_card') {
      await emit(db, null, a.check.ok ? 'report' : 'feedback', a.maker, a.check.ok
        ? `Generated carousel card ${(row as any).carousel_index}/5 passed the product and design quality checks and needs human visual review.`
        : `Carousel card ${(row as any).carousel_index}/5 needs correction: ${a.check.note}`, a.head, { design_id: id });
    } else {
      await emit(db, spec.runId || null, 'walk', a.maker, `${a.f.label}${row.image_path ? ` version ${versions.length + 1}` : ''} is ready: ${what}`, a.lead, { [source === 'design' ? 'design_id' : 'creative_id']: id });
      await emit(db, spec.runId || null, a.check.ok ? 'report' : 'feedback', a.lead, a.check.ok ? `Checked and sent to the ${byId[a.head].name}: ${a.check.note}` : `Kept with a note: ${a.check.note}`, a.head, { [source === 'design' ? 'design_id' : 'creative_id']: id });
    }
    return true;
  } catch (e) {
    const msg = errText(e).slice(0, 500);
    if (source === 'design') await db.from(table).update({ status: row.image_path ? 'needs_fix' : 'failed', error: msg, queued_at: null }).eq('id', id);
    else await db.from(table).update({ art_status: row.image_path ? 'needs_fix' : 'failed', art_error: msg, queued_at: null }).eq('id', id);
    throw e;
  }
  });
}

/** The tick's catch-up: draws an image whose background call never ran or died. One per tick, oldest first. */
export async function drainDesignQueue(db: SupabaseClient) {
  // Only saved, explicitly authorized jobs are advanced; old import briefs are never submitted here.
  if (isChatGPTHandoff()) {
    const { drainHiggsfieldGenerations } = await import('@/lib/artwork/generation');
    await drainHiggsfieldGenerations(db, 2);
  }
  const stale = new Date(Date.now() - STALE_MIN * 6e4).toISOString();
  // The claim is atomic. A newly queued image can start on the next tick even
  // if the request's own background callback has not begun yet.
  const pick = `status.eq.queued,and(status.eq.making,queued_at.lt.${stale})`;
  const [{ data: d }, { data: c }] = await Promise.all([
    db.from('designs').select('id, queued_at').or(pick).order('queued_at').limit(1),
    db.from('creatives').select('id, queued_at').or(pick.replace(/status/g, 'art_status')).order('queued_at').limit(1),
  ]);
  const next = [...(d || []).map(x => ({ ...x, source: 'design' as const })), ...(c || []).map(x => ({ ...x, source: 'creative' as const }))]
    .sort((a, b) => String(a.queued_at).localeCompare(String(b.queued_at)))[0];
  if (!next) return null;
  try { const claimed = await drawItem(db, next.source, next.id); return `${next.source} ${next.id}: ${claimed ? isChatGPTHandoff() ? 'awaiting artwork import' : 'drawn' : 'not claimed'}`; } catch (e) { return `${next.source} ${next.id}: ${errText(e).slice(0, 120)}`; }
}
