import {measurementWindow} from './core.mjs';
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const key=(provider,account,campaign)=>JSON.stringify([provider,account,campaign]);
/** One bounded read of already imported facts; no provider or model calls. */
export async function readRecentCampaignActivity(db,campaigns,{now=new Date(),signal,pageSize=500,maxRows=30000}={}){
 const windows=new Map(),latest=new Map(),daily=new Map();
 for(const campaign of campaigns){const window=measurementWindow({windowDays:30,maturityHours:0},campaign.account_timezone,now);if(window)windows.set(key(campaign.provider,campaign.account_id,campaign.campaign_id),window);}
 const all=[...windows.values()],from=all.map(w=>w.from).sort()[0],to=all.map(w=>w.to).sort().at(-1);
 let complete=true,rowsRead=0;
 if(from&&to)for(let offset=0;;offset+=pageSize){
  const size=Math.min(pageSize,maxRows-offset+1);
  const result=await db.from('ad_insights_daily').select('platform,account_id,campaign_id,day,spend,impressions,clicks,purchases,revenue,conversion_definition,data_updated_at,currency,account_timezone').gte('day',from).lte('day',to)
   .not('account_id','is',null).order('day').order('platform').order('account_id').order('ad_id').range(offset,offset+size-1).abortSignal(signal);
  if(result.error){complete=false;break;}
  const rows=result.data||[];
  for(const row of rows){if(rowsRead>=maxRows){complete=false;break;}rowsRead++;
   const id=key(row.platform,row.account_id,row.campaign_id),window=windows.get(id);
   if(!window||typeof row.day!=='string'||row.day<window.from||row.day>window.to)continue;
   const delivery=['spend','impressions','clicks'].some(k=>finite(row[k])>0);
   if(delivery&&(!latest.has(id)||latest.get(id)<row.day))latest.set(id,row.day);
   if(!daily.has(id))daily.set(id,new Map());const dates=daily.get(id);
   const values=Object.fromEntries(['spend','impressions','clicks','purchases','revenue'].map(k=>[k,finite(row[k])]));
   const refresh=Date.parse(row.data_updated_at||''),validRefresh=Number.isFinite(refresh);
   const next={day:row.day,...values,rowCount:1,delivered:delivery,purchaseKnown:row.conversion_definition==='purchase'&&values.purchases!==null&&values.revenue!==null,currency:typeof row.currency==='string'&&row.currency?row.currency:null,timezoneKnown:row.account_timezone===window.timezone,allRefreshed:validRefresh,oldestRefresh:validRefresh?new Date(refresh).toISOString():null};
   const old=dates.get(row.day);if(old){for(const k of Object.keys(values))next[k]=old[k]===null||next[k]===null?null:old[k]+next[k];next.rowCount+=old.rowCount;next.delivered=next.delivered||old.delivered;next.purchaseKnown=next.purchaseKnown&&old.purchaseKnown;next.currency=next.currency===old.currency?next.currency:null;next.timezoneKnown=next.timezoneKnown&&old.timezoneKnown;next.allRefreshed=next.allRefreshed&&old.allRefreshed;next.oldestRefresh=next.oldestRefresh&&old.oldestRefresh?[next.oldestRefresh,old.oldestRefresh].sort()[0]:null;}dates.set(row.day,next);
  }
  if(!complete||rows.length<size)break;
 }
 return {complete,rowsRead,forCampaign:campaign=>{const id=key(campaign.provider,campaign.account_id,campaign.campaign_id);return {complete:complete&&windows.has(id),window:windows.get(id)||null,lastDeliveryAt:latest.get(id)||null,days:[...(daily.get(id)?.values()||[])].sort((a,b)=>a.day.localeCompare(b.day))};}};
}
