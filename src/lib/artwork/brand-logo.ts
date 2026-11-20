import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/admin';

const bucket = () => supabaseAdmin().storage.from('creatives');
export type BrandLogo = { id: string; path: string; sha256: string; bytes: Buffer };

export async function currentBrandLogo(logoId?: string | null): Promise<BrandLogo> {
  const db = supabaseAdmin();
  const { data, error } = logoId
    ? await db.from('brand_logo_assets').select('id,path,sha256').eq('id', logoId).maybeSingle()
    : await db.from('brand_logo').select('path,sha256').eq('id', 1).maybeSingle();
  if (error) throw new Error('The brand logo could not be checked. Try again.');
  if (!data) throw new Error(logoId ? 'The selected approved logo is unavailable. Choose another logo in Studio.' : 'Add the approved brand logo in Settings → Brand guidance before creating artwork.');
  const asset = logoId ? { data: { id: logoId }, error: null } : await db.from('brand_logo_assets').select('id').eq('path', data.path).eq('sha256', data.sha256).maybeSingle();
  if (asset.error || !asset.data) throw new Error('The active brand logo is missing from the approved library. Select it again in Settings.');
  const file = await bucket().download(data.path);
  if (file.error || !file.data) throw new Error('The approved brand logo could not be loaded. Upload it again in Brand guidance.');
  const bytes = Buffer.from(await file.data.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== data.sha256) throw new Error('The approved brand logo changed unexpectedly. Upload it again.');
  return { id: asset.data.id, path: data.path, sha256: data.sha256, bytes };
}

export async function normalizeBrandLogo(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > 5 * 1024 * 1024) throw new Error('Choose a logo file no larger than 5 MiB.');
  try {
    const image = sharp(input, { limitInputPixels: 16_000_000, failOn: 'warning', animated: true });
    const info = await image.metadata();
    if (!['png', 'webp', 'jpeg'].includes(info.format || '') || (info.pages || 1) !== 1 || !info.width || !info.height ||
      Math.min(info.width, info.height) < 64 || Math.max(info.width, info.height) > 4096) throw new Error('invalid');
    await image.stats();
    const normalized = await image.rotate().png().toBuffer();
    if (normalized.length > 5 * 1024 * 1024) throw new Error('too large');
    return normalized;
  } catch { throw new Error('Upload a complete PNG, WebP or JPEG logo, at least 64 pixels on each side. A transparent PNG works best.'); }
}

/** Exact uploaded pixels are resized and composited; image models never draw the mark. */
export async function applyBrandLogo(image: Buffer, logo: BrandLogo): Promise<Buffer> {
  const upright = await sharp(image, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer();
  const base = sharp(upright);
  const info = await base.metadata();
  if (!info.width || !info.height) throw new Error('The artwork image is invalid.');
  const width = info.width, height = info.height;
  const margin = Math.max(12, Math.round(Math.min(width, height) * 0.025));
  const pad = Math.max(8, Math.round(Math.min(width, height) * 0.012));
  const maxW = Math.max(64, Math.round(width * 0.26));
  const maxH = Math.max(32, Math.round(height * 0.105));
  const mark = await sharp(logo.bytes).resize(maxW - pad * 2, maxH - pad * 2, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const markInfo = await sharp(mark).metadata();
  const plateW = (markInfo.width || 0) + pad * 2, plateH = (markInfo.height || 0) + pad * 2;
  const left = width - margin - plateW, top = margin;
  const plate = Buffer.from(`<svg width="${plateW}" height="${plateH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="${pad}" fill="#fff" fill-opacity=".94"/></svg>`);
  const finished = await base.composite([{ input: plate, left, top }, { input: mark, left: left + pad, top: top + pad }]).png({ compressionLevel: 9 }).toBuffer();
  if (finished.length > 20 * 1024 * 1024) throw new Error('The branded image is too large. Use a smaller artwork image and try again.');
  return finished;
}

export const brandLogoInstruction = 'BRAND LOGO RULE: Leave the upper-right brand area clear. Do not draw, recreate, typeset or invent any logo, wordmark, monogram, seal or watermark anywhere in the image. AI Office places the exact administrator-uploaded logo on the finished image. Never use a logo from a style reference, previous image or product photo.';
