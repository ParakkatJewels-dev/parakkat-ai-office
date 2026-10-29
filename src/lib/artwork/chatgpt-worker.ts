import 'server-only';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isPaused } from '@/lib/pause';
import { authorizeGenerationPreparation } from './generation-jobs';
import { ArtworkError, generationArtwork } from './server';
import { MAX_IMAGE_BYTES, validId, validateArtwork } from './import-core.mjs';

type Source = 'design' | 'creative';
type JobState = 'queued' | 'preparing' | 'generating' | 'succeeded' | 'blocked' | 'uncertain' | 'cancelled';
export type ChatGPTImageJob = {
  id: string; source: Source; item_id: string; request_id: string; requested_by: string;
  state: JobState; lease_holder: string | null; lease_until: string | null; dispatched_at: string | null;
  manifest_sha256: string | null; output_sha256: string | null; output_path: string | null;
  result: Record<string, unknown> | null; error_code: string | null; error: string | null;
  created_at: string; updated_at: string;
};
const activeStates = new Set<JobState>(['queued', 'preparing', 'generating']);
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_JSON_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64 * 1024;
const MAX_BUNDLE_BYTES = 80 * 1024 * 1024;
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export const chatGPTImageWorkerEnabled = () => process.env.CHATGPT_IMAGE_WORKER_ENABLED === 'true';

/** No worker token, input pixels, signed URLs or private lease appears in UI status. */
export const publicChatGPTImageJob = (job: ChatGPTImageJob | null) => job ? {
  id: job.id, provider: 'chatgpt' as const, state: job.state, model: 'ChatGPT built-in image generation',
  error: job.error, errorCode: job.error_code, updatedAt: job.updated_at, credits: null,
} : null;

async function rpc<T>(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new ArtworkError(error.code === 'P0001' ? error.message : 'The ChatGPT image job could not be saved. Retry the same operation.', error.code === 'P0001' ? 409 : 503);
  return data as T;
}

export async function chatGPTWorkerJobForArtwork(db: SupabaseClient, source: Source, id: string, requestId: string): Promise<ChatGPTImageJob | null> {
  const { data, error } = await db.from('chatgpt_image_jobs').select('*').eq('source', source).eq('item_id', id).eq('request_id', requestId).maybeSingle();
  if (error) throw new ArtworkError('ChatGPT image generation status is unavailable.', 503);
  return data as ChatGPTImageJob | null;
}

/** Explicit new artwork/revision only. A switch or connection never queues old work. */
export async function startChatGPTArtwork(options: { source: Source; id: string; userId: string; role?: string; requestId?: string }) {
  if (!chatGPTImageWorkerEnabled()) return { started: false, job: null, reason: 'The ChatGPT image worker is not enabled.' };
  if ((process.env.CHATGPT_IMAGE_WORKER_SECRET || '').length < 32) return { started: false, job: null, reason: 'The ChatGPT image worker connection is not configured.' };
  if (!['design', 'creative'].includes(options.source) || !validId(options.id) || !validId(options.userId)) throw new ArtworkError('Invalid artwork request.');
  if (await isPaused(true)) return { started: false, job: null, reason: 'AI Office is paused. Resume it before generating artwork.' };
  const db = supabaseAdmin();
  const { data: row, error } = await db.from(options.source === 'design' ? 'designs' : 'creatives').select('artwork_request_id').eq('id', options.id).maybeSingle();
  if (error || !row || !validId(row.artwork_request_id)) throw new ArtworkError('Prepare an artwork request before generating.', 409);
  if (options.requestId && options.requestId !== row.artwork_request_id) throw new ArtworkError('The artwork request changed. Refresh before generating.', 409);
  const existing = await chatGPTWorkerJobForArtwork(db, options.source, options.id, row.artwork_request_id);
  if (!existing) {
    await authorizeGenerationPreparation(db, { source: options.source, id: options.id, requestId: row.artwork_request_id, userId: options.userId });
    await generationArtwork({ source: options.source, item_id: options.id, request_id: row.artwork_request_id });
  }
  const job = await rpc<ChatGPTImageJob>(db, 'reserve_chatgpt_image_job', {
    p_source: options.source, p_id: options.id, p_request_id: row.artwork_request_id, p_user_id: options.userId,
  });
  return { started: activeStates.has(job.state), job: publicChatGPTImageJob(job),
    ...(activeStates.has(job.state) ? {} : { reason: job.error || 'This request already has a result. Prepare a new revision to generate again.' }) };
}

/** This credential belongs only to the supervisor, never the Codex subprocess. */
export function authorizeChatGPTImageWorker(request: Request) {
  const expected = process.env.CHATGPT_IMAGE_WORKER_SECRET || '';
  const header = request.headers.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (expected.length < 32 || !supplied || supplied.length > 1024 ||
    !timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(expected).digest())) {
    throw new ArtworkError('Worker authentication required.', 401);
  }
}

export async function boundedWorkerJSON(request: Request): Promise<any> {
  if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body) throw new ArtworkError('A JSON worker request is required.');
  if (Number(request.headers.get('content-length')) > MAX_JSON_BYTES) throw new ArtworkError('The worker request is too large.', 413);
  const reader = request.body.getReader(), chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new ArtworkError('The worker request is too large.', 413); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input;
  } catch { throw new ArtworkError('Invalid worker JSON.'); }
}

async function claim(db: SupabaseClient, input: any) {
  if (!chatGPTImageWorkerEnabled() || await isPaused(true)) return { job: null };
  const holder = input.holder ?? randomUUID();
  if (!validId(holder)) throw new ArtworkError('Invalid worker lease.');
  const now = new Date().toISOString();
  const { data, error } = await db.from('chatgpt_image_jobs').select('id').in('state', ['queued', 'preparing', 'generating'])
    .or(`lease_until.is.null,lease_until.lte.${now}`).order('created_at').limit(5);
  if (error) throw new ArtworkError('The ChatGPT image queue could not be read.', 503);
  for (const candidate of data || []) {
    const job = await rpc<ChatGPTImageJob | null>(db, 'claim_chatgpt_image_job', { p_id: candidate.id, p_holder: holder });
    if (!job || job.state !== 'preparing') continue;
    try {
      const bundle = await generationArtwork(job, true);
      const total = bundle.files.reduce((sum: number, file: { data: Buffer }) => sum + file.data.length, 0);
      if (total > MAX_BUNDLE_BYTES || bundle.files.length > 14) throw new ArtworkError('The saved reference bundle is too large.');
      const files = bundle.files.map((file: { name: string; data: Buffer }) => {
        if (!/^[a-zA-Z0-9_.-]+$/.test(file.name) || file.name.includes('..')) throw new ArtworkError('Invalid saved reference filename.');
        return { name: file.name, base64: file.data.toString('base64'), sha256: sha256(file.data) };
      });
      return { job: { jobId: job.id, holder, source: job.source, itemId: job.item_id, requestId: job.request_id, packet: bundle.packet, files } };
    } catch {
      await rpc(db, 'fail_chatgpt_image_job', { p_id: job.id, p_holder: holder, p_kind: 'preflight' }).catch(() => {});
      throw new ArtworkError('The saved image references could not be prepared. No generation was dispatched.', 409);
    }
  }
  return { job: null };
}

async function complete(db: SupabaseClient, input: any) {
  const { output } = input;
  if (!output || typeof output.base64 !== 'string' || !output.base64.length || output.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    output.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(output.base64) || typeof output.sha256 !== 'string' || !SHA256.test(output.sha256)) throw new ArtworkError('Invalid image output.');
  const bytes = Buffer.from(output.base64, 'base64');
  if (bytes.toString('base64') !== output.base64 || sha256(bytes) !== output.sha256) throw new ArtworkError('The saved image hash does not match.');
  let image;
  try { image = await validateArtwork(bytes, output.mimeType); } catch (error) { throw new ArtworkError((error as Error).message); }
  const { data, error } = await db.from('chatgpt_image_jobs').select('*').eq('id', input.jobId).maybeSingle();
  const job = data as ChatGPTImageJob | null;
  if (error) throw new ArtworkError('The saved image job could not be read. Retry this same output.', 503);
  if (!job || job.lease_holder !== input.holder || !job.dispatched_at || !['generating', 'uncertain', 'succeeded'].includes(job.state)) throw new ArtworkError('The saved image job or lease changed.', 409);
  const path = `chatgpt-imports/${job.source}/${job.item_id}/${job.request_id}/${job.id}.${image.extension}`;
  if (job.state !== 'succeeded') {
    const bucket = db.storage.from('creatives');
    const saved = await bucket.upload(path, bytes, { contentType: image.mimeType, upsert: false, cacheControl: '31536000' });
    if (saved.error) {
      const prior = await bucket.download(path);
      if (prior.error || !prior.data || sha256(Buffer.from(await prior.data.arrayBuffer())) !== output.sha256) throw new ArtworkError('The generated image could not be stored. Retry this same output without generating again.', 503);
    }
  }
  // Keep immutable output after ambiguous network failure; retrying this exact
  // path/hash is idempotent and must never trigger another image generation.
  const result = await rpc<Record<string, unknown>>(db, 'complete_chatgpt_image_job', {
    p_id: job.id, p_holder: input.holder, p_path: path, p_sha256: output.sha256,
  });
  return { status: 'succeeded', result };
}

export async function handleChatGPTImageWorker(input: any) {
  const db = supabaseAdmin();
  if (input.action === 'claim') return claim(db, input);
  if (!validId(input.jobId) || !validId(input.holder)) throw new ArtworkError('Invalid image job or lease.');
  const args = { p_id: input.jobId, p_holder: input.holder };
  if (input.action === 'heartbeat') {
    await rpc(db, 'heartbeat_chatgpt_image_job', args); return { ok: true };
  }
  if (input.action === 'dispatch') {
    if (!chatGPTImageWorkerEnabled() || await isPaused(true)) throw new ArtworkError('The ChatGPT image worker is paused.', 409);
    if (!SHA256.test(input.manifestHash || '')) throw new ArtworkError('A frozen input manifest hash is required.');
    await rpc(db, 'dispatch_chatgpt_image_job', { ...args, p_manifest_sha256: input.manifestHash });
    return { ok: true, dispatched: true };
  }
  if (input.action === 'complete') return complete(db, input);
  if (input.action === 'fail') {
    if (!['preflight', 'uncertain'].includes(input.kind)) throw new ArtworkError('Unknown image worker failure.');
    const job = await rpc<ChatGPTImageJob>(db, 'fail_chatgpt_image_job', { ...args, p_kind: input.kind });
    return { ok: true, state: job.state };
  }
  throw new ArtworkError('Unknown image worker action.');
}
