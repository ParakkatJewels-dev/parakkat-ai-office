import { importArtwork, artworkError, type ArtworkContext } from '@/lib/artwork/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function POST(request:Request,context:ArtworkContext) {
  try {return Response.json(await importArtwork(request,context),{headers:{'Cache-Control':'private, no-store'}});} catch(error) {return artworkError(error);}
}
