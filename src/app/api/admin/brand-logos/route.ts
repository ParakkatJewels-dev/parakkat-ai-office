import { createHash, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeBrandLogo } from '@/lib/artwork/brand-logo';
import { validId, validOrigin } from '@/lib/artwork/import-core.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const MAX_FILES = 8;
const MAX_BODY = MAX_FILES * 5 * 1024 * 1024 + 64 * 1024;
const headers = { 'Cache-Control': 'private, no-store' };
const failure = (message: string, status = 400) => Response.json({ error: message }, { status, headers });

async function authorized(request: Request) {
  const session = await requireUser();
  if (session.role !== 'super_admin' || !validOrigin(request, process.env.APP_URL)) return null;
  return session.user;
}

async function boundedFiles(request: Request): Promise<File[]> {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;') || !request.body)
    throw new Error('Choose PNG, WebP or JPEG logo files.');
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new Error('Choose up to 8 logos, each no larger than 5 MiB.');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new Error('Choose up to 8 logos, each no larger than 5 MiB.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers.get('content-type')! } }).formData();
  const files = form.getAll('logos').filter((value): value is File => value instanceof File && value.size > 0);
  if (!files.length || files.length > MAX_FILES) throw new Error('Choose between 1 and 8 approved logo files.');
  return files;
}

export async function POST(request: Request) {
  const user = await authorized(request);
  if (!user) return failure('Only the Super Admin can upload approved logos from AI Office.', 403);
  try {
    const files = await boundedFiles(request);
    const prepared: Array<{ name: string; bytes: Buffer; sha256: string }> = [];
    const seen = new Set<string>();
    for (const file of files) {
      const bytes = await normalizeBrandLogo(Buffer.from(await file.arrayBuffer()));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (seen.has(sha256)) continue;
      seen.add(sha256);
      const name = (file.name.split(/[\\/]/).pop() || 'Approved logo').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'Approved logo';
      prepared.push({ name, bytes, sha256 });
    }
    const db = supabaseAdmin();
    const existing = await db.from('brand_logo_assets').select('sha256').in('sha256', prepared.map(logo => logo.sha256));
    if (existing.error) return failure('The approved logo library is unavailable. Reload Settings and try again.', 503);
    const savedHashes = new Set((existing.data || []).map(row => row.sha256));
    const pending = prepared.filter(logo => !savedHashes.has(logo.sha256));
    const uploadedPaths: string[] = [];
    const rows: Array<{ id: string; name: string; path: string; sha256: string; created_by: string }> = [];
    for (const logo of pending) {
      const path = `brand/logos/${randomUUID()}.png`;
      const upload = await db.storage.from('creatives').upload(path, logo.bytes, { contentType: 'image/png', upsert: false });
      if (upload.error) {
        if (uploadedPaths.length) await db.storage.from('creatives').remove(uploadedPaths);
        return failure('A logo file could not be uploaded. Check your connection and try again.', 503);
      }
      uploadedPaths.push(path);
      rows.push({ id: randomUUID(), name: logo.name, path, sha256: logo.sha256, created_by: user.id });
    }
    if (rows.length) {
      const inserted = await db.from('brand_logo_assets').insert(rows);
      if (inserted.error) {
        await db.storage.from('creatives').remove(uploadedPaths);
        return failure('The approved logos could not be saved. Reload Settings and try again.', 503);
      }
    }
    const current = await db.from('brand_logo').select('id').eq('id', 1).maybeSingle();
    let warning: string | null = null;
    if (current.error) warning = 'Logos were saved, but the active logo could not be checked. Reload Settings and choose one.';
    else if (!current.data) {
      const first = rows[0] || (await db.from('brand_logo_assets').select('path,sha256').order('created_at').limit(1)).data?.[0];
      if (first) {
        const selected = await db.from('brand_logo').insert({ id: 1, path: first.path, sha256: first.sha256, updated_by: user.id });
        if (selected.error && selected.error.code !== '23505') warning = 'Logos were saved, but an active logo was not set. Choose one below.';
      }
    }
    revalidatePath('/admin');
    revalidatePath('/studio');
    return Response.json({ uploaded: rows.length, skipped: files.length - rows.length, warning }, { headers });
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'The logo upload could not be completed. Try again.');
  }
}

export async function PATCH(request: Request) {
  const user = await authorized(request);
  if (!user) return failure('Only the Super Admin can choose the active logo.', 403);
  if (Number(request.headers.get('content-length')) > 4096) return failure('Choose an approved logo.');
  let id: unknown;
  try { id = (await request.json()).id; } catch { return failure('Choose an approved logo.'); }
  if (!validId(id)) return failure('Choose an approved logo.');
  const db = supabaseAdmin();
  const found = await db.from('brand_logo_assets').select('path,sha256').eq('id', id).maybeSingle();
  if (found.error || !found.data) return failure('That approved logo could not be found. Reload Settings.', 404);
  const saved = await db.from('brand_logo').upsert({ id: 1, path: found.data.path, sha256: found.data.sha256, updated_by: user.id, updated_at: new Date().toISOString() });
  if (saved.error) return failure('The active logo could not be changed. Try again.', 503);
  revalidatePath('/admin');
  revalidatePath('/studio');
  return Response.json({ activeId: id }, { headers });
}
