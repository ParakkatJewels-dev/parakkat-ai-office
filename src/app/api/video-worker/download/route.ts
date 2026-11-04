import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { conversationUser } from '@/lib/agents/conversation-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function workerAuthorized(request: Request) {
  const expected = process.env.VIDEO_WORKER_TOKEN || '';
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const left = Buffer.from(expected), right = Buffer.from(given);
  return expected.length >= 32 && left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  if (!workerAuthorized(request)) {
    const session = await conversationUser();
    if (!session) return Response.json({ error: 'Please sign in.' }, { status: 401 });
    if (session.role !== 'super_admin') return Response.json({ error: 'Only an administrator can download the editing worker.' }, { status: 403 });
  }
  try {
    const archive = await readFile(path.join(process.cwd(), 'deploy', 'downloads', 'video-worker.zip'));
    const etag = '"' + createHash('sha256').update(archive).digest('hex') + '"';
    const headers = {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="video-worker-update.zip"',
      'Cache-Control': 'private, no-store',
      'ETag': etag,
    };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(archive), { headers });
  } catch {
    return Response.json({ error: 'The worker download is not available.' }, { status: 503 });
  }
}
