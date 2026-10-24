import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

// Magic-link sign-in lands here.
export async function GET(req: Request) {
  const url = new URL(req.url), code = url.searchParams.get('code');
  if (code) await (await supabaseServer()).auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL('/office', url.origin));
}
