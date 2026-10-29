// Bounded, provider-independent conversation flow. Callbacks persist only completed model turns.
export const MAX_SPECIALISTS = 2;
export const MAX_REPLY_CHARS = 6000;

export function conversationText(value, max = MAX_REPLY_CHARS) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '';
}

export function normalizeConversationPlan(value, agents, hostId, forceMeeting = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_plan');
  const allowed = new Map(agents.filter(a => a.id !== hostId && a.enabled !== false).map(a => [a.id, a]));
  const seen = new Set(), delegations = [];
  for (const d of Array.isArray(value.delegations) ? value.delegations : []) {
    if (!d || typeof d !== 'object' || !allowed.has(d.agentId) || seen.has(d.agentId)) continue;
    const task = conversationText(d.task, 1600);
    if (!task) continue;
    seen.add(d.agentId); delegations.push({ agentId: d.agentId, task });
    if (delegations.length === (forceMeeting ? MAX_SPECIALISTS : 1)) break;
  }
  // A user-requested meeting has a real second participant, even when the planner returned no delegation.
  if (forceMeeting && !delegations.length) {
    const host = agents.find(a => a.id === hostId);
    const colleague = [...allowed.values()].find(a => a.department_id === host?.department_id && a.is_lead)
      || [...allowed.values()].find(a => a.department_id === host?.department_id) || [...allowed.values()][0];
    if (colleague) delegations.push({ agentId: colleague.id, task: 'Review the user’s request from your speciality. Respond to the host’s opening, identify gaps, and give a concrete recommendation.' });
  }
  return {
    title: conversationText(value.title, 120) || 'Team discussion',
    opening: conversationText(value.opening, 1600) || 'Let’s review the request, compare the evidence, and agree the next steps.',
    answer: conversationText(value.answer), delegations,
  };
}

export function normalizeConversationReply(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_reply');
  const reply = conversationText(value.reply);
  if (!reply) throw new Error('invalid_reply');
  return reply;
}

/** A department-visible animation contains routing only; the actual dialogue stays in the private thread. */
export function conversationDialogueEvent(message, { taskId, threadId, hostAgentId, messageId }) {
  if (message.metadata?.interaction_mode !== 'direct' || message.meetingId) return null;
  const phase = message.metadata?.dialogue_phase;
  const request = phase === 'request' && message.role === 'handoff' && message.agentId === hostAgentId;
  const response = phase === 'response' && message.role === 'assistant' && message.recipientAgentId === hostAgentId;
  if ((!request && !response) || !message.recipientAgentId || message.agentId === message.recipientAgentId) return null;
  const specialistId = request ? message.recipientAgentId : message.agentId;
  return {
    kind: request ? 'walk' : 'report', from: message.agentId, to: message.recipientAgentId,
    text: request ? 'Requested a colleague’s contribution to a private task.' : 'Returned a completed contribution to a private task.',
    payload: { interaction_mode: 'direct', dialogue_phase: phase, dialogue_id: `${taskId}:${specialistId}`,
      visitor_agent_id: hostAgentId, recipient_agent_id: specialistId, host_agent_id: hostAgentId,
      task_id: taskId, thread_id: threadId, message_id: messageId },
  };
}

/**
 * At most four model calls: host plan, two specialists, host synthesis. Specialists receive previous
 * completed turns, so a meeting is a discussion rather than unrelated simulated messages.
 */
export async function coordinateConversation({ host, agents, prompt, meetingRequested, ask, message, startMeeting, finishMeeting }) {
  await message({ role: 'progress', agentId: host.id, content: 'Reviewing your request and the latest work I can access.' });
  const raw = await ask(host, { phase: 'plan', prompt, agents, meetingRequested, transcript: [] });
  const plan = normalizeConversationPlan(raw, agents, host.id, meetingRequested);
  let meetingId = null;
  const transcript = [];
  if (meetingRequested && plan.delegations.length) {
    meetingId = await startMeeting(plan.title, [host.id, ...plan.delegations.map(d => d.agentId)]);
    await message({ role: 'meeting', agentId: host.id, content: plan.opening, meetingId, metadata: { phase: 'opening' } });
    transcript.push({ agentId: host.id, name: host.name, content: plan.opening });
  }
  if (plan.delegations.length) {
    for (const delegation of plan.delegations) {
      const specialist = agents.find(a => a.id === delegation.agentId);
      if (!specialist) throw new Error('unavailable_agent');
      await message({ role: 'handoff', agentId: host.id, recipientAgentId: specialist.id, content: delegation.task, meetingId,
        metadata: meetingId ? { phase: 'assignment' } : { phase: 'assignment', interaction_mode: 'direct', dialogue_phase: 'request' } });
      if (!meetingId) transcript.push({ agentId: host.id, name: host.name, content: delegation.task });
      const reply = normalizeConversationReply(await ask(specialist, {
        phase: 'specialist', prompt, assignment: delegation.task, agents: [], meetingRequested,
        transcript: transcript.map(t => ({ ...t })),
      }));
      await message({ role: meetingId ? 'meeting' : 'assistant', agentId: specialist.id, recipientAgentId: host.id, content: reply, meetingId,
        metadata: meetingId ? { phase: 'contribution' } : { phase: 'contribution', interaction_mode: 'direct', dialogue_phase: 'response' } });
      transcript.push({ agentId: specialist.id, name: specialist.name, content: reply });
    }
  }
  // An answer without handoffs is allowed in the planning response; there are no pretend meetings.
  const reply = !plan.delegations.length && plan.answer ? plan.answer : normalizeConversationReply(await ask(host, {
    phase: 'final', prompt, agents: [], meetingRequested, transcript: transcript.map(t => ({ ...t })),
  }));
  await message({ role: 'assistant', agentId: host.id, content: reply, meetingId, metadata: { phase: 'answer', outcome: 'analysis_or_draft' } });
  if (meetingId) await finishMeeting(meetingId, reply);
  return { reply, meetingId, participants: [host.id, ...plan.delegations.map(d => d.agentId)] };
}

/** Model/provider exception text is never copied into user-visible messages. */
export function conversationFailure(error) {
  const code = error && typeof error === 'object' ? error.code : null;
  const name = error && typeof error === 'object' ? error.name : null;
  if (name === 'Paused') return 'The agents are paused. Resume them in Admin before sending another task.';
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'deadline') return 'This task reached its time limit. Completed contributions are saved; send a shorter follow-up to continue.';
  if (code === 'ai_budget') {
    if (error.reason === 'input_too_long') return 'This task exceeds the AI Office text input limit. Shorten the request or narrow its evidence/date range before trying again. Completed contributions are saved.';
    if (error.reason === 'request_exceeds_token_limit') return 'This task is larger than the configured text-token allowance. Shorten it or ask an administrator to review the text budget. Completed contributions are saved.';
    if (error.reason === 'budget_unavailable') return 'The AI Office text budget could not be checked. Completed contributions are saved. Ask an administrator to check Automations → Recurring before retrying.';
    const retry=Date.parse(error.retryAt || '');
    return `AI Office has reached its configured text-work allowance. Completed contributions are saved.${Number.isFinite(retry)?` The rolling allowance may become available at ${new Date(retry).toISOString()}.`:''} Check Automations → Recurring for the app budget before sending a follow-up.`;
  }
  if (code === 'usage_limit' || code === 'usage_paused') return 'The connected ChatGPT account has reached its app usage limit. Review ChatGPT usage in Settings → AI providers before trying again.';
  if (code === 'routing_unavailable') return 'Jev could not route this task. Check its status in Settings → AI providers before retrying; no second model request was sent.';
  if (code === 'authentication' || code === 'permission' || code === 'access') return 'Your access or the agent connection is unavailable. Refresh the page and check Settings → AI providers.';
  if (code === 'agent_disabled') return 'This agent is disabled. Enable it before sending another task.';
  return 'I could not finish this task. Any completed contributions are saved. Please try again with a shorter request.';
}
