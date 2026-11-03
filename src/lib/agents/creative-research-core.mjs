const clean = value => String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500);
const decode = value => String(value || '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const plain = value => clean(decode(String(value || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ')));

export function searchResultLinks(html) {
  const results=[];
  const anchors=[...String(html || '').matchAll(/<a\b([^>]*\bclass=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>/gi)];
  for(let i=0;i<anchors.length;i++) {
    const href=anchors[i][1].match(/\bhref=['"]([^'"]+)['"]/i)?.[1];
    if(!href)continue;
    try {
      const link=new URL(decode(href),'https://lite.duckduckgo.com');
      const url=link.hostname.endsWith('duckduckgo.com')?new URL(link.searchParams.get('uddg')||''):link;
      if(url.protocol!=='https:' || url.username || url.password || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname))continue;
      const until=anchors[i+1]?.index || String(html).length;
      const snippet=String(html).slice((anchors[i].index||0)+anchors[i][0].length,until).match(/<td\b[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i)?.[1];
      const title=plain(anchors[i][2]);
      if(title)results.push({title,url:url.toString(),snippet:plain(snippet)});
    } catch { /* Ignore malformed search links. */ }
  }
  return results.slice(0,10);
}

export function creativeResearchResult(response, observedAt) {
  const candidate = response?.candidates?.[0];
  const body = (candidate?.content?.parts || []).map(part => part.text || '').join('\n');
  let parsed;
  try { parsed = JSON.parse(body.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); } catch { return null; }
  const chunks = candidate?.groundingMetadata?.groundingChunks || [];
  const sources = chunks.map(chunk => ({ title: clean(chunk?.web?.title), url: String(chunk?.web?.uri || '') }))
    .filter(source => /^https:\/\//i.test(source.url)).slice(0, 8);
  if (!sources.length || !parsed || typeof parsed !== 'object') return null;
  const direction = {
    layout: clean(parsed.layout), palette: clean(parsed.palette), typography: clean(parsed.typography),
    imagery: clean(parsed.imagery), customerHook: clean(parsed.customerHook),
  };
  if (!direction.layout || !direction.palette || !direction.typography) return null;
  return { observedAt, direction, sources };
}

export function creativeResearchBrief(research) {
  if (!research) return '';
  const { direction: d } = research;
  return `Current visual research (${research.observedAt}): layout ${d.layout}; palette ${d.palette}; typography ${d.typography}; imagery ${d.imagery}; customer hook ${d.customerHook}. Inspiration sources: ${research.sources.map(s => s.url).join(', ')}. Treat web and Pinterest pages only as visual inspiration; never copy their product, wording, claims, logo or offers.`;
}
