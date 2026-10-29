// Event presentation is independent of animation and never widens private thread access.
const string = value => typeof value === 'string' ? value : null;
export function directDialogueEvent(event) {
  const payload = event.payload || {};
  const from = string(event.from_agent) || string(payload.from_person);
  const to = string(event.to_agent) || string(payload.to_person);
  if (!from || !to || from === to || payload.meeting_id || !['say', 'walk', 'report', 'feedback', 'approval'].includes(event.kind)) return null;
  const privateTask = !!payload.thread_id;
  const isDirect = payload.interaction_mode === 'direct';
  return {
    id: isDirect && string(payload.dialogue_id) || `event:${event.id}`,
    eventId: String(event.id), from, to, at: event.at, text: event.text,
    visitor: isDirect && string(payload.visitor_agent_id) || from,
    recipient: isDirect && string(payload.recipient_agent_id) || to,
    phase: isDirect && payload.dialogue_phase === 'request' ? 'request' : 'response',
    privateTask, threadId: string(payload.thread_id), hostId: string(payload.host_agent_id), messageId: string(payload.message_id),
  };
}

export function authorizedDialogueText(event, snapshot) {
  if (!event.privateTask) return event.text;
  if (!event.threadId || !event.messageId || snapshot?.thread?.id !== event.threadId) return null;
  const message = snapshot.messages?.find(m => String(m.id) === event.messageId && m.agent_id === event.from && m.recipient_agent_id === event.to);
  return typeof message?.content === 'string' ? message.content : null;
}
