import { requestedSalesCategory } from './conversation-sales.mjs';
import { shopifyPhotoUrl } from './carousel-url.mjs';

export function requestedPosterCount(request) {
  const text = String(request || '');
  const quantity = '(?:[1-5]|one|two|three|four|five)';
  const nearPoster = text.match(new RegExp(`\\b(${quantity})\\s+(?:separate\\s+|individual\\s+)?(?:portrait\\s+|ad\\s+)?posters?\\b`, 'i'));
  const nearRanking = text.match(new RegExp(`\\b(?:top|best[ -]?selling)\\s+(${quantity})\\b|\\b(${quantity})\\s+top[ -]?selling\\b`, 'i'));
  const value = (nearPoster?.[1] || nearRanking?.[1] || nearRanking?.[2] || 'one').toLowerCase();
  return {one:1,two:2,three:3,four:4,five:5}[value] || Number(value);
}

export function requestedPosterProductCount(request) {
  const match = String(request || '').match(/\b(?:top|best[ -]?selling)\s+([1-5]|one|two|three|four|five)\b|\b([1-5]|one|two|three|four|five)\s+top[ -]?selling\b/i);
  if (!match) return 1;
  const value = (match[1] || match[2]).toLowerCase();
  return {one:1,two:2,three:3,four:4,five:5}[value] || Number(value);
}

export function carouselIntent(request) {
  const text = String(request || '');
  if (/\b(?:do not|don't|without)\s+(?:generate|create|make|produce|design)(?:ing)?\b/i.test(text) || /\b(?:draft|brief) only\b/i.test(text)) return null;
  if (!/\b(?:generate|create|make|produce|design)\b/i.test(text) || !/\b(?:carousel|carrousel|carsoule|posters?)\b/i.test(text)) return null;
  if (requestedPosterCount(text) !== 1 && !/\b(?:five[ -]?card|5[ -]?card|five\s+posters?|5\s+posters?)\b/i.test(text)) return null;
  return requestedSalesCategory(text);
}

/** Individual posters are separate jobs from a five-card category carousel. */
export function salesPosterIntent(request) {
  const text = String(request || '');
  if (/\b(?:do not|don't|without)\s+(?:generate|create|make|produce|design)(?:ing)?\b/i.test(text) || /\b(?:draft|brief) only\b/i.test(text)) return null;
  if (!/\b(?:generate|create|make|produce|design)\b/i.test(text) || !/\b(?:posters?|ad creative|advertising image|ad image|banner)\b/i.test(text)) return null;
  const count = requestedPosterCount(text);
  if (/\b(?:five[ -]?card|5[ -]?card)\b/i.test(text) || (count === 1 && /\b(?:carousel|carrousel|carsoule)\b/i.test(text))) return null;
  if (!/\b(?:(?:top|best|most|highest)[\s-]+(?:selling|seller|sold)|best[\s-]?seller|sales[\s-]+leader)\b/i.test(text)) return null;
  return { category: requestedSalesCategory(text), format: /\b(?:print(?:ed|able)?|in.store|in shop|store poster)\b/i.test(text) ? 'poster' : 'portrait', count, productCount: requestedPosterProductCount(text), cohesiveSeries: /\b(?:carousel|carrousel|carsoule|carsoul|same (?:format|layout|design)|matching (?:cards|posters))\b/i.test(text) };
}

/** A direct product artwork order must identify catalogue rows before any image is queued. */
export function productArtworkIntent(request) {
  const text=String(request||'');
  if (/\b(?:do not|don't|without)\s+(?:generate|create|make|produce|design)(?:ing)?\b/i.test(text) || /\b(?:draft|brief) only\b/i.test(text))return null;
  if(!/\b(?:generate|create|make|produce|design)\b/i.test(text)||!/\b(?:posters?|banners?|images?|artwork|carousel|carsoul|product designs?)\b/i.test(text))return null;
  const quantity=text.match(/\b([1-5]|one|two|three|four|five)\s+(?:(?:matching|separate|individual|product|portrait|ad)\s+){0,3}(?:designs?|images?|banners?|posters?|carousel\s+cards?)\b/i);
  const quantityValue=quantity?.[1]?.toLowerCase();
  const count=quantityValue?({one:1,two:2,three:3,four:4,five:5}[quantityValue]||Number(quantityValue)):requestedPosterCount(text);
  const ids=[...text.matchAll(/\b(?:shopify\s+)?product(?:\s+id)?\s*[:#-]?\s*(\d{1,18})\b|gid:\/\/shopify\/Product\/(\d{1,18})/gi)]
    .map(match=>Number(match[1]||match[2])).filter(Number.isSafeInteger);
  const handles=[...text.matchAll(/https?:\/\/[^\s/]+\/products\/([a-z0-9-]+)/gi)].map(match=>match[1]);
  return {format:/\b(?:print(?:ed|able)?|in.store|store poster)\b/i.test(text)?'poster':/\b(?:website|web\s+banner)\b/i.test(text)?'web_banner':'portrait',count:Math.min(5,Math.max(1,count)),cohesiveSeries:/\b(?:carousel|carsoul|same\s+(?:format|layout|design)|matching\s+(?:cards|posters))\b/i.test(text),ids:[...new Set(ids)],handles:[...new Set(handles)]};
}

export function carouselRedesignIntent(request) {
  const text = String(request || '');
  return /\b(?:redesign|rework|revise|redo|change|new version)\b/i.test(text)
    && /\b(?:carousel|carrousel|carsoule|five[ -]?card|5[ -]?card|all five cards|all 5 cards)\b/i.test(text);
}

export function carouselIdFromConversation(request, history = []) {
  const content = [String(request || ''), ...(history || []).slice(-12).reverse().map(row => String(row.content || ''))];
  for (const text of content) {
    const match = text.match(/(?:\/studio\?carousel=|\bcarousel(?:\s+id)?\s*[:#]?\s*)([0-9a-f]{8}-[0-9a-f-]{27})\b/i);
    if (match && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(match[1])) return match[1];
  }
  return null;
}

export function carouselSelection(evidence) {
  if (!evidence?.available || !evidence?.sample?.top_rank_complete || !Array.isArray(evidence.data))
    throw new Error('A complete category sales ranking is needed before making a carousel.');
  const selected = evidence.data.filter(row =>
    /^active$/i.test(String(row.status || '')) && Number(row.stock) > 0 &&
    Number(row.units) > 0 && /^\d+$/.test(String(row.product_id || '')) && shopifyPhotoUrl(row.image_url)
  ).slice(0, 5);
  if (selected.length < 5) throw new Error(`Only ${selected.length} eligible products with positive preferred stock and official Shopify images were found in the recorded ranking.`);
  return selected;
}
