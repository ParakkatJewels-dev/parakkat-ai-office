import { artworkPacket, artworkError, type ArtworkContext } from '@/lib/artwork/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:ArtworkContext) {
  try {return Response.json(await artworkPacket(context,new URL(request.url).searchParams.get('provider')),{headers:{'Cache-Control':'private, no-store'}});} catch(error) {return artworkError(error);}
}
