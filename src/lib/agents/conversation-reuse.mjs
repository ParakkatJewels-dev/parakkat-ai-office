import { createHash } from 'node:crypto';

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => key !== 'observed_at')
    .map(key => [key, stable(value[key])]));
  return value;
};

/** Hash only the evidence actually shown to the model, plus current instructions. */
export function conversationAnswerFingerprint(prompt, system, evidence) {
  return createHash('sha256').update(JSON.stringify(stable({ prompt, system, evidence }))).digest('hex');
}

/** Exact consecutive repeats can reuse a checked answer for five minutes. */
export function reusableConversationAnswer(history, currentTaskId, hostId, prompt, fingerprint, now = Date.now()) {
  if (/\b(?:refresh|retry|again|latest|right now|today|current|updated|new data)\b/i.test(prompt)) return null;
  const messages = (history || []).filter(row => row.task_id !== currentTaskId);
  const previousUser = [...messages].reverse().find(row => row.role === 'user');
  if (!previousUser || previousUser.content !== prompt || !previousUser.task_id) return null;
  const answer = [...messages].reverse().find(row => row.role === 'assistant' && row.task_id === previousUser.task_id && row.metadata?.phase === 'answer');
  if (!answer || answer.agent_id !== hostId || answer.metadata?.evidence_fingerprint !== fingerprint || typeof answer.content !== 'string') return null;
  const at = Date.parse(answer.created_at || '');
  return Number.isFinite(at) && now >= at && now - at <= 300_000 ? answer.content : null;
}
