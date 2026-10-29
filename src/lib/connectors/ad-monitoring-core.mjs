/** Closed reporting days in the provider account's timezone; never mix a partial today into a baseline. */
export function adReportingWindow(timezone, now=new Date()) {
  if(!timezone)throw new Error('The advertising account timezone is unavailable.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
  const today=Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  return {from:new Date(today-30*86400000).toISOString().slice(0,10),to:new Date(today-86400000).toISOString().slice(0,10)};
}
export function finiteMetric(value) {
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
}
const minorDigits={INR:2,USD:2,EUR:2,GBP:2,AUD:2,CAD:2,SGD:2,AED:2};
export function metaBudget(value,currency) {
  const n=finiteMetric(value);return n!==null&&Object.hasOwn(minorDigits,currency)?n/(10**minorDigits[currency]):null;
}
export function metaPurchase(list) {
  // Absence of the action is not evidence that purchase tracking exists or that stock/sales are zero.
  return Array.isArray(list)?finiteMetric(list.find(x=>x.action_type==='purchase')?.value):null;
}
export function googlePurchaseMap(actions, conversionRows) {
  const categories=new Map(actions.map(r=>[r.conversionAction?.resourceName,r.conversionAction?.category]));
  // A disabled or secondary action does not establish purchase reporting for
  // metrics.conversions. Missing zero-value segmented rows must stay unknown.
  let valid=actions.some(r=>r.conversionAction?.category==='PURCHASE'&&r.conversionAction?.status==='ENABLED'&&r.conversionAction?.primaryForGoal===true);
  const totals=new Map();
  for(const r of conversionRows) {
    const category=categories.get(r.segments?.conversionAction);
    if(!category){valid=false;continue;}
    if(category!=='PURCHASE')continue;
    const key=JSON.stringify([r.segments?.date,String(r.campaign?.id),String(r.adGroupAd?.ad?.id)]);
    const n=finiteMetric(r.metrics?.conversions),v=finiteMetric(r.metrics?.conversionsValue);
    if(n===null||v===null){valid=false;continue;}
    const current=totals.get(key)||{purchases:0,revenue:0};
    totals.set(key,{purchases:current.purchases+n,revenue:current.revenue+v});
  }
  return {valid,totals};
}
export function googleAdMetrics(base, actions, conversions, account, window, at) {
  const {valid,totals}=googlePurchaseMap(actions,conversions);
  return base.map(r=>{
    const key=JSON.stringify([r.segments.date,String(r.campaign.id),String(r.adGroupAd.ad.id)]);
    const purchase=valid?(totals.get(key)||{purchases:0,revenue:0}):{purchases:null,revenue:null};
    return {day:r.segments.date,platform:'google',account_id:account.id,campaign_id:String(r.campaign.id),campaign_name:r.campaign.name,
      ad_id:String(r.adGroupAd.ad.id),ad_name:r.adGroupAd.ad.name||null,spend:(finiteMetric(r.metrics.costMicros)??0)/1e6,
      impressions:finiteMetric(r.metrics.impressions)??0,clicks:finiteMetric(r.metrics.clicks)??0,...purchase,
      conversion_definition:valid?'purchase':'unknown',currency:account.currency,account_timezone:account.timezone,data_updated_at:at};
  }).filter(r=>r.day>=window.from&&r.day<=window.to);
}
/** Performance Max has campaign-level delivery, not ad-group-ad delivery. */
export function googlePerformanceMaxMetrics(rows,account,window,at){
 if(rows.some(r=>!r.segments?.date||!r.campaign?.id||finiteMetric(r.metrics?.costMicros)===null||finiteMetric(r.metrics?.impressions)===null||finiteMetric(r.metrics?.clicks)===null))throw new Error('Performance Max campaign metrics are incomplete.');
 return rows.map(r=>({day:r.segments?.date,platform:'google',account_id:account.id,campaign_id:String(r.campaign?.id),campaign_name:r.campaign?.name||null,
  ad_id:`pmax:${r.campaign?.id}`,ad_name:'Performance Max campaign',spend:finiteMetric(r.metrics?.costMicros)/1e6,
  impressions:finiteMetric(r.metrics?.impressions),clicks:finiteMetric(r.metrics?.clicks),purchases:null,revenue:null,
  conversion_definition:'unknown',currency:account.currency,account_timezone:account.timezone,data_updated_at:at}))
  .filter(r=>r.day>=window.from&&r.day<=window.to&&/^pmax:\d+$/.test(r.ad_id));
}
