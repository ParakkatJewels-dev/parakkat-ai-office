import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { geminiJSON, type Part } from '@/lib/llm/gemini';
import { geminiConfigured } from '@/lib/llm/gemini-config';
import { checkPause, Paused } from '@/lib/pause';
import { errText } from '@/lib/errors';
import { withUsage } from '@/lib/usage';
import { designImageById, listChildren } from '@/lib/connectors/drive';
import { isDesignFile, searchWords, referenceFingerprint, designReferenceQueries, rankDesignReferences, type DesignReferenceSelection } from './library-core.mjs';
import { changedDesigns, discoverLibrary, libraryAbortable, libraryDescription, libraryRetryAt, libraryStudyBlock, LIBRARY_LIMITS, sameLibraryRevision } from './library-scan-core.mjs';
import { emit } from './events';
import { withAgentWork } from './agent-work';
import { isChatGPTHandoff } from '@/lib/artwork-mode.mjs';

export type Ref = { id:string;name:string;drive_id?:string;modified_at?:string|null;image_path:string|null;fingerprint:Record<string, unknown>|null;occasion:string|null;style:string|null;palette:string|null;layout:string|null;typography:string|null;kind:string|null };
type Folder={id:string;root_id:string;name:string;page_token:string|null;scanned_at:string|null;files:number};
type Claim={id:string;driveId:string;modifiedAt:string|null};
type Progress={version:2;state:'reading'|'studying'|'idle'|'blocked'|'failed'|'queued';holder:string;startedAt:string;lastFinishedAt?:string;lastResult:string;activeFolderName:string|null;
  claims:Claim[];studyBlock?:{code:string;reason:string;at:string}|null;folderRetries:Record<string,{attempts:number;retryAfter:string}>;counts:{pages:number;foldersRead:number;discovered:number;studied:number;waiting:number;failed:number;pendingFolders:number}};
type Options={discoverOnly?:boolean;trigger?:'manual'|'scheduled';studyLimit?:number};
const LOCK='design_library';
const problem=(message:string)=>new Error(`Design library: ${message}`);
const due=()=>`scanned_at.is.null,page_token.not.is.null,error.not.is.null,scanned_at.lt.${new Date(Date.now()-24*36e5).toISOString()}`;
function checked<T extends {error:unknown}>(result:T,message:string):T {if(result.error)throw problem(message);return result;}

function guard(db:SupabaseClient,holder:string,deadline:AbortSignal) {
  const signal=(ms=8000)=>AbortSignal.any([deadline,AbortSignal.timeout(ms)]);
  const check=async(pause=true)=>{
    deadline.throwIfAborted();if(pause)await libraryAbortable(checkPause(),signal());
    const lease=checked(await db.from('job_locks').select('holder').eq('name',LOCK).eq('holder',holder)
      .gt('until',new Date(Date.now()+8000).toISOString()).abortSignal(signal()).maybeSingle(),'could not verify the scan lease.');
    if(!lease.data)throw problem('the scan lease ended; progress is preserved for the next run.');deadline.throwIfAborted();
  };
  return {check,signal};
}

async function recoverClaims(db:SupabaseClient,claims:Claim[],check:()=>Promise<void>,signal:()=>AbortSignal) {
  for(const claim of claims) {
    await check();
    let query=db.from('design_refs').update({status:'failed',error:'The previous study was interrupted. Its provider outcome is unknown; use the explicit retry control to try again.'})
      .eq('id',claim.id).eq('drive_id',claim.driveId).eq('status','new');
    query=claim.modifiedAt?query.eq('modified_at',claim.modifiedAt):query.is('modified_at',null);
    checked(await query.abortSignal(signal()),'could not preserve the interrupted study.');
  }
}

/** Manual action: continue unfinished discovery; only restart completed trees. Failed studies retry only by this explicit action. */
export async function resetLibraryScan(db:SupabaseClient):Promise<{busy:boolean;summary:string}> {
  const holder=randomUUID(),deadline=AbortSignal.timeout(20_000),{check,signal}=guard(db,holder,deadline);
  const lock=checked(await db.rpc('acquire_job_lock',{p_name:LOCK,p_holder:holder,p_seconds:30}).abortSignal(signal()),'could not reserve the library.');
  if(!lock.data)return {busy:true,summary:'The library is already running. Its folder progress is being preserved.'};
  try {
    await check();
    const [cursor,pending,unfinished]=await Promise.all([
      db.from('sync_cursors').select('state').eq('name',LOCK).abortSignal(signal()).maybeSingle(),
      db.from('design_library_folders').select('id',{count:'exact',head:true}).or('scanned_at.is.null,page_token.not.is.null,error.not.is.null').abortSignal(signal()),
      db.from('design_refs').select('id',{count:'exact',head:true}).in('status',['new','failed']).abortSignal(signal()),
    ]);
    checked(cursor,'could not read scan progress.');checked(pending,'could not check unfinished folders.');checked(unfinished,'could not check unfinished studies.');
    await recoverClaims(db,Array.isArray(cursor.data?.state?.claims)?cursor.data.state.claims:[],check,signal);await check();
    if(cursor.data?.state?.version!==2)checked(await db.from('design_library_folders').update({page_token:null,scanned_at:null,files:0}).not('page_token','is',null).abortSignal(signal()),'could not reset legacy incremental-query cursors.');
    if(pending.count||unfinished.count)checked(await db.from('design_library_folders').update({scanned_at:null,error:null}).not('error','is',null).abortSignal(signal()),'could not queue failed folders.');
    else checked(await db.from('design_library_folders').update({scanned_at:null,page_token:null,files:0,error:null}).not('id','is',null).abortSignal(signal()),'could not queue the full rescan.');
    checked(await db.from('design_refs').update({status:'new',error:null}).eq('status','failed').abortSignal(signal()),'could not queue the requested retries.');
    const summary=pending.count||unfinished.count?'Queued a continuation of unfinished folders/studies and an explicit retry of failed designs.':'Queued a full folder inventory and an explicit retry of failed designs. Unchanged completed designs will not be studied again.';
    await check();
    checked(await db.from('sync_cursors').upsert({name:LOCK,updated_at:new Date().toISOString(),state:{...(cursor.data?.state||{}),version:2,state:'queued',holder:null,activeFolderName:null,claims:[],studyBlock:null,folderRetries:{},lastResult:summary}}).abortSignal(signal()),'could not save the queued scan.');
    checked(await db.from('autopilot_jobs').upsert({name:'library',last_run_at:null,last_result:summary}).abortSignal(signal()),'could not queue the background job.');
    return {busy:false,summary};
  } finally {await db.rpc('release_job_lock',{p_name:LOCK,p_holder:holder}).abortSignal(AbortSignal.timeout(3000));}
}

/** Discovery uses Drive metadata only; study is independently capped at twelve images and four concurrent calls. */
export async function scanLibrary(db:SupabaseClient,options:Options={}):Promise<string> {
  const handoff = isChatGPTHandoff();
  const discoverOnly = options.discoverOnly || handoff;
  const holder=randomUUID(),deadline=AbortSignal.timeout(LIBRARY_LIMITS.workMs),{check,signal}=guard(db,holder,deadline);
  const lock=checked(await db.rpc('acquire_job_lock',{p_name:LOCK,p_holder:holder,p_seconds:LIBRARY_LIMITS.leaseSeconds}).abortSignal(signal()),'could not reserve the library.');
  if(!lock.data)return 'The library is already running; no duplicate scan or image study was started.';
  let startedAt:string|null=null,previousJobAt:string|null=null,state:Progress|null=null,paused=false,outcome='';
  const save=async(pause=true)=>{
    await check(pause);
    const result=checked(await db.from('sync_cursors').update({state,updated_at:new Date().toISOString()}).eq('name',LOCK).eq('state->>holder',holder).select('name').abortSignal(signal()).maybeSingle(),'could not save scan progress.');
    if(!result.data)throw problem('another run owns the saved scan progress.');
  };
  try {
    const previous=checked(await db.from('autopilot_jobs').select('last_run_at').eq('name','library').abortSignal(signal()).maybeSingle(),'could not read the library schedule.');
    previousJobAt=previous.data?.last_run_at||null;
    if((options.trigger||'scheduled')==='scheduled'&&previousJobAt&&Date.now()-Date.parse(previousJobAt)<LIBRARY_LIMITS.scheduleMs)return 'The next scheduled library pass is not due yet.';
    await check();
    const cursor=checked(await db.from('sync_cursors').select('state').eq('name',LOCK).abortSignal(signal()).maybeSingle(),'could not read the saved scan.');
    await recoverClaims(db,Array.isArray(cursor.data?.state?.claims)?cursor.data.state.claims:[],check,signal);
    if(cursor.data?.state?.version!==2) {
      await check();
      checked(await db.from('design_library_folders').update({page_token:null,scanned_at:null,files:0}).not('page_token','is',null).abortSignal(signal()),'could not reset legacy incremental-query cursors.');
    }
    const begin=new Date().toISOString();
    state={version:2,state:'reading',holder,startedAt:begin,lastFinishedAt:cursor.data?.state?.lastFinishedAt,lastResult:'Discovering eligible designs and subfolders.',activeFolderName:null,claims:[],studyBlock:cursor.data?.state?.studyBlock||null,folderRetries:cursor.data?.state?.folderRetries||{},
      counts:{pages:0,foldersRead:0,discovered:0,studied:0,waiting:0,failed:0,pendingFolders:0}};
    await check();
    checked(await db.from('sync_cursors').upsert({name:LOCK,state,updated_at:begin}).abortSignal(signal()),'could not record scan ownership.');
    checked(await db.from('autopilot_jobs').upsert({name:'library',last_run_at:begin,last_result:'running'}).abortSignal(signal()),'could not record the library start.');startedAt=begin;
    const discoveryDeadline=AbortSignal.any([deadline,AbortSignal.timeout(LIBRARY_LIMITS.discoveryMs)]);
    const discovery=await withAgentWork({agentId:'designer',kind:'library_scan',timeoutMs:LIBRARY_LIMITS.discoveryMs,signal:discoveryDeadline},()=>discoverLibrary<Folder>({check,shouldStop:()=>discoveryDeadline.aborted,
      nextFolder:async excluded=>{
        const skip=new Set([...excluded,...Object.entries(state!.folderRetries).filter(([,r])=>Date.parse(r.retryAfter)>Date.now()).map(([id])=>id)]);
        let query=db.from('design_library_folders').select('id,root_id,name,page_token,scanned_at,files').or(due()).order('scanned_at',{ascending:true,nullsFirst:true}).order('created_at').order('id').limit(1);
        if(skip.size)query=query.not('id','in',`(${[...skip].filter(id=>/^[A-Za-z0-9_-]+$/.test(id)).join(',')})`);
        return checked(await query.abortSignal(signal()).maybeSingle(),'could not read pending folders.').data as Folder|null;
      },
      list:async folder=>{state!.activeFolderName=folder.name;await save();return listChildren(folder.id,folder.page_token,discoveryDeadline);},
      savePage:async(folder,page)=>{
        const subs=page.files.filter(f=>f.mimeType==='application/vnd.google-apps.folder'),designs=page.files.filter(f=>isDesignFile(f.mimeType));
        await check();
        if(subs.length)checked(await db.from('design_library_folders').upsert(subs.map(f=>({id:f.id,root_id:folder.root_id,name:`${folder.name} / ${f.name}`})),{onConflict:'id',ignoreDuplicates:true}).abortSignal(signal()),'could not save discovered subfolders.');
        let found=0;
        if(designs.length) {
          const rows=designs.map(f=>({drive_id:f.id,folder_id:folder.id,name:f.name,mime:f.mimeType,modified_at:f.modifiedTime||null}));
          const known=checked(await db.from('design_refs').select('drive_id,modified_at').in('drive_id',rows.map(r=>r.drive_id)).abortSignal(signal()),'could not check existing design revisions.');
          const changes=changedDesigns(rows,known.data||[]);await check();
          if(changes.fresh.length)checked(await db.from('design_refs').upsert(changes.fresh,{onConflict:'drive_id',ignoreDuplicates:true}).abortSignal(signal()),'could not save discovered designs.');
          for(const row of changes.changed){await check();checked(await db.from('design_refs').update({...row,status:'new',error:null}).eq('drive_id',row.drive_id).abortSignal(signal()),'could not save a changed revision.');}
          found=changes.fresh.length+changes.changed.length;
        }
        await check();
        checked(await db.from('design_library_folders').update({page_token:page.next,error:null,files:(folder.page_token?folder.files:0)+designs.length,...(page.next?{}:{scanned_at:new Date().toISOString()})}).eq('id',folder.id).abortSignal(signal()),'could not commit the folder page.');
        delete state!.folderRetries[folder.id];state!.counts.pages++;state!.counts.discovered+=found;if(!page.next)state!.counts.foldersRead++;await save();
        return {found};
      },
      failFolder:async(folder,error,reset)=>{
        await check();
        checked(await db.from('design_library_folders').update({error:errText(error).slice(0,300),...(reset?{page_token:null,files:0}:{})}).eq('id',folder.id).abortSignal(signal()),'could not record the folder failure.');
        const attempts=(state!.folderRetries[folder.id]?.attempts||0)+1;state!.folderRetries[folder.id]={attempts,retryAfter:libraryRetryAt(attempts)};
        state!.lastResult=`Folder remains unfinished: ${folder.name}. ${errText(error).slice(0,180)}`;await save();
      },
    }));
    state.activeFolderName=null;let studyBlocked=handoff?'':state.studyBlock?.reason||'';
    if(handoff)state.studyBlock=null;
    if(!discoverOnly&&!studyBlocked) {
      const agent=checked(await db.from('agents').select('enabled').eq('id','designer').abortSignal(signal()).maybeSingle(),'could not check whether the Banner Designer is enabled.');
      if(!agent.data?.enabled)studyBlocked='The Banner Designer is disabled; discovered designs remain queued.';
      else if(!await libraryAbortable(geminiConfigured(),signal()))studyBlocked='Add a Gemini key in Settings → AI providers to study the queued designs.';
      else await studyNew(db,state,Math.min(LIBRARY_LIMITS.study,Math.max(0,Math.trunc(options.studyLimit??LIBRARY_LIMITS.study))),deadline,check,signal,save);
      studyBlocked=state.studyBlock?.reason||studyBlocked;
    }
    const [waiting,failed,pending]=await Promise.all([
      db.from('design_refs').select('id',{count:'exact',head:true}).eq('status','new').abortSignal(signal()),
      db.from('design_refs').select('id',{count:'exact',head:true}).eq('status','failed').abortSignal(signal()),
      db.from('design_library_folders').select('id',{count:'exact',head:true}).or(due()).abortSignal(signal()),
    ]);
    checked(waiting,'could not count waiting designs.');checked(failed,'could not count failed designs.');checked(pending,'could not check unfinished folders.');
    state.counts.waiting=waiting.count||0;state.counts.failed=failed.count||0;state.counts.pendingFolders=pending.count||0;
    outcome=`${state.counts.pages} folder pages read; ${state.counts.discovered} new or changed designs recorded; ${state.counts.studied} studied. ${state.counts.pendingFolders} folders unfinished; ${state.counts.waiting} designs waiting; ${state.counts.failed} need an explicit retry.${discovery.failures?` ${discovery.failures} folder reads failed and retain their checkpoints.`:''}${studyBlocked?` ${studyBlocked}`:''}${discoverOnly?' Discovery only; no image analysis was requested.':''}${handoff?' Manual artwork mode uses saved references; Gemini study is disabled.':''}`;
    state.state=studyBlocked&&state.counts.waiting?'blocked':state.counts.pendingFolders||state.counts.waiting?'queued':state.counts.failed?'failed':'idle';state.lastResult=outcome;state.lastFinishedAt=new Date().toISOString();await save();
    if(state.counts.studied)await libraryAbortable(emit(db,null,'say','designer',`Studied ${state.counts.studied} past Parakkat designs from Drive; ${state.counts.waiting} waiting, ${state.counts.failed} need an explicit retry.`),signal());
    return outcome;
  } catch(error) {
    paused=error instanceof Paused;outcome=paused?'Agents are paused; the library will resume from its saved checkpoints.':`failed: ${deadline.aborted?'The bounded library pass ended; unfinished work and image claims remain saved.':errText(error)}`;
    if(state){state.state=paused?'blocked':'failed';state.lastResult=outcome;state.activeFolderName=null;state.lastFinishedAt=new Date().toISOString();if(!deadline.aborted)await save(false).catch(()=>{});}
    return outcome;
  } finally {
    if(startedAt){const result=await db.from('autopilot_jobs').update({last_run_at:paused||options.discoverOnly?previousJobAt:new Date().toISOString(),last_result:outcome.slice(0,500)}).eq('name','library').eq('last_run_at',startedAt).abortSignal(AbortSignal.timeout(3000));if(result.error)console.error('Design library outcome could not be saved.');}
    await db.rpc('release_job_lock',{p_name:LOCK,p_holder:holder}).abortSignal(AbortSignal.timeout(3000));
  }
}

async function studyNew(db:SupabaseClient,state:Progress,limit:number,deadline:AbortSignal,check:()=>Promise<void>,signal:(ms?:number)=>AbortSignal,save:()=>Promise<void>) {
  if(!limit)return;
  const todo=checked(await db.from('design_refs').select('id,drive_id,name,mime,modified_at').eq('status','new').order('created_at').order('id').limit(limit).abortSignal(signal()),'could not read waiting designs.');
  state.state='studying';
  for(let i=0;i<(todo.data||[]).length;i+=LIBRARY_LIMITS.concurrency) {
    if(state.studyBlock)break;
    await check();state.claims=todo.data!.slice(i,i+LIBRARY_LIMITS.concurrency).map(r=>({id:r.id,driveId:r.drive_id,modifiedAt:r.modified_at||null}));await save();
    const results=await Promise.allSettled(state.claims.map(async claim=>{
      const step=AbortSignal.any([deadline,AbortSignal.timeout(LIBRARY_LIMITS.imageMs)]);
      const current=async()=>{await check();const row=checked(await db.from('design_refs').select('drive_id,modified_at,status').eq('id',claim.id).abortSignal(signal()).maybeSingle(),'could not verify the design revision.');return sameLibraryRevision(row.data,claim);};
      const finish=async(values:Record<string,unknown>)=>{
        if(!await current())return false;
        let query=db.from('design_refs').update(values).eq('id',claim.id).eq('drive_id',claim.driveId).eq('status','new');query=claim.modifiedAt?query.eq('modified_at',claim.modifiedAt):query.is('modified_at',null);
        return !!checked(await query.select('id').abortSignal(signal()).maybeSingle(),'could not save the design study.').data;
      };
      const clearOldPreview=async()=>{
        const old=checked(await db.from('design_refs').select('image_path').eq('id',claim.id).abortSignal(signal()).maybeSingle(),'could not check the old preview.').data?.image_path;
        if(old){if(!old.startsWith('library/'))throw problem('an unexpected preview path cannot be cleared automatically.');checked(await db.storage.from('creatives').remove([old]),'could not clear the old preview.');}
      };
      try {
        if(!await current())return;
        const img=await libraryAbortable(designImageById(claim.driveId,step,claim.modifiedAt),step);await check();step.throwIfAborted();if(state.studyBlock)return;
        const d=libraryDescription(await libraryAbortable(withUsage({feature:'library',agent:'designer'},()=>geminiJSON<unknown>(`Study the brand's past work so new designs can match its construction without retaining this image in AI Office storage. Describe this image as a designer would brief another.
keep is false if it is not a finished marketing design (a raw product photo, screenshot, logo file or document page).
kind is post, story, banner, poster or other. occasion is the festival, season or theme, or general. quality is 1 to 5.
Shape: {"keep":true,"kind":"post","occasion":"general","style":"two sentences on mood, background, props, lighting and jewellery treatment","palette":"main colours","layout":"positions of product, headline, logo and space","typography":"type style and treatment","tags":["five to eight short words"],"quality":3,"fingerprint":{"visualBrief":"what makes this visual recognizable","composition":"placement, scale, depth, crop and negative space","palette":"specific colours and contrast","lighting":"light sources, direction and shadows","materials":"background surfaces, props and textures","typography":"font character, hierarchy and alignment","productionNotes":"step-by-step description of how to recreate this art direction with a different product","avoid":"what must not be copied literally, including jewellery and text"}}`,
          [{inlineData:{mimeType:img.mimeType,data:img.data.toString('base64')}}],{db,id:'designer',signal:step})),step));
        step.throwIfAborted();if(!d.keep){await clearOldPreview();await finish({status:'skipped',error:'Not a finished design',kind:d.kind,image_path:null,fingerprint:null});return;}
        if(!await current())return;
        await clearOldPreview();
        if(await finish({status:'ready',error:null,image_path:null,fingerprint:d.fingerprint,kind:d.kind,occasion:d.occasion,style:d.style,palette:d.palette,layout:d.layout,typography:d.typography,tags:d.tags,quality:d.quality}))state.counts.studied++;
      } catch(error) {if(error instanceof Paused||deadline.aborted)throw error;const block=libraryStudyBlock(error);if(block){state.studyBlock=block;return;}await finish({status:'failed',error:errText(error).slice(0,300)});}
    }));
    const rejected=results.find(r=>r.status==='rejected');if(rejected?.status==='rejected')throw rejected.reason;state.claims=[];await save();
  }
}

/**
 * Rank source metadata deterministically. For the usual library, inspect every
 * ready reference; larger libraries add indexed subject/direction candidates.
 */
export async function pickRefs(db: SupabaseClient, words: string[], n = 3, previousIds: string[] = [], options: DesignReferenceSelection = {}): Promise<Ref[]> {
  const columns='id,name,drive_id,modified_at,image_path,fingerprint,occasion,style,palette,layout,typography,kind,tags,quality,pinned,last_used_at';
  const query=()=>db.from('design_refs').select(columns,{count:'exact'}).eq('status','ready').eq('hidden',false).not('fingerprint','is',null);
  const first=await query().order('id').limit(500);
  if(first.error||!Array.isArray(first.data))throw problem('reference selection could not be read. No unreferenced image was requested.');
  const candidates=new Map(first.data.map((ref:any)=>[ref.id,ref]));
  if((first.count??first.data.length)>500||first.data.length===500){
    const extra=await Promise.all(designReferenceQueries(words,options).map(search=>query().textSearch('search',search,{config:'simple',type:'websearch'}).order('quality',{ascending:false,nullsFirst:false}).order('id').limit(150)));
    for(const result of extra){if(result.error||!Array.isArray(result.data))throw problem('targeted reference selection could not be read. No unreferenced image was requested.');for(const ref of result.data)candidates.set(ref.id,ref);}
  }
  const refs=rankDesignReferences([...candidates.values()] as Ref[],words,{...options,previousIds,limit:n});
  if(!refs.length)return [];
  await db.rpc('mark_design_refs_used', { p_ids: refs.map(r => r.id) }).then(() => null, () => null);
  return refs;
}

/** Read selected originals transiently; imported image bytes are never saved to AI Office storage. */
export async function refParts(_db: SupabaseClient, refs: Ref[], options: {signal?:AbortSignal} = {}): Promise<{ ref: Ref; part: Part; parts: Part[] }[]> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000);
  signal.throwIfAborted();
  await checkPause();
  const selected: Ref[] = [], seen = new Set<string>();
  for (const ref of refs) {
    if (!ref.drive_id || !/^[A-Za-z0-9_-]+$/.test(ref.drive_id) || !ref.modified_at || !Number.isFinite(Date.parse(ref.modified_at)))
      throw problem('a selected reference has no verified Drive source revision. Rescan its library folder before generating.');
    const key = `${ref.drive_id}:${Date.parse(ref.modified_at)}`;
    if (seen.has(key)) continue;
    seen.add(key); selected.push(ref);
    if (selected.length === 3) break;
  }
  return Promise.all(selected.map(async (ref,index) => {
    try {
      const original = await designImageById(ref.drive_id!, signal, ref.modified_at);
      signal.throwIfAborted();
      // The bounded preview retains visual construction, unlike a text summary.
      // JPEG keeps several style/product references within inline request size.
      const bytes = await sharp(original.data, {limitInputPixels:40_000_000}).rotate()
        .resize(1536, 1536, {fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'})
        .jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer();
      signal.throwIfAborted();
      const part: Part = {inlineData:{mimeType:'image/jpeg',data:bytes.toString('base64')}};
      const fingerprint: Part = {text:`${index===0?'PRIMARY STYLE REFERENCE':'SUPPORTING FINISH REFERENCE'}: past Parakkat design “${ref.name}”${ref.occasion ? ` (${ref.occasion})` : ''}. The next image is the actual selected source design, read only for this request. ${index===0?'Use its visual construction as the main direction unless the manager asks otherwise.':'Use its craftsmanship and finish only; do not blend a conflicting palette or scene into the primary direction.'} Never copy its jewellery, words, claims or offer badges. Saved notes: ${referenceFingerprint(ref)}`};
      return {ref,part,parts:[fingerprint,part]};
    } catch (error) {
      signal.throwIfAborted();
      throw problem(`the original image for “${ref.name}” could not be verified or read. Check Drive access and rescan the reference before generating. No text-only substitute was used.`);
    }
  }));
}
