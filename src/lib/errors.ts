/**
 * Any thrown thing as readable text. Supabase errors are plain objects, not Error, so String() on them gives
 * "[object Object]"; this reads their message, details and hint instead.
 */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint].filter(v => typeof v === 'string' && v) as string[];
    if (parts.length) return parts.join(' · ') + (typeof o.code === 'string' && o.code ? ` (${o.code})` : '');
    try { return JSON.stringify(e).slice(0, 500); } catch { /* fall through */ }
  }
  return String(e);
}
