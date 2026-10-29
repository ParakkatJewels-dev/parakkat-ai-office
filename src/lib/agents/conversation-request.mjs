/**
 * Keep an unresolved submission intact after a lost HTTP response. A background
 * refresh may discover its newly created thread, but retrying must still send
 * the original nonce AND thread value. Explicit conversation selection clears
 * `pending` in the UI; a changed task or meeting choice is a new submission.
 */
export function prepareConversationRequest(pending, input, makeId) {
  const text = input.message.trim();
  const sameRequest = pending?.text === text && pending.meeting === input.meeting;
  const request = sameRequest ? pending : { text, thread: input.threadId || null, meeting: input.meeting, id: makeId() };
  return {
    pending: request,
    body: { message: request.text, threadId: request.thread || undefined, clientId: request.id, meeting: request.meeting },
  };
}
