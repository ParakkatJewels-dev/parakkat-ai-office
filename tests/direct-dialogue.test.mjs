import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectDialogueController, dialogueBubble, dialogueDuration } from '../src/office/direct-dialogue.mjs';

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function setup(overrides = {}) {
  let time = 1_000_000, nextTimer = 0;
  const timers = new Map(), calls = [];
  const adapter = {
    hasAgent: id => ['a', 'b', 'c', 'd', 'e'].includes(id),
    arrive: async s => { calls.push(['arrive', s.id]); return true; },
    speak: async (s, t) => { calls.push(['speak', s.id, t.speakerId, t.text]); return true; },
    leave: async (s, status) => { calls.push(['leave', s.id, status.interrupted, status.isBlocked(s.visitorId), status.isBlocked(s.recipientId)]); },
    ...overrides,
  };
  const controller = createDirectDialogueController(adapter, {
    now: () => time,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const send = (id, phase = 'request', extra = {}) => controller.directDialogue({ id, visitorId: 'a', recipientId: 'b', speakerId: phase === 'response' ? 'b' : 'a', text: `${phase} text`, phase, createdAt: time, ...extra });
  const advance = async ms => { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time && timers.delete(id)) timer.fn(); await flush(); };
  return { controller, send, calls, advance, timers };
}

test('a real request holds both agents at the desk until its real reply, then returns home', async () => {
  const { controller, send, calls } = setup(), states = [];
  assert.equal(await send('task', 'request', { onState: state => states.push(state) }), true);
  assert.equal(controller.isReserved('a'), true);
  assert.equal(controller.isReserved('b'), true);
  assert.deepEqual(states, ['queued', 'walking', 'talking', 'waiting']);
  assert.equal(calls.some(c => c[0] === 'leave'), false);
  assert.equal(await send('task', 'response'), true);
  assert.deepEqual(calls.filter(c => c[0] === 'speak').map(c => c[2]), ['a', 'b']);
  assert.deepEqual(states.slice(-3), ['talking', 'returning', 'complete']);
  assert.equal(controller.isReserved('a'), false);
  assert.equal(controller.isReserved('b'), false);
});

test('visits sharing a recipient queue; disjoint pairs can proceed without double reservation', async () => {
  const { controller, send, calls } = setup();
  await send('first');
  const second = send('second', 'single', { visitorId: 'c', speakerId: 'c' });
  const independent = send('independent', 'single', { visitorId: 'd', recipientId: 'e', speakerId: 'd' });
  assert.equal(await independent, true);
  assert.equal(calls.some(c => c[0] === 'arrive' && c[1] === 'second'), false);
  await send('first', 'response');
  assert.equal(await second, true);
  assert.ok(calls.findIndex(c => c[0] === 'leave' && c[1] === 'first') < calls.findIndex(c => c[0] === 'arrive' && c[1] === 'second'));
  assert.equal(controller.isReserved('c'), false);
});

test('return-home completion keeps reservations until the next visitor can safely begin', async () => {
  let finishReturn;
  const { send, calls, controller } = setup({ leave: (s) => s.id === 'first' ? new Promise(resolve => { finishReturn = resolve; }) : Promise.resolve() });
  const first = send('first', 'single'); await flush();
  const second = send('second', 'single', { visitorId: 'c', speakerId: 'c' });
  assert.equal(controller.isReserved('b'), true);
  assert.equal(calls.some(c => c[0] === 'arrive' && c[1] === 'second'), false);
  finishReturn();
  assert.equal(await first, true); assert.equal(await second, true);
});

test('a stalled return cannot retain both participants indefinitely', async () => {
  let returnSignal;
  const { send, controller, advance } = setup({ leave: (_s, { signal }) => { returnSignal = signal; return new Promise(() => {}); } });
  const visit = send('stalled-return', 'single'); await flush();
  assert.equal(controller.isReserved('b'), true);
  await advance(60_001);
  assert.equal(returnSignal.aborted, true);
  assert.equal(await visit, false);
  assert.equal(controller.isReserved('a'), false);
  assert.equal(controller.isReserved('b'), false);
});

test('explicit meetings preempt affected visits and leave unrelated visits running', async () => {
  const { controller, send, calls } = setup(), states = [];
  await send('meeting-conflict', 'request', { onState: s => states.push(s) });
  await send('unrelated', 'request', { visitorId: 'c', recipientId: 'd', speakerId: 'c' });
  controller.setMeetingParticipants(['b']); await flush();
  assert.equal(states.at(-1), 'interrupted');
  assert.equal(controller.isReserved('a'), false);
  assert.equal(controller.isReserved('c'), true);
  assert.deepEqual(calls.find(c => c[0] === 'leave' && c[1] === 'meeting-conflict'), ['leave', 'meeting-conflict', true, false, true]);
  assert.equal(await send('new-conflict', 'single'), false);
  controller.setMeetingParticipants([]);
  assert.equal(await send('meeting-conflict', 'response'), false); // Never replay interrupted work after the meeting.
  await send('unrelated', 'response', { visitorId: 'c', recipientId: 'd', speakerId: 'd' });
});

test('meeting cancellation resolves an in-flight walk without speaking or completing the old visit', async () => {
  const states = [];
  const { controller, send, calls } = setup({ arrive: (_s, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true })) });
  const pending = send('walking', 'single', { onState: s => states.push(s) });
  controller.setMeetingParticipants(['a']);
  assert.equal(await pending, false); await flush();
  assert.equal(calls.some(c => c[0] === 'speak'), false);
  assert.deepEqual(states, ['queued', 'walking', 'interrupted']);
  assert.equal(controller.isReserved('a'), false);
});

test('failed/canceled movement never displays dialogue at the wrong desk', async () => {
  const { send, calls, controller } = setup({ arrive: async () => false });
  assert.equal(await send('failed', 'single'), false); await flush();
  assert.equal(calls.some(c => c[0] === 'speak'), false);
  assert.equal(controller.isReserved('b'), false);
});

test('out-of-order response is one truthful exchange and a late request never replays', async () => {
  const { send, calls } = setup();
  assert.equal(await send('out-of-order', 'response'), true);
  assert.equal(await send('out-of-order', 'request'), false);
  assert.equal(calls.filter(c => c[0] === 'speak').length, 1);
});

test('duplicate phases and mismatched physical anchors cannot create duplicate or redirected speech', async () => {
  const { send, calls, controller } = setup();
  const first = send('same');
  assert.equal(send('same'), first);
  await first;
  assert.equal(await send('same', 'response', { visitorId: 'c' }), false);
  assert.equal(await send('same', 'single'), false);
  await send('same', 'response');
  assert.equal(await send('same', 'response'), false);
  assert.equal(calls.filter(c => c[0] === 'speak').length, 2);
  controller.dispose();
});

test('queued and waiting visits expire without fake replies or indefinite locks', async () => {
  const { controller, send, advance, calls } = setup(), states = [];
  await send('waiting', 'request', { onState: s => states.push(s) });
  const queued = send('queued', 'single', { visitorId: 'c', speakerId: 'c' });
  await advance(90_001);
  assert.equal(await queued, false);
  assert.equal(calls.some(c => c[0] === 'arrive' && c[1] === 'queued'), false);
  await advance(30_000);
  assert.equal(states.at(-1), 'interrupted');
  assert.equal(calls.filter(c => c[0] === 'speak').length, 1);
  assert.equal(controller.isReserved('b'), false);
});

test('stale, future, invalid, and unknown-agent events are rejected before animation', async () => {
  const { send, calls } = setup();
  for (const extra of [{ createdAt: 1 }, { createdAt: 1_040_000 }, { createdAt: 'not a date' }, { recipientId: 'unknown' }, { recipientId: 'a' }, { speakerId: 'c' }, { text: '  ' }]) {
    assert.equal(await send('invalid', 'single', extra), false);
  }
  assert.deepEqual(calls, []);
});

test('access cancellation suppresses future callbacks and disposal releases all work', async () => {
  const { send, controller, timers } = setup(), states = [];
  await send('private', 'request', { onState: s => states.push(s) });
  const count = states.length;
  assert.equal(controller.cancelDialogue('private'), true); await flush();
  assert.equal(states.length, count);
  assert.equal(controller.isReserved('a'), false);
  await send('other', 'request');
  controller.dispose(); await flush();
  assert.equal(controller.isReserved('b'), false);
  assert.equal(timers.size, 0);
  assert.equal(await send('after-dispose', 'single'), false);
});

test('UI callback exceptions and animation failures still return and release participants', async () => {
  const { send, controller } = setup({ speak: async () => { throw Error('render interrupted'); } });
  assert.equal(await send('bad-ui', 'single', { onState: () => { throw Error('UI interrupted'); } }), false); await flush();
  assert.equal(controller.isReserved('a'), false);
});

test('long private turns have a bounded Unicode-safe bubble and 4–8 second speech', () => {
  const text = '💎'.repeat(6000), bubble = dialogueBubble(text);
  assert.ok(Array.from(bubble).length <= 240);
  assert.equal(bubble.endsWith('…'), true);
  assert.equal(bubble.includes('\uFFFD'), false);
  assert.equal(dialogueDuration(text), 8_000);
  assert.equal(dialogueDuration('Hello'), 4_000);
  assert.equal(dialogueBubble(' a\n  b '), 'a b');
});
