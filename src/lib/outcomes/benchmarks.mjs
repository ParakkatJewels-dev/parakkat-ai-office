import {measurementWindow} from './core.mjs';
const shift=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*864e5).toISOString().slice(0,10);
const settings={metric:'roas',direction:'higher',minSample:10,sampleMetric:'purchases',windowDays:14,maturityHours:48,maxDataAgeHours:48};
/** A reviewable descriptive baseline, never a profit goal, statistical claim or write. */
export function recommendCampaignBenchmark(campaign,coverage,activity,now=new Date()){
 const reasons=[],warnings=['The proposed target matches recent weighted provider-attributed ROAS; no uplift, profit or causal improvement is implied.','Seven delivery days and ten purchases per comparison window are operational safeguards, not statistical confidence.','Review margins, returns, stock and fulfilment before treating this baseline as a commercial goal. No spend or campaign change is authorized.'];
 const result={available:false,kind:'match_recent_observation',metric:'roas',direction:'higher',target:null,settings:null,baseline:null,recent:null,previous:null,confidence:'descriptive_data_only',requiresHumanReview:true,reasons,warnings};
 const recent=measurementWindow(settings,campaign.account_timezone,now);
 if(!recent){reasons.push('A valid provider timezone is required for comparable windows.');return result;}
 const previous={from:shift(recent.from,-14),to:shift(recent.from,-1),timezone:recent.timezone};
 const fresh=value=>{const t=Date.parse(value||'');return Number.isFinite(t)&&now.getTime()-t<=48*3600000&&t-now.getTime()<=300000;};
 if(campaign.selected!==true||campaign.details?.metrics_supported===false)reasons.push('This campaign is outside supported selected measurement coverage.');
 if(!activity?.complete||!coverage?.selected||!coverage.complete||coverage.status!=='complete'||coverage.coverage?.metrics_complete!==true)reasons.push('A complete imported activity window and account snapshot are required.');
 if(!fresh(coverage?.last_success_at))reasons.push('The last complete provider snapshot must be no older than 48 hours.');
 if(!campaign.currency)reasons.push('A known account currency is required.');
 if(!(coverage?.coverage?.window_from<=previous.from)||!(coverage?.coverage?.window_to>=recent.to)||!(activity?.window?.from<=previous.from)||!(activity?.window?.to>=recent.to))reasons.push('The imported dates do not cover both complete mature 14-day windows.');
 const summarize=period=>{
  const days=(activity?.days||[]).filter(d=>d.day>=period.from&&d.day<=period.to);
  const known=days.length>0&&days.every(d=>d.purchaseKnown===true&&d.currency===campaign.currency&&d.timezoneKnown===true&&d.allRefreshed===true&&fresh(d.oldestRefresh)&&['spend','revenue','purchases'].every(k=>typeof d[k]==='number'&&Number.isFinite(d[k])&&d[k]>=0));
  const sum=k=>{if(!known)return null;const value=days.reduce((n,d)=>n+d[k],0);return Number.isFinite(value)&&value>=0?value:null;};
  const spend=sum('spend'),revenue=sum('revenue'),purchases=sum('purchases'),deliveryDays=days.filter(d=>d.delivered).length;
  const totalsKnown=known&&spend!==null&&revenue!==null&&purchases!==null,ratio=totalsKnown&&spend>0?revenue/spend:null;
  return {from:period.from,to:period.to,value:ratio!==null&&Number.isFinite(ratio)?ratio:null,spend,revenue,purchases,deliveryDays,known:totalsKnown};
 };
 result.recent=summarize(recent);result.previous=summarize(previous);
 if(!result.recent.known||!result.previous.known)reasons.push('Every included sales row must have fresh, purchase-only values in the same known currency and reporting timezone. Unknown conversions are not zero.');
 if(result.recent.deliveryDays<7||result.previous.deliveryDays<7)reasons.push('Both windows need at least seven recorded delivery days for this operational comparison.');
 if(result.recent.purchases===null||result.previous.purchases===null||result.recent.purchases<10||result.previous.purchases<10)reasons.push('Both windows need at least ten verified purchases for this operational comparison.');
 if(result.recent.value===null||result.previous.value===null)reasons.push('Positive recorded spend and a finite weighted ROAS are required in both windows.');
 if(reasons.length)return result;
 result.available=true;result.target=result.recent.value;result.settings={...settings,target:result.target};
 result.baseline={value:result.target,at:`${recent.to}T00:00:00Z`,source:`Provider-attributed ratio of summed revenue to summed spend; ${recent.from} to ${recent.to} (${recent.timezone}). Prior window ${previous.from} to ${previous.to}. Descriptive baseline only.`};
 return result;
}
