import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { finishHiggsfieldLogin, HIGGSFIELD_STATE_COOKIE, safeHiggsfieldAuthError } from '@/lib/higgsfield/auth.mjs';
import { connectionResult, publicOrigin } from '../shared';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const { user, role } = await requireUser();
  if (role !== 'super_admin') return NextResponse.json({ error: 'Only the Super Admin can connect Higgsfield.' }, { status: 403 });
  try {
    const callback = new URL(req.nextUrl.pathname + req.nextUrl.search, publicOrigin(req));
    const status = await finishHiggsfieldLogin(user.id, callback.toString(), req.cookies.get(HIGGSFIELD_STATE_COOKIE)?.value || '');
    return connectionResult(req, 'msg', `Higgsfield connected: ${status.accountName || 'account'}. Automatic images use its subscription credits.`);
  } catch (error) { return connectionResult(req, 'error', safeHiggsfieldAuthError(error)); }
}
