// Pricing an AI or API call from the price list on the Usage page. Kept free of server imports so it can be tested.

/** The price row for a call: the exact model, else the provider's default (provider:*), else free. */
export function priceFor(prices, provider, model) {
  return prices[`${provider}:${model}`] || prices[`${provider}:*`] || { in_per_m: 0, out_per_m: 0, per_unit: 0 };
}

/** Estimated cost in US dollars: tokens at the per-million rates plus a per-call or per-image charge. */
export function costUsd(price, { input = 0, output = 0, units = 1 } = {}) {
  return (input * Number(price.in_per_m) + output * Number(price.out_per_m)) / 1e6 + units * Number(price.per_unit);
}

/** The agent behind a prompt: every agent prompt starts "You are <name> at Parakkat". */
export function agentFromPrompt(system, people) {
  const m = /^You are (.+?) at Parakkat/.exec(system || '');
  return m ? people.find(p => p.name === m[1]) || null : null;
}
