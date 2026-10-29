import {randomUUID} from 'node:crypto';
export const OUTCOME_CADENCE_SECONDS=300;
/** Reserve before checking persisted cadence, so concurrent ticks cannot sweep twice. */
export async function withOutcomeMonitoringLease(db,sweep,{force=false,now=()=>new Date()}={}){
 const holder=randomUUID(),lock=await db.rpc('acquire_job_lock',{p_name:'outcome_monitoring',p_holder:holder,p_seconds:120});
 if(lock.error)throw new Error('Could not reserve outcome monitoring.');
 if(!lock.data)return {busy:true,modelCalls:0};
 try{
  const signal=AbortSignal.timeout(110000),at=now();
  const read=await db.from('outcome_scan_state').select('monitor_after,last_attempt_at,last_refreshed_at').eq('singleton',true).abortSignal(signal).single();
  if(read.error||!read.data)throw new Error('Could not read monitoring cadence.');
  const previous=Date.parse(read.data.last_attempt_at||read.data.last_refreshed_at||'');
  if(!force&&Number.isFinite(previous)&&at.getTime()-previous<OUTCOME_CADENCE_SECONDS*1000)
   return {skipped:'cooldown',nextReviewAt:new Date(previous+OUTCOME_CADENCE_SECONDS*1000).toISOString(),modelCalls:0};
  // Persist the start too: a failed sweep must not retry every minute indefinitely.
  const stamp=await db.from('outcome_scan_state').update({last_attempt_at:at.toISOString()}).eq('singleton',true).abortSignal(signal);
  if(stamp.error)throw new Error('Could not save monitoring cadence.');
  return await sweep({scan:read.data,signal,now:at});
 }finally{await db.rpc('release_job_lock',{p_name:'outcome_monitoring',p_holder:holder});}
}
