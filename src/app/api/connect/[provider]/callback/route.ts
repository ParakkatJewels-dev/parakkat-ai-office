import { NextResponse, type NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { timingSafeEqual } from 'node:crypto';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { connectionRows, finish, redirectUri, STATE_COOKIE } from '@/lib/connectors/connect';
import { saveAccess, type Platform } from '@/lib/connectors/vault';

export const maxDuration = 60;
const NAME: Record<Platform, string> = { meta: 'Meta', google: 'Google', shopify: 'Shopify' };

/** The platform sends the Super Admin back here. Check it is the answer to our request, then save the access encrypted. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { user, role } = await requireUser();
  if (role !== 'super_admin') redirect('/office');
  const p = (await params).provider as Platform, q = req.nextUrl.searchParams;
  // the cookie is provider.state.shop; the state is hex and the shop domain has its own dots
  const parts = (req.cookies.get(STATE_COOKIE)?.value || '').split('.'), [cp, cState = ''] = parts, shop = parts.slice(2).join('.');
  const state = q.get('state') || '';
  const back = (key: 'msg' | 'error', text: string) => {
    const res = NextResponse.redirect(new URL(`/admin?${key}=${encodeURIComponent(text)}#sync`, req.url));
    res.cookies.delete({ name: STATE_COOKIE, path: '/api/connect' });
    return res;
  };
  if (cp !== p || !state || state.length !== cState.length || !timingSafeEqual(Buffer.from(state), Buffer.from(cState)))
    return back('error', `The ${NAME[p] || 'platform'} sign-in expired or did not start here. Press Connect again.`);
  try {
    const f = await finish(p, q, redirectUri(req.nextUrl.origin, p), shop || undefined);
    await saveAccess(p, f.tokens, f.settings, f.expiresAt, user.id);
    await supabaseAdmin().from('connections').upsert(connectionRows(p, f.settings));
    const pick = p !== 'shopify' && !(p === 'meta' ? f.settings.ad_account_ids?.length && f.settings.page_id : f.settings.customer_ids?.length);
    return back('msg', `${NAME[p]} connected: ${f.summary}.${pick ? ' Choose the accounts to use below.' : ' Press Sync data now to pull it in.'}`);
  } catch (e) {
    return back('error', `${NAME[p]} could not connect. ${e instanceof Error ? e.message : String(e)}`.slice(0, 400));
  }
}
