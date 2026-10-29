/** A route only chooses who contributes. It never approves a business answer. */
const cue = /\b(?:ask|have|involve|coordinate with|work with|delegate to|assign to|send to)\b/i;
const directQuestion = /^\s*(?:what|why|how|when|where|which|who|explain|show|summari[sz]e|tell me|can you tell me)\b/i;

export function conversationRoutingCandidates(prompt, host, agents) {
  const text = String(prompt || '').toLowerCase();
  const words = new Set(text.match(/[\p{L}\p{N}]{3,}/gu) || []);
  return (agents || []).filter(agent => agent.enabled !== false && agent.id !== host.id)
    .map((agent, index) => ({ agent, index, score: [...new Set(String(`${agent.name} ${agent.role_desc || ''} ${agent.department_id || ''}`).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(word => words.has(word)).length * 5 + (agent.department_id === host.department_id ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 5).map(({ agent }) => agent);
}

export function deterministicConversationRoute(prompt, host, agents, meetingRequested = false) {
  if (meetingRequested) return null;
  const request = String(prompt || '').trim();
  if (cue.test(request)) {
    const named = (agents || []).filter(agent => agent.enabled !== false && agent.id !== host.id &&
      new RegExp(`\\b${String(agent.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(request));
    if (named.length === 1) return { kind: 'specialist', agentId: named[0].id };
    return null;
  }
  if (!host.is_lead || directQuestion.test(request)) return { kind: 'direct' };
  return null;
}

export function conversationRoutingQuestion(candidates) {
  return { route: {
    instructions: 'Choose direct unless this task clearly needs a distinct specialist contribution before the host can answer. Choose only one named available specialist. The host still checks the final answer.',
    criteria: { direct: 'The host can answer or prepare the requested deliverable with the supplied evidence and its own expertise.',
      ...Object.fromEntries(candidates.map(agent => [agent.id, `${agent.name}: ${String(agent.role_desc || '').slice(0, 160)}; department ${agent.department_id}. Choose only for a distinct needed contribution.`])) },
  } };
}

export function acceptedConversationRoute(answer, candidates) {
  const route = answer?.route;
  if (!route || typeof route.confidence !== 'number' || route.confidence < 0.88) return null;
  const probabilities = route.probabilities || {};
  const selected = probabilities[route.choice];
  const runnerUp = Math.max(0, ...Object.entries(probabilities).filter(([name]) => name !== route.choice).map(([, value]) => Number(value) || 0));
  if (!Number.isFinite(selected) || selected < 0.85 || selected - runnerUp < 0.2) return null;
  if (route.choice === 'direct') return { kind: 'direct' };
  if (candidates.some(agent => agent.id === route.choice)) return { kind: 'specialist', agentId: route.choice };
  return null;
}

export function routedConversationPlan(route) {
  return route.kind === 'direct' ? { title: 'Direct answer', delegations: [], answer: '' }
    : { title: 'Specialist contribution', delegations: [{ agentId: route.agentId, task: 'Provide a distinct, evidence-grounded contribution from your specialist role for the manager request. State unknowns clearly.' }], answer: '' };
}
