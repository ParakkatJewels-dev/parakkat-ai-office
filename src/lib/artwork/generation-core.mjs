import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

export const HIGGSFIELD_IMAGE_MODELS = [
  {id:'gpt_image_2_5',name:'GPT Image 2.5 Sunburst · high · 2K'},
  {id:'nano_banana_pro',name:'Nano Banana Pro · 2K'},
];
// Higgsfield advertises UUID versions 1–8 for its jobs, uploaded media and folders.
export const validProviderId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function generationParams(model,ratio,descriptor) {
  if(!HIGGSFIELD_IMAGE_MODELS.some(item=>item.id===model))throw new Error('Choose an available Higgsfield image model.');
  if(descriptor?.id!==model || descriptor.output_type!=='image' || !descriptor.aspect_ratios?.includes(ratio))throw new Error('This model does not support the requested artwork format.');
  const params={model,aspect_ratio:ratio,count:1,use_unlim:false,resolution:'2k'};
  if(model==='gpt_image_2_5')Object.assign(params,{variant:'sunburst',quality:'high'});
  for(const [name,value] of Object.entries(params)) {
    if(['model','aspect_ratio','count','use_unlim'].includes(name))continue;
    const spec=descriptor.parameters?.find(item=>item.name===name);
    if(!spec || !spec.options?.includes(value))throw new Error('The requested image quality is unavailable. No lower-quality model was substituted.');
  }
  if(!descriptor.medias?.some(item=>item.type==='image'&&item.roles?.includes('image_references')))throw new Error('This model does not accept the product reference images.');
  return params;
}
export function quoteCredits(result,params) {
  if(result?.error || result?.unlim_choice)throw new Error('Higgsfield could not quote this image using subscription credits.');
  const cost=result?.cost;
  const values=[cost?.credits,cost?.credits_exact].filter(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0);
  if(!values.length)throw new Error('Higgsfield did not provide a verifiable credit quote.');
  for(const [key,change] of Object.entries(result.adjustments||{}))if(Object.hasOwn(params,key)&&change?.used!==params[key])throw new Error('Higgsfield changed the requested image settings. No image was generated.');
  return Math.max(...values);
}
export function availableCredits(result) {
  if(result?.error || typeof result?.credits!=='number' || !Number.isFinite(result.credits) || result.credits<0)throw new Error('Higgsfield credit balance is unavailable.');
  return result.credits;
}
/** Preserve the provider receipt even if it reports settings different from our quote. */
export function receiptQuality(result,params) {
  const item=result?.results?.[0],settings={};
  let changed=item?.model!==params.model || item?.type!=='image';
  for(const key of ['model','aspect_ratio','count','use_unlim','variant','quality','resolution']) {
    const adjustment=result?.adjustments?.[key];
    const value=adjustment?.used??(key==='model'?item?.model:item?.params?.[key]);
    if(['string','number','boolean'].includes(typeof value))settings[key]=typeof value==='string'?value.slice(0,100):value;
    if(value!=null&&Object.hasOwn(params,key)&&value!==params[key])changed=true;
  }
  return {actualSettings:settings,...(changed?{warning:'Higgsfield reported different output settings from the requested model or quality. Inspect this image before approving it; no replacement was submitted.'}:{})};
}
function publicIP(address) {
  if(isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===198&&(p[1]===18||p[1]===19)));}
  if(isIP(address)===6){const a=address.toLowerCase();return /^[23][0-9a-f]{3}:/.test(a)&&!a.startsWith('2001:db8:');}
  return false;
}
async function publicMediaTarget(value,resolve=lookup) {
  let url;try{url=new URL(value);}catch{throw new Error('Higgsfield returned an invalid media address.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.hash||url.hostname.length>250)throw new Error('Higgsfield returned an unsafe media address.');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(hostname)?[{address:hostname}]:await resolve(hostname,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(row=>!publicIP(row.address)))throw new Error('Higgsfield returned a non-public media address.');
  return {url,addresses};
}
export async function publicMediaUrl(value,resolve=lookup) {return (await publicMediaTarget(value,resolve)).url.href;}
/** Pin the verified DNS answers to this TLS request; no second DNS lookup or redirect. */
export function createPublicMediaFetcher({resolve=lookup,request=httpsRequest}={}) {
  return async (value,init={})=>{
    const {url,addresses}=await publicMediaTarget(value,resolve);
    if(!['GET','PUT'].includes(init.method||'GET'))throw new Error('Unsupported media operation.');
    const headers=new Headers(init.headers),safeHeaders={};
    for(const key of ['content-type','accept'])if(headers.has(key))safeHeaders[key]=headers.get(key);
    if(init.body!=null&&!(init.body instanceof Uint8Array))throw new Error('Invalid media upload.');
    if(init.body)safeHeaders['content-length']=String(init.body.byteLength);
    return new Promise((resolveResponse,reject)=>{
      const req=request(url,{agent:false,method:init.method||'GET',headers:safeHeaders,signal:init.signal,lookup:(_hostname,options,callback)=>{
        const candidates=addresses.filter(row=>!options.family||isIP(row.address)===options.family).map(row=>({address:row.address,family:isIP(row.address)}));
        if(!candidates.length)return callback(new Error('No public media address is available.'));
        if(options.all)callback(null,candidates);else callback(null,candidates[0].address,candidates[0].family);
      }},res=>{
        if(res.statusCode>=300&&res.statusCode<400){res.destroy();reject(new Error('Media redirects are not allowed.'));return;}
        const responseHeaders=new Headers();for(const [key,value] of Object.entries(res.headers))if(value!=null)responseHeaders.set(key,Array.isArray(value)?value.join(', '):String(value));
        try{
          const empty=[204,205].includes(res.statusCode);if(empty)res.resume();
          resolveResponse(new Response(empty?null:Readable.toWeb(res),{status:res.statusCode,headers:responseHeaders}));
        }catch(error){res.destroy();reject(error);}
      });
      req.on('error',reject);req.end(init.body);
    });
  };
}
export const fetchPublicMedia=createPublicMediaFetcher();
export async function readImageResponse(response,maxBytes=20*1024*1024) {
  const type=response.headers.get('content-type')?.split(';')[0].trim();
  if(!response.ok||!['image/png','image/jpeg','image/webp'].includes(type)||!response.body||Number(response.headers.get('content-length'))>maxBytes)throw new Error('The generated image could not be downloaded safely.');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes){await reader.cancel();throw new Error('The generated image exceeds 20 MiB.');}chunks.push(value);}}finally{reader.releaseLock();}
  return {bytes:Buffer.concat(chunks),type};
}
