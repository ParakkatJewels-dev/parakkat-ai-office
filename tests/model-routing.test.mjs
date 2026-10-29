import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_USE_CASES, preferredTextProvider } from '../src/lib/llm/model-routing.mjs';

test('only explicitly reviewed work is assigned to the smaller text model', () => {
  assert.equal(preferredTextProvider('reviewed_draft', { nimReady:true }), 'nim');
  assert.equal(preferredTextProvider('reviewed_specialist', { nimReady:true }), 'nim');
  for (const useCase of ['decision', 'review', undefined, 'unknown'])
    assert.equal(preferredTextProvider(useCase, { nimReady:true }), 'chatgpt');
  assert.deepEqual(Object.keys(MODEL_USE_CASES).sort(), ['decision','review','reviewed_draft','reviewed_specialist'].sort());
});

test('reviewed work uses ChatGPT when the verified draft model is unavailable', () => {
  assert.equal(preferredTextProvider('reviewed_draft'), 'chatgpt');
  assert.equal(preferredTextProvider('reviewed_specialist', { nimReady:false }), 'chatgpt');
});

test('no draft or decision runs when its ChatGPT quality gate is unavailable', () => {
  for (const useCase of ['reviewed_draft','reviewed_specialist','decision','review',undefined])
    assert.equal(preferredTextProvider(useCase,{chatReady:false,nimReady:true}),'wait');
});
