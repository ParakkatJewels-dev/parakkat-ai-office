// The small, testable parts of connecting platforms from the app: sealing tokens and checking Shopify's signature.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A 32-byte key from CREDENTIALS_KEY, or from the Supabase service key when that is not set. */
export function keyFrom(secret) {
  if (!secret) throw new Error('CREDENTIALS_KEY or SUPABASE_SERVICE_ROLE_KEY must be set to save platform access.');
  return createHash('sha256').update(`parakkat-credentials:${secret}`).digest();
}

/** AES-256-GCM. The result is iv.tag.ciphertext in base64url, safe to store as text. */
export function seal(value, key) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map(b => b.toString('base64url')).join('.');
}
export function open(text, key) {
  const [iv, tag, body] = String(text).split('.').map(p => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
}

/** "parakkat-jewels", "https://parakkat-jewels.myshopify.com/admin" and the full domain all give the .myshopify.com domain. */
export function normalizeShop(input) {
  let s = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (s && !s.includes('.')) s += '.myshopify.com';
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

/** Shopify signs its redirect: an HMAC-SHA256 of the other query parameters, sorted, with the app's secret. */
export function shopifyHmacOk(params, secret) {
  const given = params.get('hmac'); if (!given || !secret) return false;
  const msg = [...params.entries()].filter(([k]) => k !== 'hmac' && k !== 'signature').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const want = createHmac('sha256', secret).update(msg).digest('hex');
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
