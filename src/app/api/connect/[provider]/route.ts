import { NextResponse, type NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { requireUser } from '@/lib/auth/session';
import { APP_KEYS, appReady, authorizeUrl, redirectUri, STATE_COOKIE } from '@/lib/connectors/connect';
import { normalizeShop } from '@/lib/connectors/oauth-core.mjs';
import type { Platform } from '@/lib/connectors/vault';

const PLATFORMS: Platform[] = ['meta', 'google', 'shopify'];
const back = (req: NextRequest, key: 'msg' | 'error', text: string) => NextResponse.redirect(new URL(`/admin?${key}=${encodeURIComponent(text)}#sync`, req.url));

/** Sends the Super Admin to the platform's own sign-in page. Only the Super Admin can connect platforms. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { role } = await requireUser();
  if (role !== 'super_admin') redirect('/office');
  const p = (await params).provider as Platform;
  if (!PLATFORMS.includes(p)) return back(req, 'error', 'Unknown platform.');
  if (!appReady(p)) return back(req, 'error', `Add ${APP_KEYS[p].filter(k => !process.env[k]).join(', ')} in Vercel first. They identify our app to ${p === 'meta' ? 'Meta' : p === 'google' ? 'Google' : 'Shopify'}.`);
  let shop = '';
  if (p === 'shopify') {
    shop = normalizeShop(req.nextUrl.searchParams.get('shop') || process.env.SHOPIFY_STORE_DOMAIN) || '';
    if (!shop) return back(req, 'error', 'Enter the store as name.myshopify.com.');
  }
  const state = randomBytes(24).toString('hex');
  const res = NextResponse.redirect(authorizeUrl(p, redirectUri(req.nextUrl.origin, p), state, shop));
  // ties the platform's answer to this browser and this request
  res.cookies.set(STATE_COOKIE, `${p}.${state}.${shop}`, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/connect', maxAge: 600 });
  return res;
}
