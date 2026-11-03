import test from 'node:test';
import assert from 'node:assert/strict';
import { characterMotion } from '../src/office/character-motion.mjs';
import { forwardLabelWheel } from '../src/office/map-input.mjs';

const person = { phase: .4, sitting: true, path: [], status: 'idle' };

test('desk work types, conversation gestures alternate, and a visit starts with a handshake', () => {
  const typing = characterMotion(person, 1, 'working');
  assert.equal(typing.mode, 'typing');
  assert.notEqual(typing.elbowsX[0], typing.elbowsX[1]);
  const speaking = { ...person, status: 'talking' };
  assert.equal(characterMotion(speaking, 1, 'working').mode, 'speaking');
  assert.notEqual(characterMotion(speaking, 1, null).armsX[1], characterMotion(speaking, 3.3, null).armsX[1]);
  const greeting = { ...person, visitId: 'visit', greetingAt: 1, greetingSide: 0 };
  assert.equal(characterMotion(greeting, 2, null).mode, 'greeting');
  assert.ok(characterMotion(greeting, 2, null).armsX[0] < -1);
  assert.equal(characterMotion(greeting, 3.4, null).mode, 'resting');
});

test('walking moves limbs; reduced motion holds a stable pose', () => {
  const walker = { ...person, sitting: false, path: [{ x: 1, z: 2 }] };
  assert.equal(characterMotion(walker, 1, null).mode, 'walking');
  assert.notEqual(characterMotion(walker, 1, null).legsX[0], characterMotion(walker, 1, null).legsX[1]);
  assert.deepEqual(characterMotion(walker, 1, null, true), characterMotion(walker, 8, null, true));
});

test('wheel over an agent label reaches the map canvas with pointer and trackpad data', () => {
  let sent, prevented = false;
  class FakeWheelEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  const event = { deltaX: 1, deltaY: -92, deltaZ: 0, deltaMode: 0, clientX: 230, clientY: 180, ctrlKey: true, shiftKey: false, preventDefault() { prevented = true; } };
  forwardLabelWheel(event, { dispatchEvent(e) { sent = e; } }, FakeWheelEvent);
  assert.equal(prevented, true);
  assert.equal(sent.type, 'wheel');
  for (const key of ['deltaX', 'deltaY', 'deltaMode', 'clientX', 'clientY', 'ctrlKey']) assert.equal(sent[key], event[key]);
});
