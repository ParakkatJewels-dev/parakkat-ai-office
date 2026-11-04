import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { conversationUser } from '@/lib/agents/conversation-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await conversationUser();
  if (!session) return Response.json({ error: 'Please sign in.' }, { status: 401 });
  if (session.role !== 'super_admin') return Response.json({ error: 'Only an administrator can download the editing worker.' }, { status: 403 });
  try {
    const archive = await readFile(path.join(process.cwd(), 'deploy', 'downloads', 'video-worker.zip'));
    return new Response(new Uint8Array(archive), { headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="video-worker-update.zip"',
      'Cache-Control': 'private, no-store',
    } });
  } catch {
    return Response.json({ error: 'The worker download is not available.' }, { status: 503 });
  }
}
