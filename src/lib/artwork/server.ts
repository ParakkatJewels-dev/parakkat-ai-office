import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { conversationUser } from '@/lib/agents/conversation-api';
import { FORMATS, type Source } from '@/lib/agents/design';
import { rankDesignReferences, referenceFingerprint } from '@/lib/agents/library-core.mjs';
import { fetchShopifyPhoto, shopifyPhotoUrl } from '@/lib/agents/carousel-card.mjs';
import { designImageById } from '@/lib/connectors/drive';
import { isChatGPTHandoff } from '@/lib/artwork-mode.mjs';
import { boundedFormData, validId, validOrigin, validateArtwork, zipFiles } from './import-core.mjs';

export class ArtworkError extends Error { constructor(message:string, public status=400) {super(message);} }
export type ArtworkProvider = 'chatgpt' | 'higgsfield';
function artworkProvider(value:unknown):ArtworkProvider {
  if(value===null || value===undefined) return 'chatgpt'; // Existing open forms remain valid.
  if(value==='chatgpt' || value==='higgsfield') return value;
  throw new ArtworkError('Choose ChatGPT or Higgsfield as the image source.');
}
const frozen = ['approved','publishing','publish_review','live'];
export type ArtworkContext = { params: Promise<{source:string;id:string}> };
export async function accessArtwork(context:ArtworkContext,options:{pendingOnly?:boolean}={}) {
  const session = await conversationUser();
  if (!session) throw new ArtworkError('Sign in to open this artwork.',401);
  if (!isChatGPTHandoff()) throw new ArtworkError('Artwork import is not enabled.',409);
  const {source,id} = await context.params;
  if (!['design','creative'].includes(source) || !validId(id)) throw new ArtworkError('Artwork not found.',404);
  const columns: string = source === 'design' ? 'id,format,brief,headline,language,product_ids,image_path,status,review_note,concept,ref_ids,versions,redo_note,artwork_request_id,artwork_origin,artwork_handoff,requested_by,carousel_id,carousel_index,carousel_source' : 'id,kind,format,body,headline,language,product_ids,image_path,art_status,review_note,concept,ref_ids,versions,redo_note,artwork_request_id,artwork_origin,artwork_handoff,campaign_id,campaigns(status,name)';
  const {data:row,error} = await session.db.from(source === 'design'?'designs':'creatives').select(columns).eq('id',id).maybeSingle();
  if (error || !row) throw new ArtworkError('Artwork not found or unavailable to your account.',404);
  const item = row as any;
  const head = ['super_admin','creative_head'].includes(session.role);
  if (source === 'design' && (!['super_admin','creative_head','ecom_manager','perf_marketer'].includes(session.role) || (!head && item.requested_by !== session.user.id))) throw new ArtworkError('You cannot import this artwork.',403);
  if (source === 'creative' && session.role === 'viewer') throw new ArtworkError('You cannot import this artwork.',403);
  if (source === 'creative' && frozen.includes(item.campaigns?.status)) throw new ArtworkError('This campaign is approved. Its artwork is frozen.',409);
  if (options.pendingOnly!==false && ((item.status || item.art_status) !== 'awaiting_import' || !validId(item.artwork_request_id))) throw new ArtworkError('Prepare a revision in Studio before importing another image.',409);
  return {session,source:source as Source,id,row:item};
}
type Access = Awaited<ReturnType<typeof accessArtwork>>;

async function packetFor(access:Access):Promise<any> {
  const {row,source,id} = access, admin = supabaseAdmin();
  if(row.artwork_handoff?.packet?.requestId===row.artwork_request_id) return row.artwork_handoff;
  const productIds = (Array.isArray(row.product_ids)?row.product_ids:[]).slice(0,3);
  const productResult = productIds.length ? await admin.from('products').select('id,title,image_url').in('id',productIds) : {data:[],error:null};
  if (productResult.error) throw new ArtworkError('The product photos could not be read. Try again.',503);
  const products = (productResult.data || []).map(p=>({...p,image_url:shopifyPhotoUrl(p.image_url)})).sort((a,b)=>productIds.map(String).indexOf(String(a.id))-productIds.map(String).indexOf(String(b.id)));
  if (productIds.length && (products.length !== productIds.length || products.some(p=>!p.image_url))) throw new ArtworkError('Each selected product needs its official Shopify photo before this pack can be prepared.',409);
  const columns='id,name,drive_id,modified_at,fingerprint,occasion,style,palette,layout,typography,kind,tags,quality,pinned';
  const result=await admin.from('design_refs').select(columns).eq('status','ready').eq('hidden',false).not('fingerprint','is',null).order('id').limit(1000);
  if(result.error) throw new ArtworkError('The Design Library could not be read. Try again.',503);
  const candidates=(result.data||[]).filter(r=>r.drive_id&&r.modified_at);
  const priorIds=(Array.isArray(row.ref_ids)?row.ref_ids:[]).slice(0,3);
  let explicit:any[]=[];
  if(row.carousel_id) {
    if(!priorIds.length)throw new ArtworkError('The carousel needs its selected style reference. Prepare the set again.',409);
    const chosen=await admin.from('design_refs').select(columns).in('id',priorIds).eq('status','ready').eq('hidden',false);
    explicit=priorIds.map((refId:string)=>chosen.data?.find(r=>r.id===refId));
    if(chosen.error||explicit.some(r=>!r?.drive_id||!r?.modified_at))throw new ArtworkError('A selected carousel style reference is unavailable. Restore it or prepare a new set.',409);
  }
  const format = row.format || (row.kind==='story'?'story':'post');
  const f=FORMATS[format as keyof typeof FORMATS] || FORMATS.post;
  const direction=[row.brief||row.body,row.headline,row.redo_note].filter(Boolean).join('\n');
  const refs=row.carousel_id ? explicit : rankDesignReferences(candidates,[direction],{productTitles:products.map(p=>p.title),direction:row.redo_note||direction,format,previousIds:priorIds,limit:3});
  const assets = [
    ...products.map((p,i)=>({name:`product-${i+1}.png`,kind:'product',url:p.image_url!,title:p.title})),
    ...refs.map((r:any,i:number)=>({name:`style-${i+1}.png`,kind:'style',title:r.name})),
    ...(row.image_path?[{name:'previous-artwork.png',kind:'previous',title:'Previous version to revise'}]:[]),
  ];
  const version=(Array.isArray(row.versions)?row.versions.length:0)+(row.image_path?2:1);
  const prompt=[
    `Create a finished ${f.label.toLowerCase()} for PARAKKAT JEWELS. Produce the image, not a text description.`,
    `Canvas: ${f.ratio} aspect ratio; target ${f.size}. Language: ${row.language==='ml'?'Malayalam':'English'}.`,
    row.carousel_id?`This is card ${row.carousel_index} of a five-card carousel. Keep all cards consistent in typography, colour, lighting and spacing. Generate this card as a separate finished image, not a collage of all cards.`:'',
    `Brief: ${row.brief||row.body||'Create premium jewellery artwork with a clear hero product and restrained, readable typography.'}`,
    `Approved headline: ${row.headline||'No headline supplied; do not invent promotional claims.'}`,
    products.length?`PRODUCT IDENTITY — the attached product files are the authoritative sources:\n${products.map((p,i)=>`product-${i+1}.png: ${p.title} (Shopify product ${p.id})`).join('\n')}\nPreserve the exact jewellery silhouette, stone count and colours, setting, motifs, metal tone and proportions. Do not substitute similar jewellery. Avoid cropping or obscuring its distinguishing features.`:'No product photo was selected. Do not invent a product claimed to be in the Parakkat catalogue.',
    refs.length?`STYLE REFERENCES — attach these actual past designs:\n${refs.map((r:any,i:number)=>`style-${i+1}.png: ${r.name}. ${i===0?'Primary art direction.':'Supporting finish only; do not blend conflicting scenes.'} ${referenceFingerprint(r)}`).join('\n')}\nUse their typography, hierarchy, lighting and level of finish as guidance. Their jewellery, prices, claims and offer badges are not approved content for this image.`:'No matching saved style reference is available. Use restrained premium jewellery art direction.',
    row.image_path?'The attached previous-artwork.png is the previous version. Preserve its approved product identity, wording and brand treatment except for the requested changes below. Do not simply re-export it.':'',
    row.redo_note?`REQUESTED REVISION (takes priority over earlier art direction): ${row.redo_note}`:'',
    'Brand: PARAKKAT JEWELS. Keep the brand name accurate and legible. Do not invent logo symbols, offers, prices, discounts, certifications or material claims. Use only explicitly approved copy. Produce a polished, cohesive jewellery photograph with clean spacing and controlled detail.',
    'Before returning the image, inspect product fidelity, typography, spelling, brand accuracy and the requested changes. Export the finished image as a still PNG, JPEG or WebP. A person will review it in AI Office before approval.',
    `AI Office artwork request: ${source}/${id} · ${row.artwork_request_id} · intended version ${version}.`,
  ].filter(Boolean).join('\n\n');
  const bundle={packet:{source,id,requestId:row.artwork_request_id,prompt,headline:row.headline||'',format,version,assets},refs,products};
  const table=source==='design'?'designs':'creatives';
  const saved=await admin.from(table).update({artwork_handoff:bundle}).eq('id',id).eq('artwork_request_id',row.artwork_request_id).is('artwork_handoff',null).in(source==='design'?'status':'art_status',['awaiting_import','generating']).select('artwork_handoff').maybeSingle();
  if(saved.error)throw new ArtworkError('The artwork brief could not be saved. Refresh Studio and try again.',409);
  if(saved.data?.artwork_handoff)return saved.data.artwork_handoff;
  const winner=await admin.from(table).select('artwork_handoff').eq('id',id).eq('artwork_request_id',row.artwork_request_id).in(source==='design'?'status':'art_status',['awaiting_import','generating']).maybeSingle();
  if(winner.data?.artwork_handoff?.packet?.requestId===row.artwork_request_id)return winner.data!.artwork_handoff;
  throw new ArtworkError('The artwork request changed. Refresh Studio before copying its brief.',409);
}
export async function artworkPacket(context:ArtworkContext,selectedProvider:unknown='chatgpt') {
  const provider=artworkProvider(selectedProvider);
  return {...(await packetFor(await accessArtwork(context))).packet,provider};
}

async function png(bytes:Buffer) {
  return sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize(2048,2048,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
}
async function sourceFiles(access:Access,bundle:any) {
  const {refs,products}=bundle;
  const files:{name:string;data:Buffer}[]=[];
  for(const [i,p] of products.entries()) files.push({name:`product-${i+1}.png`,data:await png(await fetchShopifyPhoto(p.image_url))});
  if(refs.length) {
    const valid=await supabaseAdmin().from('design_refs').select('id,modified_at').in('id',refs.map((r:any)=>r.id)).eq('status','ready').eq('hidden',false);
    if(valid.error||refs.some((ref:any)=>!valid.data?.some(r=>r.id===ref.id&&r.modified_at===ref.modified_at)))throw new ArtworkError('A saved style reference has changed or is unavailable. Prepare a new revision brief before continuing.',409);
  }
  const signal=AbortSignal.timeout(40_000);
  for(const [index,ref] of refs.entries()) {
    try {const image=await designImageById(ref.drive_id,signal,ref.modified_at);files.push({name:`style-${index+1}.png`,data:await png(image.data)});}
    catch {throw new ArtworkError(`The saved reference “${ref.name}” could not be verified or read from Drive. Refresh its library folder before continuing.`,409);}
  }
  if(access.row.image_path) {
    const old=await supabaseAdmin().storage.from('creatives').download(access.row.image_path);
    if(old.error||!old.data)throw new ArtworkError('The previous artwork could not be loaded. Try again.',503);
    files.push({name:'previous-artwork.png',data:await png(Buffer.from(await old.data.arrayBuffer()))});
  }
  return files;
}

/** Only a reserved, authorized job can prepare provider inputs; never expose this from a public route. */
export async function generationArtwork(job:{source:string;item_id:string;request_id:string},includeFiles=false) {
  const admin=supabaseAdmin();
  if(!['design','creative'].includes(job.source)||!validId(job.item_id)||!validId(job.request_id))throw new ArtworkError('Invalid generation request.');
  const {data:row,error}=await admin.from(job.source==='design'?'designs':'creatives').select('*').eq('id',job.item_id).eq('artwork_request_id',job.request_id).maybeSingle();
  if(error||!row||!['generating','awaiting_import'].includes(row.status||row.art_status))throw new ArtworkError('The artwork request changed. Its generation was stopped.',409);
  const access={source:job.source,id:job.item_id,row} as Access;
  const bundle=await packetFor(access);
  return {...bundle,files:includeFiles?await sourceFiles(access,bundle):[]};
}

export async function artworkPack(context:ArtworkContext,selectedProvider:unknown='chatgpt') {
  const provider=artworkProvider(selectedProvider), label=provider==='higgsfield'?'Higgsfield':'ChatGPT';
  const access=await accessArtwork(context), bundle=await packetFor(access), {packet}=bundle;
  const instructions=[
    '1. Unzip this pack.',
    `2. Attach its product, style and previous-artwork images in ${label}.`,
    provider==='higgsfield'?'3. On higgsfield.ai, choose a model included in your plan and enable Unlimited. Confirm the generate button says Unlimited before generating; model and resolution eligibility can vary. Paste brief.txt.':'3. Paste brief.txt and generate the image in ChatGPT.',
    `4. Download the finished image. Select ${label} in the matching AI Office request and import it for review.`,
    '5. Review product identity, copy and branding before approval.',
    `${label} plan limits apply. This pack does not call an image API or transfer your login.`,
    provider==='higgsfield'?'Open Higgsfield: https://higgsfield.ai/ai/image?model=nano-banana-pro':'Open ChatGPT: https://chatgpt.com/',
    '',
  ].join('\n');
  const files:{name:string;data:Buffer|string}[]=[{name:'brief.txt',data:packet.prompt},{name:'README.txt',data:instructions}];
  // Fetch only after the explicit download action. Drive originals are transient.
  files.push(...await sourceFiles(access,bundle));
  const bytes=zipFiles(files);
  if(bytes.length>100*1024*1024)throw new ArtworkError('The reference pack is too large. Choose fewer product photos.',413);
  return {bytes,id:access.id};
}

export async function importArtwork(request:Request,context:ArtworkContext) {
  if(!validOrigin(request,process.env.APP_URL))throw new ArtworkError('Invalid request origin.',403);
  const access=await accessArtwork(context);
  let form:FormData;
  try {form=await boundedFormData(request);} catch(e) {throw new ArtworkError(e instanceof Error?e.message:'Invalid image upload.',400);}
  const requestId=form.get('requestId'), file=form.get('file'), provider=artworkProvider(form.get('provider'));
  if(!validId(requestId)||requestId!==access.row.artwork_request_id)throw new ArtworkError('This revision request has changed. Refresh Studio before uploading.',409);
  if(!(file instanceof File))throw new ArtworkError('Choose the finished image file.');
  let image;
  const bytes=Buffer.from(await file.arrayBuffer());
  try {image=await validateArtwork(bytes,file.type);} catch(e) {throw new ArtworkError((e as Error).message);}
  const path=`${provider}-imports/${access.source}/${access.id}/${requestId}/${randomUUID()}.${image.extension}`;
  const admin=supabaseAdmin(), bucket=admin.storage.from('creatives');
  const uploaded=await bucket.upload(path,bytes,{contentType:image.mimeType,upsert:false,cacheControl:'31536000'});
  if(uploaded.error)throw new ArtworkError('The image could not be stored. Try again.',503);
  // Row lock + request UUID check, version history and review invalidation happen in one transaction.
  const result=await admin.rpc('commit_external_artwork_import',{p_source:access.source,p_id:access.id,p_request_id:requestId,p_path:path,p_user_id:access.session.user.id,p_provider:provider,p_ref_ids:access.row.artwork_handoff?.refs?.map((r:any)=>r.id)||access.row.ref_ids||[]});
  if(result.error||!result.data) {
    // A network failure can follow a committed transaction. Never delete a path still in use.
    const check=await admin.from(access.source==='design'?'designs':'creatives').select('image_path,versions').eq('id',access.id).maybeSingle();
    const referenced=check.data?.image_path===path || (Array.isArray(check.data?.versions)&&check.data.versions.some((v:any)=>v.image_path===path));
    if(!check.error&&!referenced)await bucket.remove([path]);
    if(check.data?.image_path!==path)throw new ArtworkError('The request changed or the import could not be confirmed. Refresh Studio before retrying.',409);
  }
  const signed=await bucket.createSignedUrl(path,3600);
  if(signed.error||!signed.data?.signedUrl)throw new ArtworkError('The image was imported, but its preview could not load. Refresh Studio.',503);
  return {id:access.id,source:access.source,status:'ready',provider,imageUrl:signed.data.signedUrl,version:result.data?.version||((access.row.versions?.length||0)+(access.row.image_path?2:1))};
}
export function artworkError(error:unknown) {
  const known=error instanceof ArtworkError;
  if(!known)console.error('Artwork request failed:',error instanceof Error?error.name:'unknown');
  return Response.json({error:known?error.message:'The artwork request could not be completed. Try again.'},{status:known?error.status:503,headers:{'Cache-Control':'private, no-store'}});
}
