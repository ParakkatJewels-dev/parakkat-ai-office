export const TEMPLATES = [
  {kind:'head_task',label:'Assign to an AI head',description:'Give a department head a task. The head delegates, reviews the returned work and forwards approved output to the human head.',departmentId:'board',ownerAgent:'cmo',scheduled:false},
  {kind:'briefing',label:'Daily management briefing',description:'Sales, stock, advertising and decisions in one evidence-backed brief.',departmentId:'board',ownerAgent:'cmo',scheduled:true},
  {kind:'campaign',label:'Campaign production',description:'Turn one brief into a product plan, copy, artwork and an approval package.',departmentId:'creative',ownerAgent:'creativeDirector',scheduled:false},
  {kind:'inventory',label:'Inventory planning',description:'Find stock risks and prepare replenishment or branch-transfer proposals.',departmentId:'forecast',ownerAgent:'forecaster',scheduled:true},
  {kind:'customer',label:'Customer enquiries',description:'Prepare grounded replies and track enquiries and follow-ups.',departmentId:'crm',ownerAgent:'crmLead',scheduled:false},
  {kind:'catalogue',label:'Catalogue maintenance',description:'Check product quality and prepare reviewed descriptions and SEO copy.',departmentId:'catalog',ownerAgent:'catalogLead',scheduled:true},
  {kind:'advertising',label:'Advertising improvements',description:'Review recorded results and prepare replacement creative briefs.',departmentId:'perf',ownerAgent:'perfLead',scheduled:true},
  {kind:'data_quality',label:'Data quality',description:'Check freshness, incomplete imports, unread files and missing product data.',departmentId:'datahub',ownerAgent:'dataLead',scheduled:true},
  {kind:'follow_up',label:'Follow-up task',description:'Ask an agent to prepare a draft or analysis, with a deadline and completion evidence.',departmentId:'board',ownerAgent:'cmo',scheduled:false},
];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** APP_URL is trusted server configuration; proxy-supplied host headers never add origins. */
export function workflowOriginAllowed(origin,requestUrl,appUrl) {
  if(typeof origin!=='string'||!origin||origin==='null')return false;
  const allowed=[];
  for(const value of [requestUrl,appUrl])try{const parsed=new URL(value);if(['http:','https:'].includes(parsed.protocol))allowed.push(parsed.origin);}catch{}
  return allowed.includes(origin);
}
export function templateFor(kind) { return TEMPLATES.find(row=>row.kind===kind); }
export function canManageDepartment(role, departmentId, departments) {
  return role==='super_admin' || (role!=='viewer' && departments.some(row=>row.id===departmentId && row.human_head_role===role));
}
export function textInput(value, max, required=false) {
  if (typeof value!=='string') { if(required)throw new Error('Enter the required text.');return ''; }
  const text=value.trim();
  if((required&&!text)||[...text].length>max)throw new Error(`Enter ${required?'1–':''}${max} characters or fewer.`);
  return text;
}
export function scheduleSlot(schedule, now=new Date()) {
  if(!schedule.enabled)return null;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const hour=Number(p.hour), start=Number(schedule.local_hour), cadence=Number(schedule.cadence_hours);
  if(hour<start||!Number.isInteger(cadence)||cadence<6||cadence>168)return null;
  const last=Date.parse(schedule.last_queued_at||'');
  if(Number.isFinite(last)&&now.getTime()-last<cadence*3600000)return null;
  return `${p.year}-${p.month}-${p.day}:${Math.floor((hour-start)/Math.min(cadence,24))}`;
}
export function validOutcome(value) {
  if(!value || !['review','completed','blocked','queued'].includes(value.status))throw new Error('The workflow did not return a valid result.');
  if(typeof value.summary!=='string'||!value.summary.trim()||typeof value.markdown!=='string')throw new Error('The workflow result is incomplete.');
  if(!Array.isArray(value.evidence)||!Array.isArray(value.warnings))throw new Error('The workflow did not record its evidence.');
  // A model is never permitted to select executable tools. Each handler supplies allowlisted actions itself.
  const actions=(value.actions||[]).filter(a=>a&&['create_campaign','catalogue_copy','follow_up','inquiry_reply'].includes(a.kind)&&typeof a.label==='string'&&a.payload&&typeof a.payload==='object').slice(0,8);
  return {...value,summary:value.summary.slice(0,800),markdown:value.markdown.slice(0,40000),warnings:value.warnings.map(String).slice(0,30),evidence:value.evidence.slice(0,80),actions};
}
export function mayTransition(status, action) {
  const allowed={retry:['failed','blocked'],cancel:['queued','running','blocked','review','failed'],accept:['review'],complete:['blocked']};
  return (allowed[action]||[]).includes(status);
}
