import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { HIGGSFIELD_STATE_COOKIE, safeHiggsfieldAuthError, startHiggsfieldLogin } from '@/lib/higgsfield/auth.mjs';
import { connectionResult, publicOrigin, sameOrigin } from '../shared';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { user, role } = await requireUser();
  if (role !== 'super_admin' || !sameOrigin(req)) return NextResponse.json({ error: 'This connection requires a same-origin Super Admin request.' }, { status: 403 });
  try {
    const origin = publicOrigin(req), result = await startHiggsfieldLogin(user.id, origin);
    const response = NextResponse.redirect(result.url, 303);
    response.headers.set('cache-control', 'private, no-store'); response.headers.set('referrer-policy', 'no-referrer');
    response.cookies.set(HIGGSFIELD_STATE_COOKIE, result.state, { path: '/api/higgsfield', httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', maxAge: 600 });
    return response;
  } catch (error) { return connectionResult(req, 'error', safeHiggsfieldAuthError(error)); }
}
