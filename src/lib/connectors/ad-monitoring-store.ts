import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function storeAdSnapshot(db:SupabaseClient,provider:'meta'|'google',accountId:string,campaigns:any[],metrics:any[],coverage:Record<string,any>) {
  const stable=(rows:any[])=>rows.map(row=>Object.fromEntries(Object.keys(row).sort().filter(k=>!['last_seen_at','data_updated_at'].includes(k)).map(k=>[k,row[k]]))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const fingerprint=createHash('sha256').update(JSON.stringify([stable(campaigns),stable(metrics),coverage.window_from,coverage.window_to,coverage.inventory_complete,coverage.metrics_complete])).digest('hex');
  const result=await db.rpc('store_campaign_account_snapshot',{p_provider:provider,p_account_id:accountId,p_campaigns:campaigns,p_metrics:metrics,p_coverage:{...coverage,fingerprint}});
  if(result.error)throw new Error('The complete advertising snapshot could not be saved. Previous evidence is retained.');
}
export async function recordAdReadFailure(db:SupabaseClient,provider:'meta'|'google',accountId:string) {
  await storeAdSnapshot(db,provider,accountId,[],[],{selected:true,status:'failed',last_attempt_at:new Date().toISOString(),inventory_complete:false,metrics_complete:false,complete:false,error_code:'provider_read_failed',safe_message:'The account could not be fully read. Previous data is retained and must not be treated as current.',coverage:{inventory:false,metrics:false}});
}
export async function deselectAdAccounts(db:SupabaseClient,provider:'meta'|'google',ids:string[]) {
  // IDs come from the saved connector selection; avoid interpolating arbitrary identifiers into filters.
  if(ids.some(id=>!/^\d+$/.test(id)))throw new Error('An advertising account identifier is invalid.');
  for(const table of ['campaign_registry','campaign_sync_coverage']) {
    let query=db.from(table).update({selected:false}).eq('provider',provider).eq('selected',true);
    if(ids.length)query=query.not('account_id','in',`(${ids.join(',')})`);
    const result=await query;if(result.error)throw new Error('Could not update advertising account coverage.');
  }
}
