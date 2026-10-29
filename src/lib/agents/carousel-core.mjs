import { requestedSalesCategory } from './conversation-sales.mjs';
import { shopifyPhotoUrl } from './carousel-url.mjs';

export function carouselIntent(request) {
  const text = String(request || '');
  if (/\b(?:do not|don't|without)\s+(?:generate|create|make|produce|design)(?:ing)?\b/i.test(text) || /\b(?:draft|brief) only\b/i.test(text)) return null;
  if (!/\b(?:generate|create|make|produce|design)\b/i.test(text) || !/\b(?:carousel|carrousel|carsoule|poster)\b/i.test(text)) return null;
  return requestedSalesCategory(text);
}

/** A single ad poster is a different job from the five-card category carousel. */
export function salesPosterIntent(request) {
  const text = String(request || '');
  if (/\b(?:do not|don't|without)\s+(?:generate|create|make|produce|design)(?:ing)?\b/i.test(text) || /\b(?:draft|brief) only\b/i.test(text)) return null;
  if (!/\b(?:generate|create|make|produce|design)\b/i.test(text) || !/\b(?:poster|ad creative|advertising image|ad image|banner)\b/i.test(text)) return null;
  if (/\b(?:carousel|carrousel|carsoule|five[ -]?card|5[ -]?card)\b/i.test(text)) return null;
  if (!/\b(?:(?:top|best|most|highest)[\s-]+(?:selling|seller|sold)|best[\s-]?seller|sales[\s-]+leader)\b/i.test(text)) return null;
  return { category: requestedSalesCategory(text), format: /\b(?:print(?:ed|able)?|in.store|in shop|store poster)\b/i.test(text) ? 'poster' : 'portrait' };
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
