import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { findFolders } from '@/lib/connectors/drive';
import { errText } from '@/lib/errors';

/** Drive folders matching a search, for the Super Admin's folder picker in the Design Studio library. */
export async function GET(req: Request) {
  const { role } = await requireUser();
  if (role !== 'super_admin') return NextResponse.json({ error: 'Only the Super Admin can add folders.' }, { status: 403 });
  try {
    const folders = await findFolders((new URL(req.url).searchParams.get('q') || '').slice(0, 80));
    return NextResponse.json({ folders }, { headers: { 'cache-control': 'private, max-age=30' } });
  } catch (e) {
    return NextResponse.json({ error: errText(e) }, { status: 502 });
  }
}
