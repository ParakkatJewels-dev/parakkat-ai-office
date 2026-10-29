import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessArtwork, artworkError, ArtworkError, type ArtworkContext } from '@/lib/artwork/server';
import { validId, validOrigin } from '@/lib/artwork/import-core.mjs';
import { chatGPTImageWorkerEnabled, chatGPTWorkerJobForArtwork, publicChatGPTImageJob, startChatGPTArtwork } from '@/lib/artwork/chatgpt-worker';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store'};

export async function GET(_request:Request,context:ArtworkContext) {
  try {
    const access=await accessArtwork(context,{pendingOnly:false}),enabled=chatGPTImageWorkerEnabled();
    const db=supabaseAdmin();
    const raw=enabled&&validId(access.row.artwork_request_id)?await chatGPTWorkerJobForArtwork(db,access.source,access.id,access.row.artwork_request_id):null;
    const job=publicChatGPTImageJob(raw);
    let imageUrl:string|null=null;
    if(job?.state==='succeeded'&&access.row.image_path){const signed=await db.storage.from('creatives').createSignedUrl(access.row.image_path,3600);imageUrl=signed.data?.signedUrl||null;}
    return Response.json({enabled,requestId:access.row.artwork_request_id,job:job?{...job,imageUrl}:null},{headers});
  }catch(error){return artworkError(error);}
}

export async function POST(request:Request,context:ArtworkContext) {
  try {
    if(!validOrigin(request,process.env.APP_URL))throw new ArtworkError('Invalid request origin.',403);
    if(!request.headers.get('content-type')?.startsWith('application/json')||!request.body)throw new ArtworkError('A JSON artwork request is required.');
    if(Number(request.headers.get('content-length'))>4096)throw new ArtworkError('The generation request is too large.',413);
    const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new ArtworkError('The generation request is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
    let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ArtworkError('Invalid generation request.');}
    const access=await accessArtwork(context,{pendingOnly:false});
    if(!validId(input?.requestId)||input.requestId!==access.row.artwork_request_id)throw new ArtworkError('This artwork request changed. Refresh Studio before generating.',409);
    const result=await startChatGPTArtwork({source:access.source,id:access.id,userId:access.session.user.id,role:access.session.role,requestId:input.requestId});
    if(!result.job)throw new ArtworkError(result.reason||'The ChatGPT image worker is unavailable.',409);
    return Response.json({job:result.job},{status:202,headers});
  }catch(error){return artworkError(error);}
}
