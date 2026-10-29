import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { conversationCategorySales, conversationSalesWindows, requestedSalesCategory } from './conversation-sales.mjs';
import { carouselSelection } from './carousel-core.mjs';
import { pickRefs, refParts } from './library';
import { carouselStyleBackground } from '@/lib/llm/gemini';
import { withUsage } from '@/lib/usage';
import { isChatGPTHandoff } from '@/lib/artwork-mode.mjs';

type Card = { id: string; carousel_index: number; artwork_origin?: string | null };
const referenceDriveId = (value: unknown) => String(value || '').match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] || null;
const canRequestStudioImage = (role: string) => ['super_admin','creative_head','ecom_manager','perf_marketer'].includes(role);

/** Read under the manager's RLS, then queue only the five verified photo cards. */
export async function queueSalesCarousel(admin: SupabaseClient, reader: SupabaseClient, options: {
  userId: string; role: string; category: string; taskId?: string; signal?: AbortSignal; referenceId?: string;
}): Promise<{ carouselId: string; cards: Card[]; products: any[]; from: string; to: string; referenceName: string }> {
  const { data: auth } = await reader.auth.getUser();
  if (!auth.user || auth.user.id !== options.userId || !canRequestStudioImage(options.role)) throw new Error('Only an authorized department head can order a carousel.');
  if (requestedSalesCategory(`top selling ${options.category}`) !== options.category) throw new Error('Choose a supported Shopify category.');
  const carouselId = options.taskId || randomUUID();
  if (options.taskId) {
    const existing = await admin.from('designs').select('id,carousel_index').eq('carousel_id', carouselId).order('carousel_index');
    if (existing.error) throw existing.error;
    if (existing.data?.length === 5) return { carouselId, cards: existing.data as Card[], products: [], from: '', to: '', referenceName: 'the saved Design Library reference' };
    if (existing.data?.length) throw new Error('The previous carousel order is incomplete; review it before retrying.');
  }
  const window = conversationSalesWindows().completeThirtyDays;
  const observedAt = new Date().toISOString();
  const evidence = await conversationCategorySales(reader, options.signal || AbortSignal.timeout(90_000), window, observedAt, options.category, 100);
  const products = carouselSelection(evidence);
  const requestedRef = String(options.referenceId || '').trim();
  const refId = /^[0-9a-f-]{36}$/i.test(requestedRef) ? requestedRef : null;
  const driveId = referenceDriveId(requestedRef);
  if (requestedRef && !refId && !driveId) throw new Error('Paste a Design Library reference ID or its Google Drive file link.');
  const refs = requestedRef
    ? (await (refId
        ? admin.from('design_refs').select('id,name,drive_id,modified_at,image_path,fingerprint,occasion,style,palette,layout,typography,kind').eq('id',refId)
        : admin.from('design_refs').select('id,name,drive_id,modified_at,image_path,fingerprint,occasion,style,palette,layout,typography,kind').eq('drive_id',driveId!))
      .eq('status','ready').eq('hidden',false).limit(1)).data || []
    : await pickRefs(admin, [options.category], 1);
  if (!refs.length) throw new Error('No ready Design Library reference was found for this carousel.');
  const handoff = isChatGPTHandoff();
  const set = await admin.from('carousel_sets').insert({ id: carouselId, requested_by: options.userId, category: options.category,
    window_from: window.from, window_to: window.to, ref_ids: refs.map(ref => ref.id), background_status: handoff ? 'unused' : 'queued' });
  if (set.error) throw set.error;
  const rows = products.map((product, index) => ({
    requested_by: options.userId, format: 'carousel_card',
    brief: `Five-card ${options.category} carousel from recorded Shopify sales, ${window.from} to ${window.to} UTC. Card ${index + 1} of 5. Use the selected design for style and the official Shopify photo as the reference for the same product. ${handoff ? 'Generate the finished card in ChatGPT or Higgsfield and import the chosen image. A human must compare the exact product and design quality before approval.' : 'Generate the jewellery as part of a new scene, then check its identity against the official photo.'} Draft for human review; do not publish.`,
    headline: product.title, language: 'en', product_ids: [Number(product.product_id)],
    status: handoff ? 'awaiting_import' : 'queued', queued_at: handoff ? null : observedAt, carousel_id: carouselId, carousel_index: index + 1,
    artwork_request_id: handoff ? randomUUID() : null, artwork_handoff: null, ref_ids: refs.map(ref => ref.id),
    carousel_source: {
      category: options.category, from: window.from, to: window.to, observed_at: observedAt,
      product_id: product.product_id, title: product.title, units: product.units,
      stock: product.stock, stock_source: product.stock_source, image_url: product.image_url,
    },
  }));
  const inserted = await admin.from('designs').insert(rows).select('id,carousel_index');
  if (inserted.error || inserted.data?.length !== 5) {
    await admin.from('carousel_sets').update({ background_status: 'failed', error: 'The five card records could not be queued.' }).eq('id',carouselId);
    throw inserted.error || new Error('The five cards could not be queued.');
  }
  return { carouselId, cards: inserted.data as Card[], products, from: window.from, to: window.to, referenceName: refs[0].name };
}

/** Keep the same five card rows and their previous image paths visible while new versions render. */
export async function queueCarouselRedesign(admin: SupabaseClient, reader: SupabaseClient, options: {
  userId: string; role: string; carouselId: string; note: string;
}): Promise<{ cards: Card[] }> {
  const { data: auth } = await reader.auth.getUser();
  if (!auth.user || auth.user.id !== options.userId || !canRequestStudioImage(options.role)) throw new Error('Only an authorized department head can redesign a carousel.');
  if (!/^[0-9a-f-]{36}$/i.test(options.carouselId)) throw new Error('Choose a saved carousel.');
  const [set, found] = await Promise.all([
    reader.from('carousel_sets').select('id,background_status').eq('id', options.carouselId).maybeSingle(),
    reader.from('designs').select('id,carousel_index,status').eq('carousel_id', options.carouselId).order('carousel_index'),
  ]);
  if (set.error || !set.data || found.error || found.data?.length !== 5) throw new Error('That five-card carousel is not available to your account.');
  if (found.data.some(card => ['queued','making','generating'].includes(card.status)) || set.data.background_status === 'making') throw new Error('The carousel is already being generated. Wait for it to finish.');
  if (found.data.some((card, index) => card.carousel_index !== index + 1)) throw new Error('The saved carousel is incomplete.');
  const note = options.note.trim().slice(0, 600) || 'Try a new direction while keeping each product faithful to its official Shopify photo.';
  const handoff = isChatGPTHandoff();
  const pending = await admin.from('carousel_sets').update({ background_status: handoff ? 'unused' : 'queued',
    ...(!handoff ? { background_path: null } : {}), started_at: null, error: null })
    .eq('id', options.carouselId).neq('background_status', 'making').select('id');
  if (pending.error || pending.data?.length !== 1) throw new Error('The carousel changed while starting its redesign. Try again.');
  const at = new Date().toISOString();
  const cards = await admin.from('designs').update({ status: handoff ? 'awaiting_import' : 'queued', queued_at: handoff ? null : at,
    artwork_request_id: handoff ? randomUUID() : null, artwork_handoff: null, redo_note: note, error: null })
    .eq('carousel_id', options.carouselId).not('status', 'in', '(queued,making,generating)').select('id,carousel_index,artwork_origin');
  if (cards.error || cards.data?.length !== 5) throw new Error('The redesign could not queue all five cards. Review the carousel before retrying.');
  return { cards: cards.data as Card[] };
}

/** Generate one style reference per set, then use it to render five product-faithful cards. */
export async function carouselBackgroundFor(db: SupabaseClient, carouselId: string): Promise<{ bytes: Buffer; refIds: string[] }> {
  if (isChatGPTHandoff()) throw new Error('Manual artwork handoff uses the original style references directly; no background is generated by AI Office.');
  const current = await db.from('carousel_sets').select('background_status,background_path,ref_ids').eq('id', carouselId).maybeSingle();
  if (current.error || !current.data) throw new Error('The carousel style record is unavailable.');
  const set = current.data;
  if (set.background_status === 'ready' && set.background_path) {
    const downloaded = await db.storage.from('creatives').download(set.background_path);
    if (downloaded.error || !downloaded.data) throw new Error('The saved carousel background could not be read.');
    return { bytes: Buffer.from(await downloaded.data.arrayBuffer()), refIds: set.ref_ids || [] };
  }
  if (set.background_status !== 'queued') throw new Error(set.background_status === 'making'
    ? 'The reference background is still being generated. Retry after the current attempt finishes.'
    : 'The reference background failed. Use Retry card to request a new attempt.');
  const claimed = await db.from('carousel_sets').update({background_status:'making',started_at:new Date().toISOString(),error:null})
    .eq('id',carouselId).eq('background_status','queued').select('ref_ids').maybeSingle();
  if (claimed.error || !claimed.data) throw new Error('Another worker claimed the carousel background.');
  try {
    const ids = claimed.data.ref_ids as string[];
    const [result, firstCard] = await Promise.all([
      db.from('design_refs').select('id,name,drive_id,modified_at,image_path,fingerprint,occasion,style,palette,layout,typography,kind').in('id',ids).eq('status','ready').eq('hidden',false),
      db.from('designs').select('redo_note').eq('carousel_id',carouselId).eq('carousel_index',1).maybeSingle(),
    ]);
    if (result.error || !result.data?.length) throw new Error('The saved Design Library reference is unavailable.');
    if (firstCard.error) throw new Error('The carousel direction is unavailable.');
    const refs = await refParts(db, result.data as any);
    if (!refs.length) throw new Error('The saved Design Library source image is unavailable.');
    const image = await withUsage({feature:'design',agent:'designer'},()=>carouselStyleBackground(refs.flatMap(ref=>ref.parts),{db,id:'designer'},firstCard.data?.redo_note || ''));
    const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png';
    const path = `carousels/${carouselId}/reference-background-${randomUUID()}.${extension}`;
    const uploaded = await db.storage.from('creatives').upload(path,image.data,{contentType:image.mimeType,upsert:false});
    if (uploaded.error) throw uploaded.error;
    const saved = await db.from('carousel_sets').update({background_status:'ready',background_path:path,error:null})
      .eq('id',carouselId).eq('background_status','making');
    if (saved.error) throw saved.error;
    return { bytes: image.data, refIds: ids };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0,300) : 'Reference background generation failed.';
    await db.from('carousel_sets').update({background_status:'failed',error:message}).eq('id',carouselId).eq('background_status','making');
    throw error;
  }
}
