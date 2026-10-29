import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationRoutingCandidates, deterministicConversationRoute, conversationRoutingQuestion, acceptedConversationRoute, routedConversationPlan } from '../src/lib/agents/conversation-routing.mjs';
import { conversationAnswerFingerprint, reusableConversationAnswer } from '../src/lib/agents/conversation-reuse.mjs';

const host = { id: 'creativeDirector', name: 'Creative Director', role_desc: 'Creative strategy head', department_id: 'creative', is_lead: true, enabled: true };
const agents = [host,
  { id: 'copywriter', name: 'Copywriter', role_desc: 'Campaign copy and headlines', department_id: 'creative', enabled: true },
  { id: 'analyst', name: 'Sales Analyst', role_desc: 'Product-level sales', department_id: 'insights', enabled: true },
  { id: 'disabled', name: 'Designer', role_desc: 'Banners', department_id: 'creative', enabled: false }];

test('explicit one-to-one requests route only to the named accessible colleague; meetings keep the full plan', () => {
  assert.deepEqual(deterministicConversationRoute('Ask Copywriter for three headlines', host, agents), { kind: 'specialist', agentId: 'copywriter' });
  assert.equal(deterministicConversationRoute('Ask Designer for a banner', host, agents), null);
  assert.equal(deterministicConversationRoute('Ask Copywriter for three headlines', host, agents, true), null);
  assert.deepEqual(deterministicConversationRoute('Why did sales change?', host, agents), { kind: 'direct' });
  assert.deepEqual(routedConversationPlan({ kind: 'direct' }).delegations, []);
  assert.equal(routedConversationPlan({ kind: 'specialist', agentId: 'copywriter' }).delegations[0].agentId, 'copywriter');
});

test('Jev suggestions must clear confidence and margin gates and select a listed colleague', () => {
  const candidates = conversationRoutingCandidates('Write a campaign headline', host, agents);
  assert.equal(candidates[0].id, 'copywriter');
  assert.ok(!candidates.some(agent => agent.id === 'disabled'));
  const question = conversationRoutingQuestion(candidates);
  assert.deepEqual(Object.keys(question.route.criteria).sort(), ['analyst', 'copywriter', 'direct']);
  const good = { route: { choice: 'copywriter', confidence: 0.92, probabilities: { copywriter: 0.9, direct: 0.08, analyst: 0.02 } } };
  assert.deepEqual(acceptedConversationRoute(good, candidates), { kind: 'specialist', agentId: 'copywriter' });
  assert.equal(acceptedConversationRoute({ route: { ...good.route, confidence: 0.7 } }, candidates), null);
  assert.equal(acceptedConversationRoute({ route: { ...good.route, probabilities: { copywriter: 0.7, direct: 0.2, analyst: 0.1 } } }, candidates), null);
  assert.equal(acceptedConversationRoute({ route: { ...good.route, probabilities: { copywriter: 0.51, direct: 0.49, analyst: 0 } } }, candidates), null);
  assert.equal(acceptedConversationRoute({ route: { ...good.route, choice: 'disabled' } }, candidates), null);
});

test('a repeated direct answer reuses only matching current evidence, instructions, agent and fresh task', () => {
  const prompt = 'Explain recorded sales';
  const facts = { performance: { observed_at: '2026-10-27T10:00:00Z', coverage: 'Shopify', data: { units: 174 } } };
  const fingerprint = conversationAnswerFingerprint(prompt, 'Agent identity: sales\nInstructions v1', facts);
  assert.equal(fingerprint, conversationAnswerFingerprint(prompt, 'Agent identity: sales\nInstructions v1', { performance: { ...facts.performance, observed_at: '2026-10-27T10:01:00Z' } }));
  assert.notEqual(fingerprint, conversationAnswerFingerprint(prompt, 'Agent identity: sales\nInstructions v2', facts));
  assert.notEqual(fingerprint, conversationAnswerFingerprint(prompt, 'Agent identity: sales\nInstructions v1', { performance: { ...facts.performance, data: { units: 175 } } }));
  const now = Date.parse('2026-10-27T10:02:00Z');
  const history = [
    { task_id: 'old', role: 'user', content: prompt, created_at: '2026-10-27T10:00:00Z' },
    { task_id: 'old', role: 'assistant', agent_id: 'sales', content: '174 recorded units.', created_at: '2026-10-27T10:00:30Z', metadata: { phase: 'answer', evidence_fingerprint: fingerprint } },
    { task_id: 'new', role: 'user', content: prompt, created_at: '2026-10-27T10:02:00Z' },
  ];
  assert.equal(reusableConversationAnswer(history, 'new', 'sales', prompt, fingerprint, now), '174 recorded units.');
  assert.equal(reusableConversationAnswer(history, 'new', 'another', prompt, fingerprint, now), null);
  assert.equal(reusableConversationAnswer(history, 'new', 'sales', prompt, 'changed', now), null);
  assert.equal(reusableConversationAnswer(history, 'new', 'sales', prompt, fingerprint, now + 301_000), null);
  assert.equal(reusableConversationAnswer(history, 'new', 'sales', 'Refresh recorded sales', fingerprint, now), null);
});
