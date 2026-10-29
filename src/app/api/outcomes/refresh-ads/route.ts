import { randomUUID } from 'node:crypto';
import { workflowOriginAllowed } from '@/lib/automation/core.mjs';
import { syncAdInsights } from '@/lib/connectors/meta';
import { syncGoogleAds } from '@/lib/connectors/google';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { outcomeSession, refreshOutcomeMonitoring } from '@/lib/outcomes/service';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

/** A human-requested, provider-read-only import. It shares the normal sync lock. */
export async function POST(req:Request){
 if(!workflowOriginAllowed(req.headers.get('origin'),req.url,process.env.APP_URL))return Response.json({error:'The request must come from AI Office.'},{status:403});
 try{await outcomeSession();}catch{return Response.json({error:'Sign in with Outcomes access to refresh ads.'},{status:403});}
 const db=supabaseAdmin(),holder=randomUUID();
 const lock=await db.rpc('acquire_job_lock',{p_name:'sync',p_holder:holder,p_seconds:300});
 if(lock.error)return Response.json({error:'Could not reserve the ad refresh. Try again later.'},{status:503});
 if(!lock.data)return Response.json({error:'A data sync is already running. Try again when it finishes.'},{status:409});
 try{
  const last=await db.from('sync_cursors').select('state').eq('name','outcomes_ad_refresh').maybeSingle();
  if(last.error)throw new Error('Could not check the last ad refresh.');
  const previous=Date.parse(last.data?.state?.at||'');
  if(Number.isFinite(previous)&&Date.now()-previous<10*60_000)return Response.json({error:'Ad results were refreshed recently. Check again in ten minutes.'},{status:429});
  const at=new Date().toISOString();
  const saved=await db.from('sync_cursors').upsert({name:'outcomes_ad_refresh',state:{at},updated_at:at});
  if(saved.error)throw new Error('Could not record the ad refresh.');
  const results:Record<string,string>={};
  for(const [provider,run] of [['Meta',syncAdInsights],['Google Ads',syncGoogleAds]] as const){
   try{const result=await run(db,Date.now()+90_000);results[provider]=`${result.count} ad-day rows imported${result.failed.length?`; ${result.failed.length} account(s) unavailable`:''}`;}
   catch{results[provider]='Could not refresh this provider; its previous saved data remains.';}
  }
  let monitoring:Awaited<ReturnType<typeof refreshOutcomeMonitoring>>|null=null;
  for(let attempt=0;attempt<10;attempt++){
   monitoring=await refreshOutcomeMonitoring(db,{force:true});
   if('checked' in monitoring)break;
   if(attempt<9)await new Promise(resolve=>setTimeout(resolve,3000));
  }
  const checked=monitoring&&'checked' in monitoring?monitoring.checked:0;
  return Response.json({ok:true,results,checked,reviewPending:checked===0},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'The ad refresh could not finish. Previous saved results remain available.'},{status:503});}
 finally{await db.rpc('release_job_lock',{p_name:'sync',p_holder:holder});}
}
