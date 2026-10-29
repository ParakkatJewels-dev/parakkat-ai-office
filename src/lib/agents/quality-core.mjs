// These gates are deterministic. A negative or missing model verdict cannot pass.
export const qualityBlocked = message => Object.assign(new Error(message), { code: 'quality_blocked' });
export function campaignVerdict(compliance, head) {
  const flags = [];
  if (compliance?.claims?.choice !== 'clean') flags.push('A product claim needs proof or a valid claims review.');
  if (compliance?.policy?.choice !== 'ok') flags.push('A policy concern needs resolution or a valid policy review.');
  if (head?.ok !== true || typeof head?.note !== 'string' || !head.note.trim()) flags.push('The CMO has not explicitly approved the plan.');
  return { passed: flags.length === 0, flags };
}
export function campaignArtifact(plan, creatives) {
  const { quality, ai_review, ...content } = plan || {};
  return { plan: content, creatives: (creatives || []).map(row => ({ id: row.id, headline: row.headline ?? null, body: row.body ?? null,
    image_path: row.image_path ?? null, art_status: row.art_status ?? null })).sort((a,b) => String(a.id).localeCompare(String(b.id))) };
}
const ordered = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(ordered) : Object.fromEntries(Object.keys(value).sort().map(key => [key,ordered(value[key])])) : value;
export function campaignQualityCurrent(plan, creatives) {
  const quality = plan?.quality;
  return quality?.version === 1 && quality.passed === true && quality.claims === 'clean' && quality.policy === 'ok' && quality.cmoApproved === true &&
    Array.isArray(quality.artifact?.creatives) && quality.artifact.creatives.length > 0 &&
    JSON.stringify(ordered(quality.artifact)) === JSON.stringify(ordered(campaignArtifact(plan, creatives)));
}
export function campaignApprovalCurrent(snapshot, plan, creatives) {
  return !!snapshot && campaignQualityCurrent(plan, creatives) && JSON.stringify(ordered(snapshot)) === JSON.stringify(ordered(plan.quality));
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function campaignReviewRequester(run) {
  const request = run?.state?.qualityReviewRequest;
  return ['review','approval'].includes(run?.stage) && uuid.test(request?.requestedBy || '') && uuid.test(request?.approvalId || '') ? request : null;
}
/** A routed human review consumes the manual allowance only for its review cycle. */
export function manualCampaignReview(run, actorRole, approval, now=Date.now()) {
  const request = campaignReviewRequester(run), at = Date.parse(request?.requestedAt || '');
  return !!request && Number.isFinite(at) && at <= now && !!actorRole && actorRole !== 'viewer' &&
    approval?.id === request.approvalId && approval.campaign_id === run.state.campaign_id && approval.status === 'changes' &&
    (actorRole === 'super_admin' || Array.isArray(approval.required_roles) && approval.required_roles.includes(actorRole));
}
export function reportReviewDecision(verdict, revision) {
  if (typeof verdict?.note !== 'string' || !verdict.note.trim()) return { decision:'reject', note:'The lead did not provide a valid review reason.' };
  if (verdict.decision === 'forward') return { decision:'forward', note:verdict.note };
  if (verdict.decision === 'revise' && revision < 2) return { decision:'revise', note:verdict.note };
  return { decision:'reject', note:verdict.decision === 'revise' ? `Revision allowance exhausted; unresolved findings: ${verdict.note}` : verdict.decision === 'reject' ? verdict.note : 'The lead did not provide an explicit valid approval.' };
}
