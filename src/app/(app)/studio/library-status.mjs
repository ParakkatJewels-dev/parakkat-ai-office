const clean = (value,max=500) => typeof value==='string'?value.replace(/\u0000/g,'').replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/((?:access_token|refresh_token|api_key|client_secret)["']?\s*[=:]\s*["']?)[^\s&"']+/gi,'$1[redacted]').slice(0,max):null;
const time = value => typeof value==='string'?Date.parse(value):NaN;
export const LIBRARY_HEARTBEAT_MS=270_000;

/** Only this small projection can cross to the page: no lease owner, claims, credentials or retry internals. */
export function projectLibraryRuntime({cursor,lease,paused,designerEnabled,geminiConfigured,readError=false},now=Date.now()) {
  const state=cursor?.state || {},updated=time(cursor?.updated_at),until=time(lease?.until);
  const owned=typeof state.holder==='string' && !!state.holder && state.holder===lease?.holder;
  const active=owned && until>now && updated<=now+30_000 && now-updated<=LIBRARY_HEARTBEAT_MS && ['reading','studying'].includes(state.state);
  return {active,stage:['reading','studying','idle','blocked','failed','queued'].includes(state.state)?state.state:null,
    activeFolderName:active?clean(state.activeFolderName,250):null,startedAt:clean(state.startedAt,40),updatedAt:clean(cursor?.updated_at,40),
    lastFinishedAt:clean(state.lastFinishedAt,40),lastResult:clean(state.lastResult),paused,designerEnabled,geminiConfigured,readError};
}

/** Queued work is not evidence that a worker is running. Counts are independently queried, not guessed from text. */
export function libraryDisplayState(runtime,{pendingFolders,waiting,failed,folderErrors,readError=false}) {
  const queue=`${pendingFolders ?? 'Unknown number of'} folder${pendingFolders===1?'':'s'} waiting to be read; ${waiting ?? 'unknown number of'} design${waiting===1?'':'s'} waiting to be studied.`;
  const result=(state,label,message,active=false,poll=false)=>({state,label,message,active,poll});
  if(runtime.readError || readError)return result('unknown','Status unavailable','The latest library progress could not be read. Refresh to try again.');
  if(runtime.paused)return result('paused','Paused',`${queue} The agents are paused. The Super Admin can resume them in Admin.`);
  if(runtime.active)return result(runtime.stage,runtime.stage==='reading'?'Reading folders':'Studying designs',`${runtime.stage==='reading'?'A library worker is reading'+(runtime.activeFolderName?` ${runtime.activeFolderName}`:' a Drive folder'):'The Banner Designer is studying indexed designs'}. ${queue}`,true,true);
  const backlog=(pendingFolders || 0)>0 || (waiting || 0)>0;
  if((waiting || 0)>0 && runtime.designerEnabled===false)return result('blocked','Study blocked',`${queue} The Banner Designer is disabled. Enable the agent before studying designs.`);
  if((waiting || 0)>0 && runtime.geminiConfigured===false)return result('blocked','Study blocked',`${queue} Add a Gemini key in Settings → AI providers before studying designs.`);
  if((folderErrors || 0)>0 || (failed || 0)>0 || ['blocked','failed'].includes(runtime.stage))return result('attention','Needs attention',`${queue} ${failed || 0} design${failed===1?'':'s'} failed and ${folderErrors || 0} folder${folderErrors===1?'':'s'} reported an error. Review the details and resume the scan when the issue is resolved.`,false,backlog && runtime.stage!=='blocked');
  if(backlog)return result('queued','Queued',`${queue} No active library worker is confirmed. Continue now with Resume scan, or wait for the next scheduled pass.`,false,true);
  return result('idle','No queued work','No unfinished folders or designs are currently queued. New or changed files are checked on later scans.');
}

export async function readLibraryFolderPages(readPage,pageSize=1000) {
  const rows=[];
  for(let offset=0;offset<100_000;offset+=pageSize) {
    const result=await readPage(offset,offset+pageSize-1);
    if(result.error || !Array.isArray(result.data))return {rows,complete:false};
    rows.push(...result.data);
    if(result.data.length<pageSize)return {rows,complete:true};
  }
  return {rows,complete:false};
}
export const safeLibraryNote = value => clean(value);
