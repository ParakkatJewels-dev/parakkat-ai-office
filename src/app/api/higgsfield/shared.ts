import { NextResponse, type NextRequest } from 'next/server';
import { HIGGSFIELD_STATE_COOKIE } from '@/lib/higgsfield/auth.mjs';

export const publicOrigin = (req: NextRequest) => new URL(process.env.APP_URL || req.url).origin;
export function sameOrigin(req: NextRequest) {
  return req.headers.get('origin') === publicOrigin(req) && req.headers.get('sec-fetch-site') !== 'cross-site';
}
export function connectionResult(req: NextRequest, key: 'msg' | 'error', message: string) {
  const target = new URL('/admin', publicOrigin(req));
  target.searchParams.set('tab', 'connections'); target.searchParams.set(key, message);
  const response = NextResponse.redirect(target, 303);
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('referrer-policy', 'no-referrer');
  response.cookies.set(HIGGSFIELD_STATE_COOKIE, '', { path: '/api/higgsfield', maxAge: 0, httpOnly: true, secure: target.protocol === 'https:', sameSite: 'lax' });
  return response;
}
