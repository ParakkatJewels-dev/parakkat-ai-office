import 'server-only';
import type { Source } from '@/lib/agents/design';
import { startChatGPTArtwork } from './chatgpt-worker';

/** Called only by an explicit Studio order or an authorized conversation task. */
export async function queueChatGPTArtworkBatch(source: Source, items: Array<{id:string}>, userId:string, role:string) {
  let queued=0, reason='';
  for(const item of items) {
    try {
      const result=await startChatGPTArtwork({source,id:item.id,userId,role});
      if(result.started)queued++;
      else if(result.reason)reason=result.reason;
    } catch {
      reason='The request was saved, but automatic image generation could not be confirmed. Check its status in Studio before retrying.';
    }
  }
  return queued
    ? `ChatGPT image generation queued for ${queued} image${queued===1?'':'s'}. The VPS worker will save the finished artwork here and in Studio for human review. Your ChatGPT usage limits apply.${reason?` ${reason}`:''}`
    : reason||'Artwork requests saved. Check the ChatGPT image worker status in Studio. No image is complete yet.';
}
