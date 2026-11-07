import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { conversationUser } from '@/lib/agents/conversation-api';
import { FORMATS, type Source } from '@/lib/agents/design';
import { rankDesignReferences, referenceFingerprint, requestedDesignOccasion } from '@/lib/agents/library-core.mjs';
import { fetchShopifyPhoto, shopifyPhotoUrl } from '@/lib/agents/carousel-card.mjs';
import { designImageById } from '@/lib/connectors/drive';
import { shopifyArtworkPrice } from '@/lib/connectors/shopify';
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
  const artworkStatus = source === 'creative' ? item.art_status : item.status;
  if (options.pendingOnly!==false && (artworkStatus !== 'awaiting_import' || !validId(item.artwork_request_id))) throw new ArtworkError('Prepare a revision in Studio before importing another image.',409);
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
  const series=row.carousel_source?.series_id && Number(row.carousel_source?.total)>1 ? row.carousel_source : null;
  const followsTemplate=source==='design' && (row.carousel_id ? Number(row.carousel_index)>1 : series && Number(series.index)>1);
  let template:{id:string;path:string}|null=null;
  if(followsTemplate) {
    const first=series?.template_design_id && validId(series.template_design_id)
      ? await admin.from('designs').select('id,requested_by,status,image_path,carousel_id,carousel_index,carousel_source').eq('id',series.template_design_id).maybeSingle()
      : row.carousel_id
        ? await admin.from('designs').select('id,requested_by,status,image_path,carousel_id,carousel_index,carousel_source').eq('carousel_id',row.carousel_id).eq('carousel_index',1).maybeSingle()
        : await admin.from('designs').select('id,requested_by,status,image_path,carousel_id,carousel_index,carousel_source').contains('carousel_source',{series_id:series.series_id,index:1}).eq('requested_by',row.requested_by).limit(1).maybeSingle();
    const card=first.data;
    if(first.error || !card || card.status!=='ready' || !card.image_path || card.requested_by!==row.requested_by ||
      (row.carousel_id ? card.carousel_id!==row.carousel_id || card.carousel_index!==1
        : card.carousel_source?.series_id!==series.series_id || Number(card.carousel_source?.index)!==1))
      throw new ArtworkError('Finish the first carousel poster before generating the remaining products from its template.',409);
    template={id:card.id,path:card.image_path};
  }
  if(row.carousel_id || (series && priorIds.length)) {
    if(!priorIds.length)throw new ArtworkError('The carousel needs its selected style reference. Prepare the set again.',409);
    const chosen=await admin.from('design_refs').select(columns).in('id',priorIds).eq('status','ready').eq('hidden',false);
    explicit=priorIds.map((refId:string)=>chosen.data?.find(r=>r.id===refId));
    if(chosen.error||explicit.some(r=>!r?.drive_id||!r?.modified_at))throw new ArtworkError('A selected carousel style reference is unavailable. Restore it or prepare a new set.',409);
  }
  const format = row.format || (row.kind==='story'?'story':'post');
  const f=FORMATS[format as keyof typeof FORMATS] || FORMATS.post;
  const direction=[row.brief||row.body,row.headline,row.redo_note].filter(Boolean).join('\n');
  const occasion=requestedDesignOccasion(row.redo_note)||requestedDesignOccasion(String(row.brief||row.body||'').split(/\n\n/)[0]);
  const usePreviousArtwork=!!row.image_path&&!template&&!/\b(?:do not use|ignore|omit)\s+(?:the\s+)?(?:previous|old)\s+(?:image|artwork)\b/i.test(row.redo_note||'');
  // The built-in ChatGPT image tool accepts at most five reference paths. Keep
  // every authoritative product photo and the previous artwork before styles.
  const styleSlots=template?0:Math.max(0,Math.min(series?1:3,5-products.length-(usePreviousArtwork?1:0)));
  const refs=(explicit.length ? explicit : styleSlots ? rankDesignReferences(candidates,[direction],{productTitles:products.map(p=>p.title),direction:row.redo_note||direction,occasion:occasion||'general',format,previousIds:priorIds,limit:styleSlots}) : []).slice(0,styleSlots);
  const prices=await Promise.all(products.map(async p=>{try{return await shopifyArtworkPrice(Number(p.id));}catch{return null;}}));
  const money=(amount:number,currency:string)=>new Intl.NumberFormat(currency==='INR'?'en-IN':'en',{style:'currency',currency,maximumFractionDigits:amount%1?2:0}).format(amount);
  const priceCopy=prices.map((price,i)=>price?`${products[i].title}: ${price.min===price.max?money(price.min,price.currency):`from ${money(price.min,price.currency)}`} (live Shopify base-store price checked ${price.checkedAt}; verify market-specific pricing before publication)`:'').filter(Boolean);
  const assets = [
    ...products.map((p,i)=>({name:`product-${i+1}.png`,kind:'product',url:p.image_url!,title:p.title})),
    ...(template?[{name:'template-1.png',kind:'template',title:'First saved poster in this carousel series'}]:[]),
    ...refs.map((r:any,i:number)=>({name:`style-${i+1}.png`,kind:'style',title:r.name})),
    ...(usePreviousArtwork?[{name:'previous-artwork.png',kind:'previous',title:'Previous version to revise'}]:[]),
  ];
  const version=(Array.isArray(row.versions)?row.versions.length:0)+(row.image_path?2:1);
  const prompt=[
    `Create a finished ${f.label.toLowerCase()} for PARAKKAT JEWELS. Produce the image, not a text description.`,
    `Canvas: ${f.ratio} aspect ratio; target ${f.size}. Language: ${row.language==='ml'?'Malayalam':'English'}.`,
    occasion?`CURRENT TASK OCCASION: ${occasion.toUpperCase()}. The finished artwork must visibly communicate this occasion. Past designs may guide only reusable composition and finish; their seasonal setting and props are not instructions.${occasion==='christmas'?' For Christmas, use an intentional Christmas setting and include a legible Christmas title. Do not use diyas, brass oil lamps, puja objects, marigold garlands or temple architecture as background decorations. Do not invent a discount or sale amount.':''}`:'',
    row.carousel_id?`This is card ${row.carousel_index} of a five-card carousel. Keep the exact same layout grid, product placement and scale, headline zone, brand position, typography, palette, lighting, background and CTA placement on every card. Change only the product and its approved details. Generate this card as a separate finished image, not a collage of all cards.`:series?`This is card ${series.index} of a ${series.total}-card carousel ad. Shared format for the entire series: ${series.direction||'Keep one identical layout, type hierarchy, background, product position and CTA position.'} Only product and approved details change. Generate one finished card, not a collage.`:'',
    template?`FIXED CAROUSEL TEMPLATE — template-1.png is the first saved poster in this exact set. Match its background, surface texture, colour palette, lighting, margins, product position and scale, wordmark, typography, headline zone, title zone and CTA position as closely as possible. Replace ONLY the template's jewellery and product title with product-1.png and its exact title. The product in template-1.png is not the product for this poster. The official product photo alone controls product identity. This template rule overrides any earlier brief asking for a different background or layout.`:(series&&Number(series.index)===1)||(row.carousel_id&&Number(row.carousel_index)===1)?'This first card establishes the fixed template for the set. Later cards must keep this layout, palette, background, typography and CTA position while changing only the product and its title.':'',
    `Brief: ${row.brief||row.body||'Create premium jewellery artwork with a clear hero product and restrained, readable typography.'}`,
    `Approved headline: ${row.headline||'No headline supplied; do not invent promotional claims.'}`,
    products.length?`PRODUCT IDENTITY — the attached product files are the authoritative sources:\n${products.map((p,i)=>`product-${i+1}.png: ${p.title} (Shopify product ${p.id})`).join('\n')}\nPreserve the exact jewellery silhouette, stone count and colours, setting, motifs, metal tone and proportions. Do not substitute similar jewellery. Avoid cropping or obscuring its distinguishing features.`:'No product photo was selected. Do not invent a product claimed to be in the Parakkat catalogue.',
    priceCopy.length?`OPTIONAL VERIFIED PRICE COPY — use only if it improves the customer-facing hierarchy; preserve the exact value and currency, including "from" for a price range:\n${priceCopy.join('\n')}`:'No current Shopify price was verified for this artwork; omit all prices.',
    refs.length?`BRAND STYLE REFERENCES — attach these actual past designs:\n${refs.map((r:any,i:number)=>`style-${i+1}.png: ${r.name}. ${i===0?'Brand quality benchmark.':'Supporting finish only; do not blend conflicting scenes.'} ${referenceFingerprint(r)}`).join('\n')}\nUse these designs only for transferable composition, product scale, palette relationships, typography, hierarchy, lighting and finish. The current brief and requested occasion control the subject, setting, symbols, decorations and props. A different festival shown or described in a past reference must not appear in this image. The manager brief and dated visual research determine this artwork's composition. Do not copy a past layout literally unless the manager explicitly requested it. For a carousel, hold the newly chosen layout fixed across all cards. Their jewellery, prices, claims and offer badges are not approved content for this image.`:template?'Use template-1.png as the sole visual template. Ignore unrelated past visual directions and do not change its setting or composition.':'No matching saved style reference is available for this product and occasion. Use the official product photo for identity and the brand’s reusable layout principles: one clear hero, a legible headline zone, controlled lighting, generous spacing and a concise CTA. Build a fresh scene for the current brief.',
    usePreviousArtwork?'The attached previous-artwork.png is the previous version. Preserve its approved product identity and brand treatment except for the requested changes below. Previous wording, festival details and props are not approved for a new occasion; follow the current brief. Do not simply re-export it.':'',
    row.redo_note?`REQUESTED REVISION (takes priority over earlier art direction): ${row.redo_note}`:'',
    'Brand: PARAKKAT JEWELS. Keep the brand name accurate and legible as a plain wordmark. Do not invent a P monogram, crown, founding date, purity slogan or other brand mark. Make the product appealing with clear hierarchy, a strong customer hook and a concise shopping CTA. You may use the exact verified Shopify price above, the product title, and an offer only when the manager explicitly supplied that offer in the brief. Do not infer promotions from inspiration pages or invent discounts, certifications or material claims. Produce a polished, cohesive jewellery photograph with clean spacing and controlled detail.',
    'Before returning the image, inspect product fidelity, typography, spelling, brand accuracy and the requested changes. Export the finished image as a still PNG, JPEG or WebP. A person will review it in AI Office before approval.',
    `AI Office artwork request: ${source}/${id} · ${row.artwork_request_id} · intended version ${version}.`,
  ].filter(Boolean).join('\n\n');
  const bundle={packet:{source,id,requestId:row.artwork_request_id,prompt,headline:row.headline||'',format,version,assets},refs,products,template};
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
  if(bundle.template) {
    const first=await supabaseAdmin().from('designs').select('id,requested_by,carousel_id,carousel_index,carousel_source,image_path,versions').eq('id',bundle.template.id).maybeSingle();
    const card=first.data;
    const sameSet=access.row.carousel_id
      ? card?.carousel_id===access.row.carousel_id && card?.carousel_index===1
      : card?.carousel_source?.series_id===access.row.carousel_source?.series_id && Number(card?.carousel_source?.index)===1;
    const savedPath=card?.image_path===bundle.template.path || (Array.isArray(card?.versions)&&card.versions.some((v:any)=>v.image_path===bundle.template.path));
    if(first.error||!card||card.requested_by!==access.row.requested_by||!sameSet||!savedPath)throw new ArtworkError('The carousel template changed. Prepare the poster again.',409);
    const original=await supabaseAdmin().storage.from('creatives').download(bundle.template.path);
    if(original.error||!original.data)throw new ArtworkError('The first carousel poster could not be loaded as the template.',409);
    files.push({name:'template-1.png',data:await png(Buffer.from(await original.data.arrayBuffer()))});
  }
  if(refs.length) {
    const valid=await supabaseAdmin().from('design_refs').select('id,modified_at').in('id',refs.map((r:any)=>r.id)).eq('status','ready').eq('hidden',false);
    if(valid.error||refs.some((ref:any)=>!valid.data?.some(r=>r.id===ref.id&&r.modified_at===ref.modified_at)))throw new ArtworkError('A saved style reference has changed or is unavailable. Prepare a new revision brief before continuing.',409);
  }
  const signal=AbortSignal.timeout(40_000);
  for(const [index,ref] of refs.entries()) {
    try {const image=await designImageById(ref.drive_id,signal,ref.modified_at);files.push({name:`style-${index+1}.png`,data:await png(image.data)});}
    catch {throw new ArtworkError(`The saved reference “${ref.name}” could not be verified or read from Drive. Refresh its library folder before continuing.`,409);}
  }
  if(bundle.packet.assets.some((asset:any)=>asset.kind==='previous')) {
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
  const artworkStatus=job.source==='creative'?row?.art_status:row?.status;
  if(error||!row||!['generating','awaiting_import'].includes(artworkStatus))throw new ArtworkError('The artwork request changed. Its generation was stopped.',409);
  const access={source:job.source,id:job.item_id,row} as Access;
  const bundle=await packetFor(access);
  return {...bundle,files:includeFiles?await sourceFiles(access,bundle):[]};
}

export async function artworkPack(context:ArtworkContext,selectedProvider:unknown='chatgpt') {
  const provider=artworkProvider(selectedProvider), label=provider==='higgsfield'?'Higgsfield':'ChatGPT';
  const access=await accessArtwork(context), bundle=await packetFor(access), {packet}=bundle;
  const instructions=[
    '1. Unzip this pack.',
    `2. Attach every image included in this pack in ${label}.`,
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
