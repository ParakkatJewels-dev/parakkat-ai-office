import { authorizeChatGPTImageWorker, boundedWorkerJSON, handleChatGPTImageWorker } from '@/lib/artwork/chatgpt-worker';
import { artworkError } from '@/lib/artwork/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    authorizeChatGPTImageWorker(request);
    return Response.json(await handleChatGPTImageWorker(await boundedWorkerJSON(request)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) { return artworkError(error); }
}
