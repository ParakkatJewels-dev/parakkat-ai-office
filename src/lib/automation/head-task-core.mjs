// Pure validation for the bounded, head-led workflow. Model text never becomes an action.
export const headText = (value, max = 6000) => typeof value === 'string' ? Array.from(value.trim()).slice(0, max).join('') : '';
export const OUTPUT_QC_AGENT = 'outputQc';
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key] ?? null))])) : value ?? null);
const fail = message => { throw Object.assign(new Error(message), { code: 'head_task_output' }); };
const list = (value, max = 6, chars = 600) => Array.isArray(value) ? value.slice(0, max).map(item => headText(item, chars)).filter(Boolean) : [];

/** DB role/department/enabled values are current; the known roster excludes imaginary people. */
export function headTaskRoster(agents, people, headId, allowedDepartments) {
  const allowed = new Set(Array.isArray(allowedDepartments) ? allowedDepartments.filter(id => typeof id === 'string') : []);
  const known = new Map(people.map(person => [person.id, person]));
  const usable = (Array.isArray(agents) ? agents : []).filter(agent => {
    const person = known.get(agent.id);
    return person && !person.human && person.model !== 'Scheduled job' && agent.enabled === true && allowed.has(agent.department_id);
  });
  const head = usable.find(agent => agent.id === headId && agent.is_lead === true);
  return { head: head || null, specialists: head ? usable.filter(agent => agent.id !== headId && agent.id !== OUTPUT_QC_AGENT) : [] };
}

/** Exact checked content, including source evidence, not a mutable approval label. */
export function headQualityArtifact(state) {
  return structuredClone({ humanRevision: state.humanRevision, revisionRound: state.revisionRound,
    finalMarkdown: state.review?.finalMarkdown || '', outputs: state.outputs, plan: state.plan,
    evidenceSnapshot: state.evidenceSnapshot || null, evidence: state.evidence || [] });
}

/** Browser-safe: the same version check is used by the runtime and the human inbox. */
export function headQualityCurrent(state) {
  return !!state?.quality && state.quality.reviewerId === OUTPUT_QC_AGENT &&
    state.headAgentId !== OUTPUT_QC_AGENT && !state.plan?.assignments?.some(item => item.agentId === OUTPUT_QC_AGENT) &&
    state.review?.decision === 'approve' && canonical(state.quality.artifact) === canonical(headQualityArtifact(state));
}

export function validateHeadQuality(value, state, checkedAt) {
  const note = headText(value?.note, 1200), findings = list(value?.findings, 6, 600);
  if (!['pass', 'revise', 'blocked'].includes(value?.decision) || !note || !Array.isArray(value?.findings)) fail('QC did not provide a valid independent verdict.');
  if (state.headAgentId === OUTPUT_QC_AGENT || state.plan?.assignments.some(item => item.agentId === OUTPUT_QC_AGENT)) fail('The creator cannot independently approve their own output.');
  const review = validateHeadReview(state.review, state);
  if (review.decision !== 'approve') fail('QC needs a complete candidate approved by the responsible head.');
  let decision = value.decision, revisionRequests = [];
  if (decision === 'revise') {
    const revision = validateHeadReview({ decision: 'revise', note, revisionRequests: value.revisionRequests }, state);
    decision = revision.decision === 'revise' ? 'revise' : 'blocked';
    revisionRequests = revision.revisionRequests;
  }
  return { reviewerId: OUTPUT_QC_AGENT, decision, note: decision === 'blocked' && value.decision === 'revise' ? `The one automatic revision has already been used. ${note}` : note,
    findings, artifact: headQualityArtifact(state), checkedAt, revisionRequests };
}

/** Keep the head's own team visible even when a brief is short or not in English. */
export function selectHeadSpecialists(agents, departmentId, request) {
  const words = text => new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  const tokens = words(request);
  return agents.map((agent, index) => ({ agent, index, score: (agent.department_id === departmentId ? 4 : 0) + [...words(`${agent.name} ${agent.role_desc} ${agent.department_id}`)].filter(word => tokens.has(word)).length * 5 }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 10)
    .map(({ agent }) => ({ agentId: agent.id, name: headText(agent.name, 160), role: headText(agent.role_desc, 400), department: agent.department_id }));
}

export function validateHeadPlan(value, allowedAgents) {
  const understanding = headText(value?.understanding, 700);
  const successCriteria = list(value?.successCriteria, 5, 400);
  const raw = value?.assignments;
  if (!understanding || !successCriteria.length || !Array.isArray(raw) || raw.length < 1 || raw.length > 2) fail('The head must provide an understanding, success criteria and one or two specific assignments.');
  const allowed = new Set(allowedAgents.map(agent => agent.id)), seen = new Set();
  const assignments = raw.map(item => {
    const agentId = item?.agentId, task = headText(item?.task, 1800), deliverable = headText(item?.deliverable, 500);
    if (typeof agentId !== 'string' || !allowed.has(agentId) || seen.has(agentId) || !task || !deliverable) fail('The plan contains an unavailable, duplicate or incomplete specialist assignment.');
    seen.add(agentId);
    return { agentId, task, deliverable };
  });
  return { understanding, successCriteria, assignments };
}

export function validateHeadOutput(value, evidence, revision = 0) {
  const body = headText(value?.body, 6000), summary = headText(value?.summary, 600);
  if (!body || !summary || typeof value?.blocked !== 'boolean' || !Array.isArray(value?.missing)) fail('The specialist did not return a complete deliverable and explicit missing-input state.');
  const missing = list(value.missing);
  if (value.blocked && !missing.length) missing.push('The specialist marked this contribution blocked; the required input or execution step must be clarified.');
  const sources = new Set(list(value.evidenceSources, 12, 100));
  return { body, summary, evidence: evidence.filter(item => sources.has(item.source)), warnings: list(value.warnings), revision: revision === 1 ? 1 : 0, blocked: value.blocked || missing.length > 0, missing };
}

/** Approval cannot overrule a missing or explicitly blocked contribution. */
export function validateHeadReview(value, state) {
  const decision = value?.decision, note = headText(value?.note, 1200), finalMarkdown = headText(value?.finalMarkdown, 12000);
  if (!['approve', 'revise', 'blocked'].includes(decision) || !note) fail('The head did not return a valid review decision.');
  const assignments = state.plan?.assignments || [];
  const incomplete = assignments.length < 1 || assignments.some(item => !headText(state.outputs?.[item.agentId]?.body) || state.outputs[item.agentId].blocked || state.outputs[item.agentId].missing?.length);
  if (decision === 'approve') {
    if (!finalMarkdown) fail('The head approved without supplying the final deliverable.');
    if (incomplete) return { decision: 'blocked', note: 'The head cannot approve while a specialist contribution has unresolved requirements.', finalMarkdown: '', revisionRequests: [] };
    return { decision, note, finalMarkdown, revisionRequests: [] };
  }
  if (decision === 'blocked') return { decision, note, finalMarkdown, revisionRequests: [] };
  if (state.revisionRound >= 1) return { decision: 'blocked', note: `The one automatic revision has already been used. ${note}`, finalMarkdown: '', revisionRequests: [] };
  const raw = value.revisionRequests;
  if (!Array.isArray(raw) || raw.length !== 1) fail('A revision must target exactly one assigned specialist.');
  const request = raw[0], instruction = headText(request?.instruction, 1800);
  if (!assignments.some(item => item.agentId === request?.agentId) || !instruction) fail('The revision targets an unavailable specialist or has no instruction.');
  return { decision, note, finalMarkdown: '', revisionRequests: [{ agentId: request.agentId, instruction }] };
}

/** A revision only reruns the named worker; completed peers remain checkpointed. */
export function nextHeadWorker(state) {
  const assignments = state.plan?.assignments || [];
  if (state.review?.decision === 'revise') {
    const target = state.review.revisionRequests?.[0]?.agentId;
    return assignments.find(item => item.agentId === target && state.outputs?.[item.agentId]?.revision !== state.revisionRound) || null;
  }
  return assignments.find(item => !state.outputs?.[item.agentId]) || null;
}

/** Called only for an explicit human retry, never by the scheduled worker. */
export function resumeHeadWorkflow(value) {
  if (!value || value.version !== 1) return value;
  const state = structuredClone(value);
  // A failed atomic database handoff must retry only delivery, never generate the work again.
  if (['handoff', 'human_review', 'completed', 'rejected'].includes(state.phase)) return state;
  state.phase = ['plan', 'work', 'review', 'quality'].includes(state.resumePhase) ? state.resumePhase : state.pendingCall?.phase || state.phase;
  if (!['plan', 'work', 'review', 'quality'].includes(state.phase)) state.phase = 'plan';
  if (state.phase !== 'plan' && !state.plan) state.phase = 'plan';
  const blocked = Object.entries(state.outputs || {}).filter(([, output]) => output.blocked || output.missing?.length).map(([id]) => id);
  if (blocked.length && state.plan) {
    for (const id of blocked) delete state.outputs[id];
    state.phase = 'work';
    // This manual retry resumes unresolved work, not the previous automatic revision target.
    if (state.review?.decision === 'revise') delete state.review;
  }
  delete state.pendingCall;
  delete state.resumePhase;
  delete state.blockReason;
  // Retrying QC reuses the exact candidate and its evidence; it must not silently
  // re-review a new source snapshot while claiming the old artifact was checked.
  if (state.phase !== 'quality') {
    delete state.evidenceSnapshot;
    delete state.evidence;
    delete state.observedAt;
  }
  return state;
}

function compact(value, rows, chars, depth = 0) {
  if (typeof value === 'string') return headText(value, chars);
  if (depth > 7) return null;
  if (Array.isArray(value)) return value.slice(0, rows).map(item => compact(item, rows, chars, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, compact(item, rows, chars, depth + 1)]));
  return value;
}

/** Trim samples, never replace absent quantities with zero or silently omit source limits. */
export function compactHeadEvidence(sources, maxChars = 7000) {
  const entries = Object.entries(sources).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value));
  const coverage = 'Only selected recorded sources and bounded samples are included. Missing or omitted records are unknown, never zero. Sources are snapshots, not live checks; read their timestamps and coverage.';
  let result;
  for (const [rows, chars] of [[5, 600], [3, 450], [1, 320]]) {
    result = Object.fromEntries(entries.map(([key, value]) => {
      const rowCap = key === 'categorySales30d' ? rows === 5 ? 8 : rows === 3 ? 7 : 6 : rows;
      return [key, { ...compact(value, rowCap, chars), contextLimit: `${rowCap} displayed rows maximum; longer source text is shortened.` }];
    }));
    if (Array.from(JSON.stringify({ ...result, contextCoverage: coverage })).length <= maxChars) return { ...result, contextCoverage: coverage };
  }
  // Preserve availability/summary/coverage for every selected source before dropping any source.
  result = Object.fromEntries(Object.entries(result).map(([key, value]) => [key, {
    available: value.available, observed_at: value.observed_at, coverage: value.coverage,
    summary: value.summary, data: [], contextLimit: 'Rows omitted to fit the task context. Row values are unknown here; request a narrower task for product-specific work.',
  }]));
  if (Array.from(JSON.stringify({ ...result, contextCoverage: coverage })).length > maxChars) {
    result = Object.fromEntries(Object.entries(result).map(([key, value]) => [key, {
      available: value.available, observed_at: value.observed_at,
      coverage: headText(typeof value.coverage === 'string' ? value.coverage : JSON.stringify(value.coverage), 160),
      summary: compact(value.summary, 2, 120), data: [], contextLimit: 'Rows omitted for context size; product-specific values are unknown here.',
    }]));
  }
  return { ...result, contextCoverage: coverage };
}
