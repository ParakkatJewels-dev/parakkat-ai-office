const DEPARTMENT_CUES = {
  creative: /\b(?:poster|carousel|carsoul|banner|artwork|ad creative|visual design|creative direction|headline|caption|image|graphic)\b/i,
  catalog: /\b(?:catalogue|catalog|print|brochure|product page|product description)\b/i,
  insights: /\b(?:sales|revenue|best[ -]?sell|top[ -]?sell|shopify order|analytics|attribution|ga4)\b/i,
  strategy: /\b(?:campaign strateg|product selection|audience plan|positioning|go.to.market)\b/i,
  perf: /\b(?:meta ads|google ads|roas|ad spend|paid campaign|conversion|cpc|cpa|budget pacing)\b/i,
  social: /\b(?:instagram|facebook post|social media|community|content calendar)\b/i,
  seo: /\b(?:seo|search ranking|keyword|organic traffic|search console)\b/i,
  intel: /\b(?:competitor|market intelligence|industry news)\b/i,
  warroom: /\b(?:competitor ad|ad library|competitor price)\b/i,
  customer: /\b(?:customer insight|reviews|ratings|shopper research)\b/i,
  crm: /\b(?:crm|email|customer segment|repeat buyer|retention)\b/i,
  datahub: /\b(?:sync|connection|integration|data quality|missing data|bad gateway|server|login)\b/i,
  qa: /\b(?:compliance|quality review|hallmark|policy check|audit claim)\b/i,
  photo: /\b(?:product photo|photo edit|background artist|model shot)\b/i,
  reels: /\b(?:reel|video|script for video)\b/i,
  brand: /\b(?:brand voice|moodboard|brand identity|visual trend)\b/i,
  forecast: /\b(?:forecast|demand forecast|replenishment)\b/i,
  goldrate: /\b(?:gold rate|silver rate|festival date|auspicious)\b/i,
};
const imageAction = /\b(?:create|make|generate|design|produce|redesign|revise|redo|edit)\b[\s\S]{0,100}\b(?:images?|posters?|carousels?|carsouls?|banners?|artwork|visuals?|ad creatives?|product designs?)\b|\b(?:images?|posters?|carousels?|carsouls?|banners?|artwork|product designs?)\b[\s\S]{0,100}\b(?:create|make|generate|design|produce|redesign|revise|redo|edit)\b/i;
const question = /^\s*(?:what|why|how|when|where|which|who|explain|show me|tell me|can you tell me|help me understand|is there|are there)\b|\?\s*$/i;

export function taskIntakeKind(message, requested = 'auto') {
  if (requested === 'chat') return 'conversation';
  if (requested === 'work') return imageAction.test(message) ? 'image' : 'head_task';
  if (imageAction.test(message)) return 'image';
  return question.test(message) ? 'conversation' : 'head_task';
}

export function taskIntakeHead(message, heads, preferredId) {
  if(preferredId && heads.some(head=>head.id===preferredId))return preferredId;
  const scored=heads.map(head=>({head,score:(DEPARTMENT_CUES[head.department_id]?.test(message)?10:0)
    +(new RegExp(`\\b${String(head.name||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(message)?20:0)}));
  scored.sort((a,b)=>b.score-a.score);
  if(scored[0]?.score>0 && scored[0].score> (scored[1]?.score||0))return scored[0].head.id;
  return null;
}

export function taskIntakeFallback(heads, role) {
  const preferred={super_admin:'cmo',creative_head:'creativeDirector',ecom_manager:'analyticsLead',perf_marketer:'perfLead'}[role];
  return heads.find(head=>head.id===preferred)?.id || heads[0]?.id || null;
}
