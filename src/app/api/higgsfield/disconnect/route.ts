import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { disconnectHiggsfield, safeHiggsfieldAuthError } from '@/lib/higgsfield/auth.mjs';
import { connectionResult, sameOrigin } from '../shared';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { role } = await requireUser();
  if (role !== 'super_admin' || !sameOrigin(req)) return NextResponse.json({ error: 'This connection requires a same-origin Super Admin request.' }, { status: 403 });
  try {
    const result = await disconnectHiggsfield();
    return connectionResult(req, 'msg', result.revoked ? 'Higgsfield disconnected.' : 'Higgsfield disconnected from AI Office. Remote token revocation could not be confirmed.');
  } catch (error) { return connectionResult(req, 'error', safeHiggsfieldAuthError(error)); }
}
