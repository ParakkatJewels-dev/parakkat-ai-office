// Convert server leases to short browser-local leases so clock skew cannot keep
// an old job looking active. Round-trip time is deducted conservatively.
export function localWorkSnapshot(data, roundTripMs, now = Date.now()) {
  const observed = Date.parse(data?.observedAt);
  if (!Number.isFinite(observed) || !data.statuses || typeof data.statuses !== 'object' || Array.isArray(data.statuses)) return {};
  const elapsed = Math.max(0, Number(roundTripMs) || 0), result = {};
  for (const [id, status] of Object.entries(data.statuses)) {
    if (!status || typeof status.label !== 'string' || !status.label.trim() || !['working', 'thinking', 'waiting', 'blocked'].includes(status.state)) continue;
    const until = typeof status.expiresAt === 'number' ? status.expiresAt : Date.parse(status.expiresAt);
    const remaining = Math.min(12_000, until - observed) - elapsed;
    if (!Number.isFinite(remaining) || remaining <= 0) continue;
    result[id] = { state: status.state, label: status.label.slice(0, 120), expiresAt: now + remaining };
  }
  return result;
}
