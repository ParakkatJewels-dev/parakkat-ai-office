import { artworkPack, artworkError, type ArtworkContext } from '@/lib/artwork/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function GET(request:Request,context:ArtworkContext) {
  try {const {bytes,id}=await artworkPack(context,new URL(request.url).searchParams.get('provider'));return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="parakkat-artwork-${id}.zip"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});} catch(error) {return artworkError(error);}
}
