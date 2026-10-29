import sharp from 'sharp';
import { shopifyPhotoUrl } from './carousel-url.mjs';
export { shopifyPhotoUrl } from './carousel-url.mjs';

const WIDTH = 1080;
const HEIGHT = 1350;
const escapeXml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

function titleLines(value) {
  const words = String(value || '').trim().replace(/\s+/g, ' ').split(' ');
  const lines = [''];
  for (const word of words) {
    const current = lines.at(-1);
    if (current && `${current} ${word}`.length > 37 && lines.length < 3) lines.push(word);
    else lines[lines.length - 1] = current ? `${current} ${word}` : word;
  }
  if (lines.length === 3 && lines[2].length > 39) lines[2] = `${lines[2].slice(0, 36).trimEnd()}…`;
  return lines;
}

export async function fetchShopifyPhoto(value, fetcher = fetch) {
  const url = shopifyPhotoUrl(value);
  if (!url) throw new Error('The product needs an official Shopify photo.');
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { accept: 'image/avif,image/webp,image/jpeg,image/png' } });
  if (!response.ok || !shopifyPhotoUrl(response.url)) throw new Error('The Shopify product photo could not be loaded.');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 12_000_000) throw new Error('The Shopify product photo is too large.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 12_000_000) throw new Error('The Shopify product photo is too large.');
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 10_000 || metadata.height > 10_000) throw new Error('The Shopify product photo is invalid.');
  return bytes;
}

/** Normalize a source photo or saved style image for the model. No pixels are pasted into the final card. */
export async function imageReferencePart(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 20_000_000) throw new Error('The image reference is invalid.');
  const png = await sharp(bytes).rotate().resize(1536, 1536, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return { inlineData: { mimeType: 'image/png', data: png.toString('base64') } };
}

/** Add dependable brand typography to a fully generated scene, without compositing a product photo. */
export async function renderCarouselCard({ title, index, total = 5, category = 'Ring', sceneBytes }) {
  if (!Buffer.isBuffer(sceneBytes) || !sceneBytes.length || sceneBytes.length > 20_000_000 || index < 1 || index > total || total !== 5)
    throw new Error('Invalid carousel card.');
  const scene = await sharp(sceneBytes).rotate().resize(WIDTH, HEIGHT, { fit: 'cover' }).png().toBuffer();
  const lines = titleLines(title);
  const categoryLabel = escapeXml(String(category).toUpperCase());
  const titleSvg = lines.map((line, i) => `<text x="86" y="${1155 + i * 45}" font-family="DejaVu Serif,serif" font-size="38" fill="#173e33">${escapeXml(line)}</text>`).join('');
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect x="62" y="46" width="956" height="198" rx="12" fill="#f7f3eb" fill-opacity="0.88"/>
    <rect x="62" y="1091" width="956" height="218" rx="12" fill="#f7f3eb" fill-opacity="0.9"/>
    <rect x="31" y="31" width="1018" height="1288" rx="14" fill="none" stroke="#d3c3a3" stroke-width="2"/>
    <text x="85" y="113" font-family="DejaVu Serif,serif" font-size="39" letter-spacing="6" fill="#173e33">PARAKKAT</text>
    <text x="87" y="145" font-family="DejaVu Sans,sans-serif" font-size="16" letter-spacing="7" fill="#8b7447">JEWELS</text>
    <text x="991" y="112" text-anchor="end" font-family="DejaVu Sans,sans-serif" font-size="19" letter-spacing="3" fill="#8b7447">${String(index).padStart(2, '0')} / 05</text>
    <line x1="85" y1="178" x2="995" y2="178" stroke="#c8b38d" stroke-width="2"/>
    <text x="86" y="226" font-family="DejaVu Sans,sans-serif" font-size="17" letter-spacing="4" fill="#8b7447">THE ${categoryLabel} EDIT</text>
    <line x1="85" y1="1110" x2="995" y2="1110" stroke="#c8b38d" stroke-width="2"/>
    ${titleSvg}
    <text x="995" y="1301" text-anchor="end" font-family="DejaVu Sans,sans-serif" font-size="17" letter-spacing="2" fill="#8b7447">EXPLORE AT PARAKKAT JEWELS</text>
  </svg>`);
  const data = await sharp(scene).composite([{ input: overlay, left: 0, top: 0 }]).png({ compressionLevel: 9 }).toBuffer();
  return { data, mimeType: 'image/png', width: WIDTH, height: HEIGHT };
}
