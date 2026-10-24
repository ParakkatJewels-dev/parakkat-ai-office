// Shopify's GraphQL Admin API meters each store with a bucket of query points that refills every second.
// Every answer reports what the query cost and how full the bucket is; these helpers turn that into how long to wait.

/** True when Shopify turned the query away for spending too much too fast. */
export const isThrottled = data => (data?.errors || []).some(e => e?.extensions?.code === 'THROTTLED');

/**
 * Milliseconds to wait before the next query. After a throttle, until the bucket can pay for this query again;
 * otherwise only when the bucket is close to empty, so a long sync slows down before Shopify has to stop it.
 */
export function waitMs(cost, { throttled = false, attempt = 0 } = {}) {
  const t = cost?.throttleStatus, need = Number(cost?.requestedQueryCost || cost?.actualQueryCost || 0);
  if (!t || !t.restoreRate) return throttled ? Math.min(30_000, 1000 * 2 ** attempt) : 0;
  const left = Number(t.currentlyAvailable), rate = Number(t.restoreRate);
  const target = throttled ? need : Math.min(Number(t.maximumAvailable) || need * 2, need * 2);
  return left >= target ? 0 : Math.min(30_000, Math.ceil((target - left) / rate * 1000) + 100);
}
