// Shared by server scorecards and the office browser. Historical events are not live work.
const timestamp = value => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const IST_OFFSET_MS = 330 * 60_000;

/** Only an executing server scope with a fresh lease is "working now". */
export function isWorkingStatus(source, now = Date.now()) {
  if (!Number.isFinite(now) || !source || source.state !== 'working') return false;
  const expires = timestamp(source.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

/** India calendar today, not a rolling 24 hours or a recent-event busy heuristic. */
export function activityState(lastAt, source, now = Date.now()) {
  if (isWorkingStatus(source, now)) return 'now';
  const last = timestamp(lastAt);
  if (!Number.isFinite(now) || !Number.isFinite(last) || last > now) return 'quiet';
  return Math.floor((last + IST_OFFSET_MS) / 86_400_000) === Math.floor((now + IST_OFFSET_MS) / 86_400_000) ? 'today' : 'quiet';
}
