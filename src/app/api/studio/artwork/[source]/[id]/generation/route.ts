import { after } from 'next/server';
import { artworkGenerationStatus, startArtworkGeneration, drainHiggsfieldGenerations } from '@/lib/artwork/generation';
import { artworkError, ArtworkError, type ArtworkContext } from '@/lib/artwork/server';
import { validOrigin } from '@/lib/artwork/import-core.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
const headers={'Cache-Control':'private, no-store'};
export async function GET(_request:Request,context:ArtworkContext){
  try{return Response.json(await artworkGenerationStatus(context),{headers});}catch(error){return artworkError(error);}
}
export async function POST(request:Request,context:ArtworkContext){
  try{
    if(!validOrigin(request,process.env.APP_URL))throw new ArtworkError('Invalid request origin.',403);
    if(Number(request.headers.get('content-length'))>4096)throw new ArtworkError('The generation request is too large.');
    const reader=request.body?.getReader();if(!reader)throw new ArtworkError('Choose an artwork request.');
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw new ArtworkError('The generation request is too large.');}chunks.push(value);}}finally{reader.releaseLock();}
    let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ArtworkError('Invalid generation request.');}
    const result=await startArtworkGeneration(context,input);
    after(async()=>{await drainHiggsfieldGenerations(undefined,1);});
    return Response.json(result,{status:202,headers});
  }catch(error){return artworkError(error);}
}
