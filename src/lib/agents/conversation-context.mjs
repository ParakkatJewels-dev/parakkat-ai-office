import { requestedSalesCategory } from './conversation-sales.mjs';
const words=text=>new Set(String(text||'').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]);
export function conversationEvidenceKeys(request) {
  const text=String(request||'').toLowerCase(),keys=new Set(['sync']);
  if(requestedSalesCategory(text)) {
    keys.add('categorySales30d');
    if(!/\b(?:compare|against|forecast|replenish|performance|roas|spend)\b/.test(text))return [...keys];
  }
  if(/stock|inventory|forecast|demand|sales|sell|sold|replenish|month|revenue|units|profit|performance|product|sku|price|catalog/.test(text)) {
    keys.add('products');keys.add('productSales7d');
    if(/forecast|demand|month|30.day|trend|replenish/.test(text))keys.add('productSales30d');
  }
  if(/sales|revenue|performance|ad[s\s]|campaign|budget|spend|roas|profit|report/.test(text))keys.add('performance');
  if(/campaign|plan|approval|budget/.test(text))keys.add('campaigns');
  if(/social|instagram|facebook|post|reel|engagement/.test(text))keys.add('social');
  if(/seo|keyword|search|trend/.test(text))keys.add('search');
  if(/competitor|rival|market/.test(text))keys.add('competitors');
  if(/copy|headline|caption|banner|design|wedding|collection|jewel/.test(text))keys.add('products');
  // Unknown/non-English requests keep a compact general context; do not pretend omitted data is missing.
  if(keys.size===1&&!/working|doing|status|attention|hello|thanks|thank you/.test(text))for(const k of ['performance','products','productSales7d'])keys.add(k);
  return [...keys];
}
function compactValue(value,limit=900,depth=0) {
  if(typeof value==='string')return value.slice(0,limit);
  if(depth>6)return null;
  if(Array.isArray(value))return value.slice(0,8).map(v=>compactValue(v,limit,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,compactValue(v,limit,depth+1)]));
  return value;
}
export function compactConversationEvidence(shared,request,phase='plan') {
  const result={},needed=conversationEvidenceKeys(request),tokens=words(request);
  // A general creative request needs enough catalogue context to avoid inventing a
  // product, not a large unrelated sample on every planning and review turn.
  const namedProduct=/\b(?:product|sku|ring|necklace|earring|bracelet|bangle|pendant|stock|inventory|catalog|collection|top.sell|best.sell)\b/i.test(request);
  for(const key of needed) {
    if(!shared[key])continue;
    const source=shared[key];
    if(Array.isArray(source.data)) {
      const focused=key==='categorySales30d';
      const cap=focused?10:key==='products'&&!namedProduct?3:phase==='plan'?8:5;
      const ranked=source.data.map((row,index)=>({row,index,score:[...words(`${row.title||row.product||''} ${row.product_id||row.id||''}`)].filter(w=>tokens.has(w)).length})).sort((a,b)=>focused?a.index-b.index:b.score-a.score||a.index-b.index);
      const rows=ranked.slice(0,cap).map(x=>compactValue(x.row,650));
      result[key]={...compactValue(source,900),data:rows,sample:{...source.sample,sourceOrder:source.sample?.order,order:focused?source.sample?.order:'Request relevance, then original source order',shown:rows.length,limit:cap,truncated:!!source.sample?.truncated||source.data.length>cap,note:focused?source.sample?.note:'Task-relevant bounded sample. Omitted records are unknown, not zero.'}};
    } else result[key]=compactValue(source,900);
  }
  return {...result,contextCoverage:'Only task-relevant recorded sources and bounded rows are included. The brand book is supplied in the agent instructions. Ask for a focused follow-up when more evidence is needed.'};
}
export function conversationColleagues(agents,request,hostId) {
  const tokens=words(request);
  return agents.filter(a=>a.id!==hostId).map((a,index)=>({a,index,score:[...words(`${a.name} ${a.role_desc} ${a.department_id}`)].filter(w=>tokens.has(w)).length*5+(a.is_lead?1:0)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,10).map(({a})=>({agentId:a.id,name:a.name,role:String(a.role_desc||'').slice(0,120),department:a.department_id}));
}
const followup = value => /^(?:(?:please\s+)?(?:try again|retry(?: this)?|continue|finish it|same task|do it|go ahead)[.!?\s]*$|(?:please\s+)?(?:make|keep|change|revise|rewrite|improve|expand|shorten|simplify|polish|update|adapt|translate)\s+(?:it|this|that|these|those|the\s+(?:answer|draft|copy|report|response|plan|headlines?|captions?))\b|(?:please\s+)?(?:more|less)\s+(?:premium|detailed|formal|concise|specific)\b|(?:please\s+)?(?:add|remove|include|exclude)\s+.+\b(?:it|this|that|draft|answer|response|report)\b)/i.test(String(value||'').trim());
const statusPrompt = value => /^(?:what(?:'s| is|s) the status|status(?: update)?|hello|thanks|thank you)[.!?\s]*$/i.test(String(value||'').trim());
function priorTaskMessages(prompt,history) {
  if(!followup(prompt))return [];
  const previous=(history||[]).slice(-16).filter(m=>m.role==='user'&&String(m.content||'').trim()!==String(prompt||'').trim()&&!statusPrompt(m.content));
  const selected=[];
  for(let i=previous.length-1;i>=0;i--){
    selected.unshift(previous[i]);
    if(!followup(previous[i].content))break;
  }
  return selected;
}
function excerpt(content,limit) {
  const text=String(content||'');
  if(text.length<=limit)return {content:text};
  const marker='\n[Middle omitted from earlier message]\n';
  const room=Math.max(0,limit-marker.length),head=Math.ceil(room/2),tail=Math.floor(room/2);
  return {content:`${text.slice(0,head)}${marker}${tail?text.slice(-tail):''}`,contextOmission:{originalChars:text.length,omittedChars:text.length-room,location:'middle'}};
}
export function compactConversationHistory(history,currentPrompt,_phase='final') {
  const eligible=(history||[]).slice(-16).filter(m=>!(m.role==='user'&&m.content===currentPrompt));
  const wanted=new Set([...eligible.slice(-4),...priorTaskMessages(currentPrompt,history)]);
  const selected=eligible.filter(m=>wanted.has(m));
  // Keep current requirements ahead of older prose. A long prior draft gets an
  // explicit middle omission rather than silently losing its conclusion.
  const limits=selected.map(m=>Math.min(String(m.content||'').length,500));
  let remaining=10000-limits.reduce((sum,n)=>sum+n,0);
  const order=[...selected.map((m,i)=>m.role==='user'?i:-1).filter(i=>i>=0),...selected.map((m,i)=>m.role!=='user'?i:-1).filter(i=>i>=0).reverse()];
  for(const i of order){const extra=Math.min(remaining,Math.max(0,Math.min(String(selected[i].content||'').length,6000)-limits[i]));limits[i]+=extra;remaining-=extra;}
  return selected.map((m,i)=>({role:m.role,agent_id:m.agent_id,...excerpt(m.content,limits[i])}));
}
/** Retries and edits keep the substantive manager task and intervening requirements as their evidence scope. */
export function conversationRetryContext(prompt,history) {
  const previous=priorTaskMessages(prompt,history).map(m=>String(m.content||'').trim()).filter(Boolean);
  return previous.length?excerpt(previous.join('\nFollow-up requirement: '),6000).content:null;
}
export function needsConversationWorkHistory(request) {
  const text=String(request||'');
  return /\b(?:working|doing|attention)\b|\b(?:your|agent|task|work)\s+(?:current\s+)?status\b|\b(?:your|latest|recent|last|previous)\s+(?:(?:completed|saved|recorded)\s+)?(?:work|task|report|activity|output)s?\b/i.test(text)
    || /^\s*(?:status(?:\s+update)?|(?:show|list)\s+(?:me\s+)?(?:my|your)\s+(?:reports|tasks|activity|work))\s*[?.!]*\s*$/i.test(text);
}
export function compactDiscussion(messages,{phase,meetingRequested,assignment}={}) {
  let items=messages||[];
  // A direct handoff is already supplied in the assignment field. Keep all
  // actual colleague replies and meeting turns, including repeated wording.
  if(phase==='specialist'&&!meetingRequested&&assignment&&items.at(-1)?.content===assignment)items=items.slice(0,-1);
  // The coordinator already bounds each saved contribution to 6,000 characters
  // and at most two specialists. The final reviewer needs their whole work,
  // including qualifications and deliverables at the end of each contribution.
  return items.slice(-4).map(m=>({...m,...excerpt(m.content,6000)}));
}
