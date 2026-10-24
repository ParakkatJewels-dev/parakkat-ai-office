import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncAll } from '@/lib/agents/sync';
import { isCron } from '@/lib/auth/session';

export const maxDuration = 300;

// Vercel Cron calls this once a day with the CRON_SECRET; the Admin page's "Sync now" uses a server action instead.
export async function GET(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  return NextResponse.json(await syncAll(supabaseAdmin()));
}
