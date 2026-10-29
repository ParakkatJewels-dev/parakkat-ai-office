// Deliberately narrow read-only intents. Anything requiring judgment, a meeting,
// another agent's data, or unsupported response preferences stays on the AI path.
const normalize = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/[?.!]+$/, '').replace(/\s+/g, ' ') : '';
const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const shift = (date, amount) => new Date(Date.parse(`${date}T12:00:00Z`) + amount * 864e5).toISOString().slice(0, 10);
const metrics = new Map([
  ['shopify revenue', 'shopify_revenue'], ['shopify sales revenue', 'shopify_revenue'],
  ['shopify units sold', 'shopify_units'], ['shopify units', 'shopify_units'],
  ['ad spend', 'ad_spend'], ['advertising spend', 'ad_spend'],
  ['ad revenue', 'ad_revenue'], ['ad attributed revenue', 'ad_revenue'],
  ['ad roas', 'ad_roas'], ['advertising roas', 'ad_roas'], ['performance totals', 'totals'],
]);

export function matchDeterministicConversation(prompt, { meetingRequested = false, now = new Date() } = {}) {
  if (meetingRequested) return null;
  const text = normalize(prompt).replace(/^please /, '');
  if (/^(?:(?:what(?:'s| is) )?(?:your )?(?:current )?(?:work |task )?status(?: update)?|(?:show|give)(?: me)? your (?:current )?(?:status|progress)|what are you (?:doing|working on)(?: (?:now|right now))?|are you (?:working|busy)(?: (?:now|right now))?|(?:show|give)(?: me)? (?:your )?progress(?: update)?)$/.test(text)) return { kind: 'status' };
  const match = /^(?:(?:show|give)(?: me)? |what (?:is|was|are|were) (?:the )?)?(shopify sales revenue|shopify revenue|shopify units sold|shopify units|advertising spend|ad spend|ad attributed revenue|ad revenue|advertising roas|ad roas|performance totals) (?:for |over )?(?:the )?(last (?:7|30) days|\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} utc)$/.exec(text);
  if (!match) return null;
  const to = now.toISOString().slice(0, 10);
  let window;
  if (match[2].startsWith('last ')) {
    const days = Number(match[2].split(' ')[1]);
    window = { from: shift(to, 1 - days), to };
  } else {
    const [from, end] = match[2].replace(/ utc$/, '').split(' to ');
    if (!day(from) || !day(end) || from > end || end > to || (Date.parse(end) - Date.parse(from)) / 864e5 > 365) return null;
    window = { from, to: end };
  }
  return { kind: 'metrics', metric: metrics.get(match[1]), window };
}

/** Templates cannot interpret arbitrary saved instructions. Prefer the model whenever any are set. */
export function deterministicPreferencesSupported(runtime) {
  if (!runtime || typeof runtime.instructions !== 'string' || runtime.instructions.trim()) return false;
  const context = [runtime.context?.brand, ...(runtime.context?.lessons || []).filter(row => !['analytics', 'results'].includes(row?.source))];
  // The brand/manual guidance can also contain language or response-format preferences.
  return !context.some(value => /\b(?:respond|reply|answer|write|output|communicate|language|format|tone)\b/i.test(JSON.stringify(value || '')));
}

const plain = (value, max = 300) => String(value || '').replace(/[\r\n]+/g, ' ').slice(0, max).replace(/[\\`*_[\]<>]/g, '\\$&');
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const numeric = value => {
  // Postgres numerics can arrive as decimal strings. Reject coercions such as
  // hex/booleans and magnitudes whose displayed totals cannot be trusted in JS.
  if (typeof value !== 'number' && !(typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim()))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER ? parsed : null;
};
const nonnegative = value => { const parsed = numeric(value); return parsed !== null && parsed >= 0 ? parsed : null; };
const count = value => { const parsed = nonnegative(value); return Number.isSafeInteger(parsed) ? parsed : null; };
const formatted = value => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const money = value => value === null ? 'unknown' : `₹${formatted(value)}`;

export function deterministicStatusAnswer({ hostName, observedAt, live, activity, reports }) {
  const at = instant(observedAt);
  const current = live?.available && live.work?.state === 'working' && instant(live.work.expiresAt) && Date.parse(live.work.expiresAt) > Date.parse(at || '');
  const lines = [`${plain(hostName)} — status checked ${at || 'at an unknown time'}.`];
  lines.push(current ? `Working now: ${plain(live.work.label)}${instant(live.work.startedAt) ? ` (started ${instant(live.work.startedAt)})` : ''}.`
    : live?.available ? 'No other live work is registered for me on this application server right now. This status check is excluded.'
      : 'Live work status is unavailable; current activity is unknown.');
  const latest = activity?.available && Array.isArray(activity.data) ? activity.data[0] : null;
  lines.push(latest ? `Latest visible recorded activity${instant(latest.at) ? ` (${instant(latest.at)})` : ''}: ${plain(latest.text)}. This is a historical record, not proof it is still running.`
    : activity?.available ? 'No recent activity rows are visible to you; this does not prove there has been no work.' : 'Recent activity records are unavailable.');
  const report = reports?.available && Array.isArray(reports.data) ? reports.data[0] : null;
  if (report) lines.push(`Latest visible report${instant(report.updated_at) ? ` (${instant(report.updated_at)})` : ''}: ${plain(report.title)} — ${plain(String(report.status || 'status unknown').replace(/_/g, ' '))}.`);
  else lines.push(reports?.available ? 'No recent reports are visible to you.' : 'Recent reports are unavailable.');
  return lines.join('\n\n');
}

export function deterministicMetricsAnswer(match, result, observedAt) {
  if (match?.kind !== 'metrics') return null;
  const { from, to } = match.window, at = instant(observedAt), data = result?.available && result.data && typeof result.data === 'object' ? result.data : null;
  const days = Array.isArray(data?.days) ? data.days.filter(row => Array.isArray(row) && day(row[0]) && row[0] >= from && row[0] <= to) : [];
  const platforms = Array.isArray(data?.platforms) ? data.platforms.filter(row => typeof row?.platform === 'string' && row.platform) : [];
  // dashboard_report coalesces empty aggregates to zero. Establish recorded rows
  // independently before presenting those numbers as recorded zero values.
  const sales = days.length > 0, ads = platforms.length > 0;
  const revenue = sales ? numeric(data?.revenue) : null, units = sales ? count(data?.units) : null;
  const spend = ads ? nonnegative(data?.spend) : null, adRevenue = ads ? nonnegative(data?.ad_revenue) : null;
  const ratio = spend !== null && spend > 0 && adRevenue !== null ? adRevenue / spend : null;
  const roas = ratio !== null && Number.isFinite(ratio) ? ratio : null;
  const fields = {
    shopify_revenue: `Recorded Shopify revenue: ${money(revenue)}`,
    shopify_units: `Recorded Shopify units sold: ${units === null ? 'unknown' : formatted(units)}`,
    ad_spend: `Recorded advertising spend: ${money(spend)}`,
    ad_revenue: `Recorded ad-platform attributed revenue: ${money(adRevenue)}`,
    ad_roas: `Recorded ad ROAS: ${roas !== null ? `${formatted(roas)}× (attributed revenue ÷ spend)` : 'unknown (requires valid recorded attributed revenue and positive spend)'}`,
  };
  const selected = match.metric === 'totals' ? ['shopify_revenue', 'shopify_units', 'ad_spend', 'ad_revenue', 'ad_roas'] : [match.metric];
  const lines = [`Recorded totals for ${from} through ${to}, inclusive (UTC date buckets).`, ...selected.map(key => fields[key])];
  if (at && from <= at.slice(0, 10) && to >= at.slice(0, 10)) lines.push('The current UTC day is partial. These are not Asia/Kolkata calendar-day totals.');
  else lines.push('These are UTC date buckets, not Asia/Kolkata calendar-day totals.');
  lines.push(`Source: synced Shopify order records and recorded advertising results${platforms.length ? ` (${platforms.map(row => plain(row.platform, 40)).join(', ')})` : ''}. Read at ${at || 'an unknown time'}.`);
  if (selected.some(key => key.startsWith('shopify'))) lines.push(sales ? `${new Set(days.map(row => row[0])).size} sales dates have recorded rows. Missing dates and products are unknown; sync completeness is not verified. Shopify does not include all showroom sales.` : 'No readable Shopify sales rows establish these totals. Missing records mean unknown, not zero.');
  if (selected.some(key => key.startsWith('ad'))) lines.push(ads ? 'Advertising totals cover recorded platform rows; complete date/account coverage is not verified. Attributed revenue may overlap across platforms and Shopify; it is not profit.' : 'No readable advertising rows establish these totals. Missing records mean unknown, not zero.');
  if (!data) lines.push('The performance source could not be read.');
  return lines.join('\n\n');
}
