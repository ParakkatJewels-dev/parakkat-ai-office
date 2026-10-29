import { createHash } from 'node:crypto';

export const MAX_OPPORTUNITIES = 2;
/** Recheck after taking the shared lease: a manual review may have finished after scheduler selection. */
export function opportunityReviewDue(trigger, lastRunAt, now = Date.now(), every = 4 * 60 * 60_000) {
  if (trigger === 'manual') return true;
  const last = Date.parse(lastRunAt || '');
  return !Number.isFinite(last) || now - last >= every;
}
export const opportunityText = (value, max = 1200) => typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '';
const key = value => opportunityText(value, 400).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const observationFields = new Set(['observedAt','observed_at','updated_at','last_synced_at','product_updated_at','created_at','seen_at','at']);
/** Hash substantive source values, not polling timestamps, row ordering or the review's own new reports. */
export function opportunityEvidenceFingerprint(evidence) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(key=>!observationFields.has(key)).sort().map(key=>[key,stable(value[key])]));
    return value;
  };
  return hash(JSON.stringify(stable(evidence)));
}
/** A failed or interrupted attempt cannot be hammered by repeated manual clicks or scheduler retries. */
export function opportunityEvidenceGate(saved, fingerprint, now = Date.now()) {
  if (saved?.completedFingerprint === fingerprint) return 'unchanged';
  if (saved?.attemptFingerprint === fingerprint && Date.parse(saved.retryAfter || '') > now) return 'backoff';
  return 'ready';
}
const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const shown = value => numeric(value) === null ? 'unknown' : String(numeric(value));
const period = window => `${window.from} through ${window.to}, inclusive`;

export function opportunityWindows(now = new Date()) {
  const day = offset => new Date(Date.parse(`${now.toISOString().slice(0, 10)}T12:00:00Z`) + offset * 864e5).toISOString().slice(0, 10);
  return { current: { from: day(-7), to: day(-1) }, previous: { from: day(-14), to: day(-8) }, observedAt: now.toISOString() };
}

/** Join products by their real ID. A missing prior sample or null stock never becomes zero. */
export function opportunityProductFacts(current, previous, window, previousWindow) {
  if (!current?.available || !Array.isArray(current.data)) return [];
  const prior = new Map((previous?.available && Array.isArray(previous.data) ? previous.data : []).map(row => [String(row.product_id), row]));
  return current.data.filter(row => row.product_id != null).slice(0, 12).map(row => {
    const old = prior.get(String(row.product_id));
    const stock = numeric(row.stock);
    return { id: `product:${row.product_id}`, category: 'products', source: 'Shopify recorded product sales and preferred recorded stock',
      text: `${row.title || `Product ${row.product_id}`} [product ${row.product_id}]: ${shown(row.units)} recorded units and INR ${shown(row.revenue)} revenue during ${period(window)} (UTC sales buckets). Previous ${period(previousWindow)}: ${old ? `${shown(old.units)} recorded units` : 'unknown; product absent from the returned prior sample'}. Recorded stock: ${stock === null ? 'unknown' : stock}; stock source: ${stock === null ? 'unknown' : row.stock_source || 'unknown'}. Stock is a snapshot, not live availability.`,
      dateFrom: window.from, dateTo: window.to,
      limitation: 'Top recorded-product sample; missing products/days are not zero. Sync completeness and stock capture time are unverified.' };
  });
}

/** A bounded daily-ad sample, with explicit observed-day coverage; never claim an overall ranking. */
export function opportunityAdFacts(rows, truncated, window) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.ad_id || !row.platform || row.day < window.from || row.day > window.to) continue;
    const id = `${row.platform}:${row.account_id || 'unknown'}:${row.ad_id}`;
    const group = groups.get(id) || { id, name: opportunityText(row.ad_name || row.campaign_name || row.ad_id, 140), spend: 0, revenue: 0, purchases: 0, days: new Set(), valid: true };
    for (const metric of ['spend', 'revenue', 'purchases']) {
      const n = numeric(row[metric]); if (n === null) group.valid = false; else group[metric] += n;
    }
    group.days.add(row.day); groups.set(id, group);
  }
  return [...groups.values()].sort((a,b) => b.spend - a.spend).slice(0, 8).map(row => ({
    id: `ad:${row.id}`, category: 'ads', source: 'Recorded ad insights',
    text: `${row.name} [${row.id}]: ${row.valid ? `INR ${row.spend.toFixed(2)} spend, INR ${row.revenue.toFixed(2)} platform-attributed revenue, ${row.purchases} recorded purchases` : 'one or more metrics unknown; do not calculate a return'} across ${row.days.size} observed days within ${period(window)}.`,
    dateFrom: window.from, dateTo: window.to,
    limitation: `${truncated ? 'The source query was truncated; these are partial per-ad totals. ' : ''}Sample only; missing days are not zero. Ad platforms may attribute the same sale. This is evidence to investigate, not authority to pause or change ads.` }));
}

const relevance = {
  insights: ['products','performance','alerts'], perf: ['ads','performance','alerts'], strategy: ['products','calendar','performance'],
  creative: ['social','calendar'], intel: ['competitors','search'], warroom: ['competitors'], social: ['social'],
  seo: ['search'], catalog: ['products'], customer: ['products','social'], crm: ['social'], datahub: ['data_gap'],
};

const relevantFact = (lead, fact) => (relevance[lead.department_id] || []).includes(fact.category)
  && (fact.category !== 'alerts' || !fact.departmentId || fact.departmentId === lead.department_id);

/** Keep relevant source rows intact, including their dates and limitations.
 * Explicit reader/connection gaps remain visible; omitted domains are not missing data. */
function factsForLead(lead, facts) {
  return facts.filter(fact => fact.category === 'data_gap' || relevantFact(lead, fact));
}

/** Relevant enabled leads rotate so fresh-evidence reviews do not always select the same department. */
export function selectOpportunityLeads(agents, facts, recentLeads = []) {
  const categories = new Set(facts.map(fact => fact.category));
  return agents.filter(agent => agent.enabled && agent.is_lead && agent.id !== 'cmo' && relevance[agent.department_id])
    .map(agent => ({ agent, age: recentLeads.includes(agent.id) ? recentLeads.indexOf(agent.id) : Number.MAX_SAFE_INTEGER,
      score: relevance[agent.department_id].filter(category => categories.has(category)).length * 4
      + (facts.some(fact => fact.category === 'alerts' && fact.departmentId === agent.department_id) ? 5 : 0) }))
    .filter(row => facts.some(fact => relevantFact(row.agent, fact)))
    .sort((a,b) => b.age - a.age || b.score - a.score || a.agent.id.localeCompare(b.agent.id)).slice(0,2).map(row => row.agent);
}

export function opportunityKeys(candidate, departmentId) {
  const titleKey = key(candidate.title);
  const evidenceKey = hash(`${departmentId}|${candidate.evidence.map(e => e.sourceId).sort().join('|')}`);
  return { titleKey, evidenceKey, fingerprint: hash(`${departmentId}|${titleKey}|${evidenceKey}`) };
}

export function normalizeOpportunityTurn(value, lead, facts) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_opportunity_response');
  const source = new Map(facts.map(fact => [fact.id, fact]));
  const candidates = [];
  for (const raw of (Array.isArray(value.opportunities) ? value.opportunities : []).slice(0, 4)) {
    if (!raw || typeof raw !== 'object') continue;
    const title = opportunityText(raw.title, 140), finding = opportunityText(raw.finding, 1600);
    const nextStep = opportunityText(raw.nextStep, 900), successMetric = opportunityText(raw.successMetric, 400);
    const evidence = [];
    for (const ref of (Array.isArray(raw.evidence) ? raw.evidence : []).slice(0, 4)) {
      const fact = source.get(ref?.sourceId), quote = opportunityText(ref?.quote, 700);
      if (fact && quote.length >= 12 && fact.text.includes(quote) && !evidence.some(e => e.sourceId === fact.id)) evidence.push({ sourceId: fact.id, quote });
    }
    if (!title || !finding || !nextStep || !successMetric || !evidence.length) continue;
    const candidate = { id: `${lead.id}:${candidates.length}`, agentId: lead.id, departmentId: lead.department_id, title, finding, nextStep, successMetric,
      priority: raw.priority === 'high' ? 'high' : 'normal', evidence };
    candidates.push({ ...candidate, ...opportunityKeys(candidate, lead.department_id) });
    if (candidates.length === MAX_OPPORTUNITIES) break;
  }
  const summary = opportunityText(value.summary, 1000);
  if (!summary) throw new Error('invalid_opportunity_response');
  return { agentId: lead.id, summary, candidates };
}

export function normalizeOpportunityReview(value, candidates) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !opportunityText(value.summary, 1200)) throw new Error('invalid_opportunity_review');
  const allowed = new Map(candidates.map(candidate => [candidate.id, candidate])), seen = new Set();
  const decisions = [];
  for (const row of Array.isArray(value.decisions) ? value.decisions : []) {
    if (!allowed.has(row?.candidateId) || seen.has(row.candidateId) || !['forward','skip'].includes(row.decision)) continue;
    const note = opportunityText(row.note, 900); if (!note) continue;
    seen.add(row.candidateId); decisions.push({ candidateId: row.candidateId, decision: row.decision, note });
  }
  return { summary: opportunityText(value.summary, 1200), decisions };
}

export function duplicateOpportunity(candidate, recent) {
  return recent.some(old => old.fingerprint === candidate.fingerprint || (old.departmentId === candidate.departmentId
    && (old.titleKey === candidate.titleKey || old.evidenceKey === candidate.evidenceKey)));
}

/** Actual lead turns precede CMO review; only validated, reviewed, nonduplicate proposals reach a head. */
export async function coordinateOpportunities({ leads, facts, recent = [], ask, saveTurn, saveReview, forward }) {
  const turns = [];
  for (const lead of leads) {
    const scopedFacts = factsForLead(lead, facts);
    const raw = await ask(lead, { phase: 'lead', facts: scopedFacts,
      evidenceCoverage: { includedFacts: scopedFacts.length, omittedFacts: facts.length - scopedFacts.length,
        note: 'Only facts relevant to this department and explicit data gaps are included. Other domains are omitted, not unavailable or zero. Cite only facts supplied in this turn.' },
      previousTurns: turns.map(turn => ({ ...turn })), recent });
    // A valid global source ID is not enough: this lead must have received its
    // actual source row, rather than copying a claim from another lead's output.
    const turn = normalizeOpportunityTurn(raw, lead, scopedFacts);
    await saveTurn(turn); turns.push(turn);
  }
  const candidates = turns.flatMap(turn => turn.candidates);
  if (!candidates.length) {
    const review = { summary: 'The department leads proposed no supported new opportunities. No CMO review or reports were needed.', decisions: [] };
    await saveReview(review);
    return { summary: review.summary, turns, forwarded: [], duplicates: [] };
  }
  // The candidate bodies and citations appear once. The CMO still receives all
  // source facts so it can check limitations and contradictory evidence.
  const reviewTurns = turns.map(turn => ({ agentId: turn.agentId, summary: turn.summary, candidateIds: turn.candidates.map(candidate => candidate.id) }));
  const review = normalizeOpportunityReview(await ask(null, { phase: 'cmo', facts, turns: reviewTurns, candidates, recent }), candidates);
  await saveReview(review);
  const forwarded = [], duplicates = [];
  for (const decision of review.decisions) {
    if (decision.decision !== 'forward') continue;
    const candidate = candidates.find(candidate => candidate.id === decision.candidateId);
    if (duplicateOpportunity(candidate, [...recent, ...forwarded])) { duplicates.push(candidate.id); continue; }
    if (forwarded.length === MAX_OPPORTUNITIES) break;
    await forward(candidate, decision.note); forwarded.push(candidate);
  }
  return { summary: review.summary, turns, forwarded, duplicates };
}

export function opportunityFailure(error) {
  if (error?.name === 'Paused') return 'The review stopped because the agents were paused. Completed lead reviews are saved; no external action was taken.';
  if (error?.code === 'disabled') return 'The review stopped because a participating lead or the CMO was disabled. Completed work is saved.';
  if (['AbortError','TimeoutError'].includes(error?.name) || error?.code === 'deadline') return 'The opportunity review reached its time limit. Completed lead reviews and any forwarded reports are saved.';
  if (error?.code === 'provider') return 'Connect the text-model provider in Admin before running an opportunity review.';
  return 'The opportunity review could not finish. Completed lead reviews and any forwarded reports are saved; no external action was taken.';
}
