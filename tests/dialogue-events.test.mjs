import test from 'node:test';
import assert from 'node:assert/strict';
import { directDialogueEvent, authorizedDialogueText } from '../src/office/dialogue-events.mjs';

const event = { id: 8, at: '2026-10-26T12:00:00Z', kind: 'report', from_agent: 'sales', to_agent: 'cmo', text: 'Returned a contribution.', payload: {
  interaction_mode: 'direct', dialogue_phase: 'response', dialogue_id: 'task:sales', visitor_agent_id: 'cmo', recipient_agent_id: 'sales', host_agent_id: 'cmo', thread_id: 'private-thread', message_id: 'private-message',
} };

test('a reply keeps the visitor and desk anchored while the recipient speaks', () => {
  const result = directDialogueEvent(event);
  assert.equal(result.visitor, 'cmo'); assert.equal(result.recipient, 'sales');
  assert.equal(result.from, 'sales'); assert.equal(result.to, 'cmo'); assert.equal(result.id, 'task:sales');
});

test('only an exact authorized thread and directed message can supply private text', () => {
  const direct = directDialogueEvent(event), message = { id: 'private-message', agent_id: 'sales', recipient_agent_id: 'cmo', content: 'Actual contribution' };
  const snapshot = { thread: { id: 'private-thread' }, messages: [message] };
  assert.equal(authorizedDialogueText(direct, snapshot), 'Actual contribution');
  assert.equal(authorizedDialogueText(direct, null), null);
  assert.equal(authorizedDialogueText(direct, { ...snapshot, thread: { id: 'someone-else' } }), null);
  for (const change of [{ id: 'other-message' }, { agent_id: 'cmo' }, { recipient_agent_id: 'sales' }]) {
    assert.equal(authorizedDialogueText(direct, { ...snapshot, messages: [{ ...message, ...change }] }), null);
  }
});

test('public reports to human heads use the payload recipient and do not need private reads', () => {
  const direct = directDialogueEvent({ ...event, to_agent: null, text: 'The review is ready.', payload: { to_person: 'creativeHead' } });
  assert.equal(direct.recipient, 'creativeHead'); assert.equal(direct.privateTask, false);
  assert.equal(authorizedDialogueText(direct, null), 'The review is ready.');
});

test('meeting events, thoughts, and self messages never start desk visits', () => {
  assert.equal(directDialogueEvent({ ...event, payload: { ...event.payload, meeting_id: 'meeting' } }), null);
  assert.equal(directDialogueEvent({ ...event, kind: 'think' }), null);
  assert.equal(directDialogueEvent({ ...event, to_agent: 'sales' }), null);
});
