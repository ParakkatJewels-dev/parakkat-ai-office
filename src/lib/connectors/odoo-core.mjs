// Pieces of the Odoo sync that need no network, kept here so the tests can run them.

/** The Odoo address as https://host, or null when it is not one. The API key travels with every call, so plain http is refused. */
export function normalizeOdooUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    return u.origin;
  } catch { return null; }
}

/** The database name Odoo Online uses by default: the subdomain of mycompany.odoo.com. */
export const guessDb = url => { const m = /^https:\/\/([a-z0-9-]+)\.odoo\.com$/i.exec(url || ''); return m ? m[1] : ''; };

const IST = 330 * 60_000;
/** Odoo stores times in UTC as 'YYYY-MM-DD HH:MM:SS'; the day a sale belongs to is the day in India. */
export function istDay(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  return Number.isNaN(t) ? null : new Date(t + IST).toISOString().slice(0, 10);
}
/** Midnight in India at the start of `day`, as the UTC time Odoo filters on. */
export const utcStart = day => new Date(Date.parse(day + 'T00:00:00Z') - IST).toISOString().slice(0, 19).replace('T', ' ');
export const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** A many-to-one value from Odoo: [id, name], or false when empty. */
export const m2o = v => (Array.isArray(v) && v.length ? { id: v[0], name: String(v[1] ?? v[0]) } : null);

/** The key a product is matched on: its internal reference (the SKU), else its barcode, else Odoo's own id. */
export function skuOf(p) {
  const code = String(p?.default_code || '').trim(); if (code) return code;
  const bar = String(p?.barcode || '').trim(); if (bar) return bar;
  return `odoo:${p?.id}`;
}

const ONLINE = /online|web|e-?com|shopify|amazon|flipkart|marketplace/i;
/**
 * The branch a sales order belongs to. Orders from an Odoo website, or from a sales team or warehouse whose name says it is
 * online, count as online; the names in `online` (from the Admin page) always do.
 */
export function orderBranch(o, online = []) {
  const site = m2o(o.website_id), team = m2o(o.team_id), wh = m2o(o.warehouse_id);
  const named = n => !!n && (online.some(x => x && n.toLowerCase() === String(x).toLowerCase()) || ONLINE.test(n));
  if (site) return { branch: site.name, kind: 'online' };
  const name = team?.name || wh?.name || 'Sales orders';
  return { branch: name, kind: named(team?.name) || named(wh?.name) ? 'online' : 'other' };
}

/** Running totals per branch per day and per branch, product and day. */
export function totals() {
  const branch = new Map(), lines = new Map();
  return {
    add({ day, branch: b, kind, sku, product, units, revenue, order }) {
      if (!day) return;
      const bk = `${day}|${b}`, x = branch.get(bk) || { day, branch: b, kind, orders: new Set(), revenue: 0 };
      if (order != null) x.orders.add(order);
      x.revenue += Number(revenue) || 0; branch.set(bk, x);
      const lk = `${day}|${b}|${sku}`, y = lines.get(lk) || { day, branch: b, sku, product, units: 0, revenue: 0 };
      y.units += Number(units) || 0; y.revenue += Number(revenue) || 0; lines.set(lk, y);
    },
    branchRows: () => [...branch.values()].map(x => ({ day: x.day, branch: x.branch, kind: x.kind, orders: x.orders.size, revenue: round(x.revenue) })),
    lineRows: () => [...lines.values()].map(y => ({ ...y, units: round(y.units), revenue: round(y.revenue) })),
  };
}
const round = n => Math.round(n * 100) / 100;

/**
 * Which days to read this sync: the last three days every time (late edits and refunds), from further back when the last
 * sync was longer ago than that, and, until 90 days are in, one more fortnight before the oldest day read so far.
 * `oldest` is the first day already read and `newest` the last.
 */
export function salesWindows(today, oldest, newest, backfill = 90, chunk = 15) {
  const floor = addDays(today, -backfill + 1);
  let from = addDays(today, -2);
  if (newest && newest < from) from = newest < floor ? floor : newest;
  const recent = { from, to: today };
  const start = oldest && oldest <= from ? oldest : from;
  if (start <= floor) return [recent];
  const back = addDays(start, -chunk) < floor ? floor : addDays(start, -chunk);
  return [recent, { from: back, to: addDays(start, -1) }];
}

/** Daily checkpoints keep a large backfill from starving behind the stock snapshot on every sync. */
export function salesDayWindows(today, state = {}) {
  const floor = addDays(today, -89), valid = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= floor && d <= today;
  const pending = Array.isArray(state.pending) ? state.pending.filter(w => w && valid(w.from) && w.from === w.to).slice(0, 90) : [];
  if (pending.length) return pending.map(w => ({ from: w.from, to: w.to }));
  const out = [], seen = new Set();
  for (const [i, w] of salesWindows(today, state.oldest, state.newest).entries()) {
    // Catch up recent days forward; backfill backward so the recorded range stays contiguous.
    for (let d = i ? w.to : w.from; i ? d >= w.from : d <= w.to; d = addDays(d, i ? -1 : 1)) {
      if (!seen.has(d)) { out.push({ from: d, to: d }); seen.add(d); }
    }
  }
  return out;
}

export const odooDeadline = () => Object.assign(new Error('Odoo will continue on the next sync; the last complete data is kept.'), { code: 'odoo_deadline' });
export const isOdooDeadline = error => error?.code === 'odoo_deadline';

/** Only an absent optional model is optional. Network, authentication and ACL failures must propagate. */
export function isMissingOdooModel(error, model) {
  const message = String(error?.message || '');
  return message.includes(model) && /doesn.t exist|does not exist|unknown model|model[^\n]*not found|object[^\n]*not found/i.test(message);
}

/** Read first, then atomically commit that day's rows and the next cursor. Failed reads never advance. */
export async function runSalesDays({ today, state = {}, deadline, read, commit, now = Date.now, reserveMs = 20_000 }) {
  let saved = { ...state }, pending = salesDayWindows(today, state), completed = 0, branchDays = 0;
  let coverage = state.coverage || null;
  while (pending.length && now() < deadline - reserveMs) {
    const window = pending[0];
    let result;
    try { result = await read(window); }
    catch (error) { if (isOdooDeadline(error)) break; throw error; }
    // A complete read that ran out of commit time is safe to repeat; no old totals have been touched.
    if (now() >= deadline - 5000) break;
    const next = { ...saved,
      oldest: saved.oldest && saved.oldest < window.from ? saved.oldest : window.from,
      newest: saved.newest && saved.newest > window.to ? saved.newest : window.to,
      pending: pending.slice(1), coverage: result.coverage,
    };
    next.needs_continuation = !!next.pending.length || next.oldest > addDays(today, -89);
    await commit(window, result, next);
    saved = next; pending = next.pending; coverage = result.coverage;
    completed++; branchDays += result.branchRows.length;
  }
  const more = !!pending.length || !saved.oldest || saved.oldest > addDays(today, -89);
  return { days: branchDays, completedWindows: completed, pendingDays: pending.length,
    from: saved.oldest || null, more, coverage, state: { ...saved, pending, needs_continuation: more } };
}

export function odooContinuationDue(state, updatedAt, lastAttempt, now = Date.now()) {
  if (!state?.needs_continuation && !state?.pending?.length) return false;
  const latest = Math.max(Date.parse(updatedAt || '') || 0, Number(lastAttempt) || 0);
  return now - latest >= 120_000;
}
