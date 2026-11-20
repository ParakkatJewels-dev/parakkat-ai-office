import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { geminiJSON, type Part } from '@/lib/llm/gemini';
import { getGeminiConfig } from '@/lib/llm/gemini-config';
import { fetchShopifyPhoto, shopifyPhotoUrl } from '@/lib/agents/carousel-card.mjs';
import { FORMATS } from '@/lib/agents/design';
import { isPaused } from '@/lib/pause';
import { currentBrandLogo } from './brand-logo';

type Source = 'design' | 'creative';
type Check = { productMatch?: boolean; logoMatch?: boolean; textAccurate?: boolean; composition?: boolean; note?: string };
export type VisualQc = {
  version: 1; imagePath: string; requestId: string; status: 'pass' | 'fail' | 'unavailable';
  checks?: { productMatch: boolean; logoMatch: boolean; textAccurate: boolean; composition: boolean; ratio: boolean };
  note: string; checkedAt: string; attempts: number; nextAttemptAt?: string;
};
type Row = { id:string; image_path:string; artwork_request_id:string; artwork_handoff:any; product_ids:number[]; headline:string|null; format:string|null; brief?:string|null; body?:string|null; language:string|null };

const validCheck = (answer: Check) => ['productMatch','logoMatch','textAccurate','composition'].every(key => typeof answer?.[key as keyof Check] === 'boolean') && typeof answer.note === 'string' && answer.note.trim().length >= 12;
const ratioMatches = (width:number,height:number,format:string|null) => {
  const ratio=FORMATS[format as keyof typeof FORMATS]?.ratio;
  if(!ratio)return true;
  const [w,h]=ratio.split(':').map(Number);
  return Math.abs(width/height-w/h)/(w/h)<0.055;
};
const newPacket = (row:Row) => row.artwork_handoff?.packet?.requestId===row.artwork_request_id &&
  String(row.artwork_handoff.packet.prompt||'').includes("BANNER DESIGNER'S CHOSEN CONCEPT:");
const due = (row:Row,now:number) => {
  if(!newPacket(row))return false;
  const qc:VisualQc|undefined=row.artwork_handoff.visualQc;
  return qc?.imagePath!==row.image_path || qc?.requestId!==row.artwork_request_id ||
    (qc.status==='unavailable'&&qc.attempts<3&&Date.parse(qc.nextAttemptAt||'')<=now);
};
async function boundedImage(bytes:Buffer) {
  return sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize(1280,1280,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
}
async function checkImage(source:Source,row:Row):Promise<VisualQc> {
  const db=supabaseAdmin(),now=new Date().toISOString(),attempts=Number(row.artwork_handoff?.visualQc?.attempts||0)+1;
  try {
    const file=await db.storage.from('creatives').download(row.image_path);
    if(file.error||!file.data)throw new Error('image unavailable');
    const original=Buffer.from(await file.data.arrayBuffer()),metadata=await sharp(original,{limitInputPixels:40_000_000}).metadata();
    if(!metadata.width||!metadata.height)throw new Error('invalid image');
    const ids=(Array.isArray(row.product_ids)?row.product_ids:[]).slice(0,6);
    const products=ids.length?await db.from('products').select('id,title,image_url').in('id',ids):{data:[],error:null};
    if(products.error||ids.some(id=>!products.data?.some(p=>Number(p.id)===Number(id)&&shopifyPhotoUrl(p.image_url))))throw new Error('official product photo unavailable');
    const logo=await currentBrandLogo(row.artwork_handoff.logoId);
    if(logo.sha256!==row.artwork_handoff.logoSha256)throw new Error('approved logo changed');
    const sources=(products.data||[]).sort((a,b)=>ids.indexOf(Number(a.id))-ids.indexOf(Number(b.id)));
    const photoBytes=await Promise.all(sources.map(p=>fetchShopifyPhoto(shopifyPhotoUrl(p.image_url)!)));
    const images:Part[]=[
      {text:'FINISHED CREATIVE:'},{inlineData:{mimeType:'image/png',data:(await boundedImage(original)).toString('base64')}},
      {text:`OFFICIAL SHOPIFY PRODUCT PHOTOS, IN ORDER: ${sources.map(p=>p.title).join('; ')||'none'}`},
      ...await Promise.all(photoBytes.map(async bytes=>({inlineData:{mimeType:'image/png',data:(await boundedImage(bytes)).toString('base64')}}))),
      {text:'ONLY APPROVED LOGO:'},{inlineData:{mimeType:'image/png',data:(await boundedImage(logo.bytes)).toString('base64')}},
    ];
    const prompt=`Independently inspect the finished Parakkat Jewels creative. Compare it with the official product photos and selected logo. Do not infer hidden jewellery details. Return JSON {"productMatch":boolean,"logoMatch":boolean,"textAccurate":boolean,"composition":boolean,"note":"specific visible evidence or defects"}.
productMatch: every identifiable jewellery item must match its official photo in silhouette, stones, settings, motifs and metal tone; fail for a substitute, extra or obscured product. If no product photo was selected, pass only if no specific catalogue item is claimed.
logoMatch: exactly one faithful approved logo appears in the upper-right zone; fail for extra or altered marks.
textAccurate: the approved headline is ${JSON.stringify(row.headline||'none')}; language is ${row.language==='ml'?'Malayalam':'English'}. Fail for misspelling, extra offer, price or unsupported product claim.
composition: judge clear hierarchy, jewellery realism, readable type, intentional spacing, controlled light and an original high-standard campaign finish. Fail for defects, clutter or a recognizable copied past design. Brief: ${String(row.brief||row.body||'').slice(0,850)}.
Your decision is advisory to a human reviewer; report uncertainty as a failed check.`;
    const answer=await geminiJSON<Check>(prompt,images,{db,id:'creativeDirector',signal:AbortSignal.timeout(75_000)},'artwork_qc');
    if(!validCheck(answer))throw new Error('invalid visual review');
    const checks={productMatch:answer.productMatch!,logoMatch:answer.logoMatch!,textAccurate:answer.textAccurate!,composition:answer.composition!,ratio:ratioMatches(metadata.width,metadata.height,row.format)};
    return {version:1,imagePath:row.image_path,requestId:row.artwork_request_id,status:Object.values(checks).every(Boolean)?'pass':'fail',checks,note:answer.note!.trim().slice(0,600),checkedAt:now,attempts};
  } catch(error) {
    console.warn('Artwork visual QC unavailable:',source,error instanceof Error?error.name:'unknown');
    return {version:1,imagePath:row.image_path,requestId:row.artwork_request_id,status:'unavailable',note:'The independent image check could not finish. Review the image manually.',checkedAt:now,attempts,nextAttemptAt:new Date(Date.now()+60*60_000).toISOString()};
  }
}

/** One bounded quality check per scheduler tick; existing human decisions are never changed. */
export async function drainVisualQuality() {
  if(await isPaused(true))return {state:'paused'};
  const config=await getGeminiConfig();
  if(!config.apiKey)return {state:'provider_unavailable'};
  const db=supabaseAdmin(),now=Date.now();
  for(const source of ['creative','design'] as const) {
    const table=source==='creative'?'creatives':'designs',field=source==='creative'?'art_status':'status';
    const columns=`id,image_path,artwork_request_id,artwork_handoff,product_ids,headline,format,language,${source==='creative'?'body':'brief'}`;
    const results=await db.from(table).select(columns)
      .eq(field,'ready').not('image_path','is',null).not('artwork_handoff','is',null).order('created_at',{ascending:false}).limit(120);
    if(results.error)throw new Error('The artwork quality queue could not be read.');
    const row=(results.data||[]).find(item=>due(item as unknown as Row,now)) as unknown as Row|undefined;
    if(!row)continue;
    const holder=randomUUID(),name=`visual-qc:${source}:${row.id}`;
    const lock=await db.rpc('acquire_job_lock',{p_name:name,p_holder:holder,p_seconds:180});
    if(lock.error||!lock.data)continue;
    try {
      const fresh=await db.from(table).select(columns).eq('id',row.id).maybeSingle();
      if(fresh.error||!fresh.data||!due(fresh.data as unknown as Row,Date.now()))continue;
      const current=fresh.data as unknown as Row,qc=await checkImage(source,current);
      const saved=await db.from(table).update({artwork_handoff:{...current.artwork_handoff,visualQc:qc}})
        .eq('id',current.id).eq('artwork_request_id',current.artwork_request_id).eq('image_path',current.image_path).select('id').maybeSingle();
      if(saved.error)throw new Error('The artwork quality result could not be saved.');
      return {state:saved.data?'checked':'changed',source,status:qc.status};
    } finally {await db.rpc('release_job_lock',{p_name:name,p_holder:holder});}
  }
  return {state:'idle'};
}
