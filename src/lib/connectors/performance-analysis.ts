import 'server-only';

type Metric = { name:string; value:number; unit:string; source:string; definition:string };
type Insight = { finding:string; source:string };
type Snapshot = { observedAt:string; from:string; to:string; currency:string; metrics:Metric[]; insights:Insight[] };
export type PerformanceEvidence = {status:'not_configured'|'fresh'|'stale'|'unavailable'; brief:string; observedAt?:string};

const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):'';
const date=(value:unknown)=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
  const parsed=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:'';
};
const safeURL=(value:string)=>{
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!!u.hostname&&!/^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname)?u:null;}
  catch{return null;}
};

/** Canonical read-only adapter. Provider-specific response mapping can be added when its API contract arrives. */
export function normalizePerformanceSnapshot(raw:unknown):Snapshot|null {
  const x=raw as Record<string,unknown>|null;
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const observedAt=clean(x.observedAt,40),from=date(x.from),to=date(x.to),currency=clean(x.currency,8);
  if(!Number.isFinite(Date.parse(observedAt))||!from||!to||from>to||!['INR','USD'].includes(currency))return null;
  if(!Array.isArray(x.metrics)||x.metrics.length>40||!Array.isArray(x.insights)||x.insights.length>30)return null;
  const metrics:Metric[]=[],insights:Insight[]=[];
  for(const value of x.metrics) {
    const row=value as Record<string,unknown>;
    const name=clean(row?.name,80),unit=clean(row?.unit,30),source=clean(row?.source,120),definition=clean(row?.definition,240);
    if(!name||!unit||!source||!definition||typeof row.value!=='number'||!Number.isFinite(row.value))return null;
    metrics.push({name,value:row.value,unit,source,definition});
  }
  for(const value of x.insights) {
    const row=value as Record<string,unknown>,finding=clean(row?.finding,400),source=clean(row?.source,120);
    if(!finding||!source)return null;
    insights.push({finding,source});
  }
  return {observedAt,from,to,currency,metrics,insights};
}

export async function performanceEvidence():Promise<PerformanceEvidence> {
  const endpoint=process.env.PERFORMANCE_ANALYSIS_URL,key=process.env.PERFORMANCE_ANALYSIS_API_KEY;
  if(!endpoint||!key)return {status:'not_configured',brief:''};
  const url=safeURL(endpoint);
  if(!url||key.length<16)return {status:'unavailable',brief:'The external performance analysis connection is misconfigured; its figures were not used.'};
  try {
    const response=await fetch(url,{method:'GET',headers:{authorization:`Bearer ${key}`,accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12_000)});
    if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('application/json'))throw new Error('unavailable');
    const length=Number(response.headers.get('content-length')||0);
    if(length>1_000_000)throw new Error('oversized');
    const body=await response.text();if(body.length>1_000_000)throw new Error('oversized');
    const snapshot=normalizePerformanceSnapshot(JSON.parse(body));if(!snapshot)throw new Error('invalid schema');
    const age=Date.now()-Date.parse(snapshot.observedAt),fresh=age>=0&&age<=36*60*60_000;
    const lines=[`External performance analysis observed ${snapshot.observedAt}; window ${snapshot.from} to ${snapshot.to}; currency ${snapshot.currency}.`,
      ...snapshot.metrics.slice(0,15).map(m=>`${m.name}: ${m.value} ${m.unit} (${m.source}; definition: ${m.definition})`),
      ...snapshot.insights.slice(0,8).map(i=>`Finding: ${i.finding} (source: ${i.source})`)];
    return {status:fresh?'fresh':'stale',observedAt:snapshot.observedAt,brief:fresh?lines.join('\n'):'External performance analysis is stale; its figures were not used.'};
  }catch{return {status:'unavailable',brief:'External performance analysis could not be verified; its figures were not used.'};}
}
