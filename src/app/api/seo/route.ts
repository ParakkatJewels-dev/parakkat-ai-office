import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runSeo } from '@/lib/agents/seo';
import { isCron } from '@/lib/auth/session';
import { errText } from '@/lib/errors';

export const maxDuration = 300;

// Vercel Cron runs the SEO Desk's check every Monday morning; the SEO page has a button for any other time.
export async function GET(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  try { return NextResponse.json(await runSeo(supabaseAdmin())); }
  catch (e) { return NextResponse.json({ error: errText(e) }, { status: 500 }); }
}
