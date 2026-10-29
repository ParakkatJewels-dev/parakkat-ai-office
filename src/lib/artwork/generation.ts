import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getHiggsfieldStatus } from '@/lib/higgsfield/auth.mjs';
import { callHiggsfieldTool } from '@/lib/higgsfield/mcp.mjs';
import { FORMATS, type Source } from '@/lib/agents/design';
import { isPaused } from '@/lib/pause';
import { accessArtwork, generationArtwork, ArtworkError, type ArtworkContext } from './server';
import { validId, validateArtwork } from './import-core.mjs';
import { HIGGSFIELD_IMAGE_MODELS, generationParams, quoteCredits, availableCredits, publicMediaUrl, readImageResponse, receiptQuality, fetchPublicMedia, validProviderId } from './generation-core.mjs';
import { reserveGenerationJob, claimGenerationJob, updateGenerationJob, completeGenerationJob, dueGenerationJobs, generationJobForArtwork, authorizeGenerationPreparation, renewGenerationLease, beginGenerationProject, commitGenerationProject, failGenerationProject, type GenerationJob } from './generation-jobs';

const activeStates=['queued','submitting','submitted','collecting'];
const catalogCache=new Map<string,{at:number,value:any}>();
const ratioFor=(format:string)=>FORMATS[format as keyof typeof FORMATS]?.ratio||'1:1';
const modelId=(value?:unknown)=>value==null?'gpt_image_2_5':typeof value==='string'&&HIGGSFIELD_IMAGE_MODELS.some(m=>m.id===value)?value:(()=>{throw new ArtworkError('Choose an available Higgsfield image model.');})();
const publicJob=(job:any)=>job?{id:job.id,state:job.state,error:job.error||null,errorCode:job.error_code||null,warning:job.usage?.warning||null,model:job.model,updatedAt:job.updated_at,credits:job.usage?.credits??null}:null;
const callFor=(accountId:string,workspaceId?:string)=> (name:string,args:any={},timeoutMs=30_000)=>callHiggsfieldTool(name,args,{expectedAccountId:accountId,expectedWorkspaceId:workspaceId,timeoutMs});

async function catalog(status:any,ratio:string) {
  const key=`${status.accountId}:${status.workspaceId}:${ratio}`,cached=catalogCache.get(key);
  if(cached&&Date.now()-cached.at<15_000)return cached.value;
  const call=callFor(status.accountId,status.workspaceId);
  let credits:number|null=null,error:string|undefined;
  try{credits=availableCredits(await call('balance'));}catch{error='Higgsfield credits could not be checked. Reconnect the account or try again.';}
  const models=await Promise.all(HIGGSFIELD_IMAGE_MODELS.map(async choice=>{
    try{const descriptor=await call('models_get',{model_id:choice.id});const params=generationParams(choice.id,ratio,descriptor);const quote=quoteCredits(await call('estimate_image_cost',{params}),params);return {...choice,credits:quote,available:true};}
    catch{return {...choice,credits:null,available:false,error:'This model or format could not be verified.'};}
  }));
  const value={balance:{credits},models,...(error?{error}:{})};
  if(credits!==null){catalogCache.set(key,{at:Date.now(),value});if(catalogCache.size>30)catalogCache.delete(catalogCache.keys().next().value!);}
  return value;
}

export async function artworkGenerationStatus(context:ArtworkContext) {
  const access=await accessArtwork(context,{pendingOnly:false}),status=await getHiggsfieldStatus();
  const db=supabaseAdmin();
  const found=validId(access.row.artwork_request_id)?await db.from('artwork_generation_jobs').select('*').eq('source',access.source).eq('item_id',access.id).eq('request_id',access.row.artwork_request_id).maybeSingle():{data:null,error:null};
  if(found.error)throw new ArtworkError('Image generation status is unavailable. Try again.',503);
  const job:any=publicJob(found.data);
  if(job?.state==='succeeded'&&access.row.image_path){const signed=await db.storage.from('creatives').createSignedUrl(access.row.image_path,3600);job.imageUrl=signed.data?.signedUrl||null;}
  const info=status.connected?await catalog(status,ratioFor(access.row.format)):{balance:{credits:null},models:HIGGSFIELD_IMAGE_MODELS.map(m=>({...m,credits:null,available:false}))};
  return {connected:status.connected,accountName:status.accountName||null,requestId:access.row.artwork_request_id,job,...info};
}

/** Called only after an explicit image/revision request; connection alone never starts old artwork. */
export async function startAutomaticArtwork(options:{source:Source;id:string;userId:string;role?:string;requestId?:string;model?:string;projectScope?:string}) {
  if(!['design','creative'].includes(options.source)||!validId(options.id)||!validId(options.userId))throw new ArtworkError('Invalid artwork request.');
  if(await isPaused(true))return {started:false,job:null,reason:'AI Office is paused. Resume it before generating artwork.'};
  const status=await getHiggsfieldStatus();
  if(!status.connected||!status.accountId)return {started:false,job:null,reason:'Connect Higgsfield in Settings to generate automatically.'};
  const db=supabaseAdmin(),model=modelId(options.model);
  const {data:row,error}=await db.from(options.source==='design'?'designs':'creatives').select('artwork_request_id').eq('id',options.id).maybeSingle();
  if(error||!row||!validId(row.artwork_request_id))throw new ArtworkError('Prepare an artwork request before generating.',409);
  if(options.requestId&&options.requestId!==row.artwork_request_id)throw new ArtworkError('This revision request changed. Refresh before generating.',409);
  const preparation=await authorizeGenerationPreparation(db,{source:options.source,id:options.id,requestId:row.artwork_request_id,userId:options.userId});
  const existing=await generationJobForArtwork(db,options.source,options.id,row.artwork_request_id);
  if(!existing)await generationArtwork({source:options.source,item_id:options.id,request_id:row.artwork_request_id});
  const projectScope=options.projectScope||existing?.settings?.projectScope||(preparation.carouselId?`carousel:${preparation.carouselId}`:preparation.campaignId?`campaign:${preparation.campaignId}`:`${options.source}:${options.id}`);
  if(typeof projectScope!=='string'||!/^(thread|carousel|campaign|design|creative):[0-9a-f-]{36}$/i.test(projectScope))throw new ArtworkError('Invalid artwork project scope.');
  const job=await reserveGenerationJob(db,{source:options.source,id:options.id,requestId:row.artwork_request_id,userId:options.userId,model,accountId:status.accountId,settings:{workspaceId:status.workspaceId||null,projectScope}});
  return {started:activeStates.includes(job.state),job:publicJob(job),...(activeStates.includes(job.state)?{}:{reason:job.error||'This request already has a generation result. Prepare a new revision to generate again.'})};
}

export async function startArtworkGeneration(context:ArtworkContext,input:any) {
  const access=await accessArtwork(context,{pendingOnly:false});
  if(!validId(input?.requestId)||input.requestId!==access.row.artwork_request_id)throw new ArtworkError('This revision request changed. Refresh before generating.',409);
  const result=await startAutomaticArtwork({source:access.source,id:access.id,userId:access.session.user.id,role:access.session.role,requestId:input.requestId,model:modelId(input.model)});
  if(!result.job)throw new ArtworkError(result.reason||'Connect Higgsfield first.',409);
  return {job:result.job};
}

/** Dependency boundary lets tests prove that uncertain submissions are never replayed. */
export function createGenerationWorker(deps:{call?:typeof callHiggsfieldTool;auth?:typeof getHiggsfieldStatus;artwork?:typeof generationArtwork;fetch?:typeof fetch;publicUrl?:typeof publicMediaUrl}={}) {
  const tool=deps.call||callHiggsfieldTool,auth=deps.auth||getHiggsfieldStatus,artwork=deps.artwork||generationArtwork,fetcher=deps.fetch||fetchPublicMedia,urlFor=deps.publicUrl||publicMediaUrl;
  return async function run(db:any,pending:GenerationJob) {
    const holder=randomUUID();
    const job=await claimGenerationJob(db,{id:pending.id,holder,expectedState:pending.state,leaseSeconds:600});
    if(!job||!['submitting','submitted','collecting'].includes(job.state))return null;
    let state=job.state,dispatched=false;
    const workspaceId=typeof job.settings?.workspaceId==='string'?job.settings.workspaceId:undefined;
    const update=async(patch:any)=>{const next=await updateGenerationJob(db,{id:job.id,holder,expectedState:state,...patch});state=next.state;return next;};
    const call=(name:string,args:any={},timeoutMs=30_000)=>tool(name,args,{timeoutMs,expectedAccountId:job.account_id,expectedWorkspaceId:workspaceId});
    try{
      const connection=await auth();
      if(!connection.connected||connection.accountId!==job.account_id||connection.workspaceId!==workspaceId) {
        await update({state:job.provider_request_id?state:'blocked',errorCode:'auth',error:'Reconnect the same Higgsfield account and workspace to continue.',nextPollAt:new Date(Date.now()+60_000).toISOString()});return 'connection required';
      }
      if(state==='submitting') {
        const bundle=await artwork(job),ratio=ratioFor(bundle.packet.format);
        const descriptor=await call('models_get',{model_id:job.model});
        const params=generationParams(job.model,ratio,descriptor);
        let quote=quoteCredits(await call('estimate_image_cost',{params}),params),balance=availableCredits(await call('balance'));
        if(balance<quote){await update({state:'blocked',errorCode:'credits',error:`This image needs about ${quote} Higgsfield credits; the account has ${balance}. No generation was submitted.`,usage:{credits:quote,balance}});return 'insufficient credits';}
        const assets=await artwork(job,true),files=assets.files;
        const bound=descriptor.medias?.find((m:any)=>m.type==='image'&&m.roles?.includes('image_references'))?.max;
        if(!files.length||files.length>14||(typeof bound==='number'&&files.length>bound))throw new Error('The model cannot accept this reference pack.');
        const uploads=await call('media_upload',{files:files.map((f:any)=>({filename:`${job.id}-${f.name}`,content_type:'image/png'})),method:'upload_url',...(job.settings?.workspaceId?{workspace_id:job.settings.workspaceId}:{})});
        if(uploads.error||!Array.isArray(uploads.uploads)||uploads.uploads.length!==files.length)throw new Error('Reference uploads could not be prepared.');
        const medias=[];
        for(const [index,upload] of uploads.uploads.entries()){
          if(!validProviderId(upload.media_id)||upload.method?.toUpperCase()!=='PUT'||upload.content_type!=='image/png')throw new Error('Reference upload response was invalid.');
          const response=await fetcher(await urlFor(upload.upload_url),{method:'PUT',body:new Uint8Array(files[index].data),headers:{'content-type':'image/png'},redirect:'error',signal:AbortSignal.timeout(30_000)});
          await response.body?.cancel();if(response.status!==200)throw new Error('A reference photo could not be uploaded.');
          medias.push({role:'image_references',value:upload.media_id});
        }
        const confirmed=await call('media_confirm',{type:'image',media_ids:medias.map(m=>m.value),...(job.settings?.workspaceId?{workspace_id:job.settings.workspaceId}:{})});
        // The contract calls these confirmed uploads; status is an open string, not an enum.
        if(confirmed.error||!Array.isArray(confirmed.results)||medias.some(m=>!confirmed.results.some((r:any)=>r.media_id===m.value&&typeof r.status==='string'&&!['failed','error','pending','uploading','cancelled','canceled'].includes(r.status.toLowerCase())&&(!r.type||r.type==='image'))))throw new Error('The reference photos were not confirmed.');
        const preferences=await call('get_preferences');
        if(preferences?.auto_create_project===true){
          if(!job.settings?.workspaceId)throw new Error('Select a Higgsfield workspace.');
          const destination=await beginGenerationProject(db,job,holder);
          if(destination.state==='waiting'){
            await update({state:'queued',errorCode:'project_wait',error:'Waiting for this conversation’s Higgsfield project.',nextPollAt:new Date(Date.now()+15_000).toISOString()});return 'project pending';
          }
          if(destination.state==='uncertain'){
            await update({state:'blocked',errorCode:'preflight',error:'The Higgsfield project could not be confirmed. Check Higgsfield Projects and reconcile the existing destination before retrying; no image was submitted.'});return 'project uncertain';
          }
          if(destination.state==='ready')params.folder_id=destination.folderId;
          else if(destination.state==='claimed'){
            try{
              const project=await call('create_project',{idempotency_key:destination.id,name:'AI Office artwork',workspace_id:job.settings.workspaceId});
              if(!validProviderId(project.default_folder_id)||!validProviderId(project.project_id))throw new Error('The Higgsfield project could not be prepared.');
              const saved=await commitGenerationProject(db,{jobId:job.id,holder,id:destination.id,token:destination.token,projectId:project.project_id,folderId:project.default_folder_id});
              params.folder_id=saved.folderId;
            }catch{
              await failGenerationProject(db,{jobId:job.id,holder,id:destination.id,token:destination.token,error:'The project creation outcome could not be confirmed.'}).catch(()=>{});
              await update({state:'blocked',errorCode:'preflight',error:'The Higgsfield project could not be confirmed. Check Higgsfield Projects and reconcile the existing destination before retrying; no image was submitted.'});return 'project uncertain';
            }
          }
        }
        Object.assign(params,{prompt:`${assets.packet.prompt}\n\nAttached images in exact input order:\n${files.map((file:any,index:number)=>`${index+1}. ${file.name}`).join('\n')}`,medias});
        quote=quoteCredits(await call('estimate_image_cost',{params}),params);balance=availableCredits(await call('balance'));
        if(balance<quote){await update({state:'blocked',errorCode:'credits',error:`This image needs about ${quote} Higgsfield credits; the account has ${balance}. No generation was submitted.`,usage:{credits:quote,balance}});return 'insufficient credits';}
        // Recheck the request after uploading references, immediately before the chargeable action.
        await artwork(job);
        if(await isPaused(true)){await update({state:'blocked',errorCode:'preflight',error:'AI Office was paused before image submission. No generation was requested.'});return 'paused';}
        await renewGenerationLease(db,{id:job.id,holder,expectedState:'submitting',leaseSeconds:600});
        dispatched=true;
        const result=await call('generate_image',{params},120_000);
        if(result?.error||result?.unlim_choice){await update({state:'failed',errorCode:'provider_rejected',error:'Higgsfield rejected the image request. Review the connection and inputs before creating a new revision.'});return 'rejected';}
        if(!Array.isArray(result?.results)||result.results.length!==1||!validProviderId(result.results[0].id))throw new Error('The generation receipt could not be verified.');
        await update({state:'submitted',providerRequestId:result.results[0].id,nextPollAt:new Date(Date.now()+10_000).toISOString(),usage:{credits:quote,costType:'estimate',model:job.model,quality:params.quality||null,resolution:params.resolution,...receiptQuality(result,params)}});
        catalogCache.clear();return 'submitted';
      }
      if(!job.provider_request_id)throw new Error('The saved generation is missing its provider job.');
      const result=await call('jobs_wait',{jobs:[{index:0,job_id:job.provider_request_id}],timeout_seconds:0});
      const item=result?.jobs?.find((j:any)=>j.job_id===job.provider_request_id);
      if(!item)throw new Error('The provider job could not be read.');
      if(['failed','canceled','nsfw','ip_detected'].includes(item.status)||(item.status==='lookup_failed'&&item.retryable===false)){
        await update({state:'failed',errorCode:'provider_failed',error:'Higgsfield could not finish this image. Its original job is preserved; no replacement was submitted.'});return 'failed';
      }
      if(item.status!=='completed'){
        await update({state,nextPollAt:new Date(Date.now()+Math.max(15,Math.min(Number(result.poll_after_seconds)||30,120))*1000).toISOString(),error:null,errorCode:null});return 'pending';
      }
      if(item.type&&item.type!=='image'){
        await update({state:'failed',errorCode:'invalid_output',error:'Higgsfield returned a different media type. The original job is preserved; no replacement was submitted.'});return 'failed';
      }
      if(state==='submitted')await update({state:'collecting'});
      const bundle=await artwork(job);
      const response=await fetcher(await urlFor(item.result_url),{redirect:'error',signal:AbortSignal.timeout(45_000),headers:{accept:'image/png,image/jpeg,image/webp'}});
      const {bytes,type}=await readImageResponse(response);
      let image;
      try{image=await validateArtwork(bytes,type);}catch{
        await update({state:'failed',errorCode:'invalid_output',error:'Higgsfield returned an incomplete or unsupported image. The original job is preserved; no replacement was submitted.'});return 'failed';
      }
      const path=`higgsfield-generations/${job.source}/${job.item_id}/${job.request_id}/${job.id}.${image.extension}`;
      const bucket=db.storage.from('creatives'),saved=await bucket.upload(path,bytes,{contentType:image.mimeType,upsert:false,cacheControl:'31536000'});
      if(saved.error){
        const existing=await bucket.download(path);
        if(existing.error||!existing.data||createHash('sha256').update(Buffer.from(await existing.data.arrayBuffer())).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw new Error('The completed image could not be saved.');
      }
      await completeGenerationJob(db,{id:job.id,holder,path,refIds:bundle.refs.map((r:any)=>r.id)});
      return 'succeeded';
    }catch(error:any){
      // After dispatch, even a lost response may mean a credit was spent. Never blindly repeat it.
      const possibleSubmission=dispatched||error?.code==='cost_submission_unexpected';
      if(state==='submitting')await update({state:possibleSubmission?'uncertain':'blocked',errorCode:possibleSubmission?'submission_unknown':'preflight',error:possibleSubmission?'The submission outcome is unknown. Check Higgsfield Assets before requesting another image; AI Office will not submit it again.':'Image preparation failed before submission. Check the connection and saved references, then retry this request.'}).catch(()=>{});
      else await update({state,nextPollAt:new Date(Date.now()+60_000).toISOString(),errorCode:'poll_retry',error:'The saved Higgsfield job is waiting for a status or download retry. No new generation will be submitted.'}).catch(()=>{});
      return possibleSubmission?'uncertain':'waiting';
    }
  };
}
const runGeneration=createGenerationWorker();
export async function drainHiggsfieldGenerations(db=supabaseAdmin(),limit=2) {
  if(await isPaused(true))return [];
  const jobs=await dueGenerationJobs(db,Math.max(1,Math.min(limit,3))),results=[];
  for(const job of jobs){if(await isPaused(true))break;results.push({id:job.id,result:await runGeneration(db,job)});}
  return results;
}
