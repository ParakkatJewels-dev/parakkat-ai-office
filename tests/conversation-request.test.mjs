import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConversationRequest } from '../src/lib/agents/conversation-request.mjs';

test('lost create response followed by automatic thread discovery retries the original request', () => {
  const first = prepareConversationRequest(null, { message: 'Review last week’s ads', threadId: null, meeting: false }, () => 'first-nonce');
  // The POST succeeded, but its response was lost. GET then discovers the new thread.
  const retry = prepareConversationRequest(first.pending, { message: 'Review last week’s ads', threadId: 'discovered-thread', meeting: false }, () => assert.fail('retry must not create another nonce'));
  assert.deepEqual(retry.body, first.body);
  assert.equal(retry.body.threadId, undefined);
  assert.equal(JSON.stringify(retry.body), JSON.stringify(first.body));
});

test('lost follow-up response retains its original thread even if background state changes', () => {
  const first = prepareConversationRequest(null, { message: 'Summarize the findings', threadId: 'thread-one', meeting: true }, () => 'first-nonce');
  const retry = prepareConversationRequest(first.pending, { message: ' Summarize the findings ', threadId: 'thread-two', meeting: true }, () => assert.fail('retry must reuse the original request'));
  assert.deepEqual(retry.body, first.body);
  assert.equal(retry.body.threadId, 'thread-one');
});

test('an explicit conversation selection clears pending work and starts a new request', () => {
  const next = prepareConversationRequest(null, { message: 'Review last week’s ads', threadId: 'chosen-thread', meeting: false }, () => 'new-nonce');
  assert.equal(next.body.threadId, 'chosen-thread');
  assert.equal(next.body.clientId, 'new-nonce');
});

test('a changed task or meeting choice receives a new nonce in the current thread', () => {
  const first = prepareConversationRequest(null, { message: 'Review ads', threadId: null, meeting: false }, () => 'first-nonce');
  const changedTask = prepareConversationRequest(first.pending, { message: 'Review product sales', threadId: 'current-thread', meeting: false }, () => 'task-nonce');
  const changedMeeting = prepareConversationRequest(first.pending, { message: 'Review ads', threadId: 'current-thread', meeting: true }, () => 'meeting-nonce');
  assert.deepEqual(changedTask.body, { message: 'Review product sales', threadId: 'current-thread', clientId: 'task-nonce', meeting: false });
  assert.deepEqual(changedMeeting.body, { message: 'Review ads', threadId: 'current-thread', clientId: 'meeting-nonce', meeting: true });
});
