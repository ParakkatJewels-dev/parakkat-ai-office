// Pricing an AI or API call from the price list on the Usage page. Kept free of server imports so it can be tested.

/** The price row for a call: the exact model, else the provider's default (provider:*), else free. */
export function priceFor(prices, provider, model) {
  return prices[`${provider}:${model}`] || prices[`${provider}:*`] || { in_per_m: 0, out_per_m: 0, per_unit: 0 };
}

/** Estimated cost in US dollars: tokens at the per-million rates plus a per-call or per-image charge. */
export function costUsd(price, { input = 0, output = 0, units = 1 } = {}) {
  return (input * Number(price.in_per_m) + output * Number(price.out_per_m)) / 1e6 + units * Number(price.per_unit);
}

/** Keep image output out of the text/thinking rate. Other models retain their existing accounting. */
export function geminiImageBilling(model, imageSize, metadata = {}, parts = []) {
  if (model !== 'gemini-3-pro-image') return {};
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const units = parts.filter(part => !part?.thought && part?.inlineData).length;
  const size = imageSize === '4K' ? '4k' : '2k';
  const expectedImageTokens = units * (size === '4k' ? 2000 : 1120);
  const details = metadata.candidatesTokensDetails;
  const validDetails = Array.isArray(details) && details.length > 0 && details.every(item => count(item?.tokenCount));
  const imageDetails = validDetails ? details.filter(item => item.modality === 'IMAGE') : [];
  const imageTokens = imageDetails.reduce((sum, item) => sum + item.tokenCount, 0);
  const candidatesKnown = count(metadata.candidatesTokenCount);
  const thoughts = count(metadata.thoughtsTokenCount) ? metadata.thoughtsTokenCount : 0;
  const precise = candidatesKnown && imageTokens > 0 && details.reduce((sum, item) => sum + item.tokenCount, 0) <= metadata.candidatesTokenCount;
  const billingOutput = Math.max(0, (candidatesKnown ? metadata.candidatesTokenCount : 0) - (precise ? imageTokens : expectedImageTokens)) + thoughts;
  const notes = [];
  if (!precise) notes.push(candidatesKnown
    ? `Estimated text/image split: image modality tokens unavailable; subtracted ${expectedImageTokens} documented image tokens, clamped at zero.`
    : 'Image cost estimated from final images; text/thinking output cost incomplete because candidate token count was unavailable.');
  if (validDetails && details.some(item => !['TEXT', 'IMAGE'].includes(item.modality))) notes.push('Unrecognized output modality estimated at the text rate.');
  if (metadata.thoughtsTokenCount != null && !count(metadata.thoughtsTokenCount)) notes.push('Thinking token count unavailable; thinking cost incomplete.');
  if (!count(metadata.promptTokenCount)) notes.push('Input token count unavailable; input cost incomplete.');
  return {
    billingOutput,
    priceFallback: { in_per_m: 2, out_per_m: 12, per_unit: 0 },
    imageCharge: { priceKey: `gemini:${model}-image-${size}`, units, fallbackPrice: { in_per_m: 0, out_per_m: 0, per_unit: size === '4k' ? 0.24 : 0.134 } },
    ...(notes.length ? { costNote: notes.join(' ') } : {}),
  };
}

/** Image price rows own image fees; their tokens are excluded from the main row's output billing. */
export function usageCostUsd(prices, use) {
  const price = prices[`${use.provider}:${use.model || ''}`] || use.priceFallback || priceFor(prices, use.provider, use.model || '');
  const tokenCost = costUsd(price, { input: use.input, output: use.billingOutput ?? use.output, units: use.imageCharge ? 0 : use.units ?? 1 });
  if (!use.imageCharge) return tokenCost;
  const imagePrice = prices[use.imageCharge.priceKey] || use.imageCharge.fallbackPrice;
  return tokenCost + costUsd(imagePrice, { units: use.imageCharge.units });
}

/** Prefer the stable runtime identity; a changed display name must not lose usage attribution. */
export function agentFromPrompt(system, people) {
  const identity = /^Agent identity: ([a-zA-Z][a-zA-Z0-9_-]{0,99})\n/.exec(system || '');
  if (identity) return people.find(p => p.id === identity[1] && !p.human) || null;
  const m = /^You are (.+?) at Parakkat/.exec(system || '');
  return m ? people.find(p => p.name === m[1]) || null : null;
}
