// Estimating what each AI or API call costs, and knowing which agent made it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, costUsd, agentFromPrompt } from '../src/lib/usage-cost.mjs';

const P = { 'openai:gpt-4.1': { in_per_m: 2, out_per_m: 8, per_unit: 0 }, 'openai:*': { in_per_m: 5, out_per_m: 15, per_unit: 0 }, 'serpapi:*': { in_per_m: 0, out_per_m: 0, per_unit: 0.015 } };

test('the exact model wins, then the provider default, then free', () => {
  assert.equal(priceFor(P, 'openai', 'gpt-4.1').in_per_m, 2);
  assert.equal(priceFor(P, 'openai', 'gpt-9').in_per_m, 5);
  assert.deepEqual(priceFor(P, 'jev', 'x'), { in_per_m: 0, out_per_m: 0, per_unit: 0 });
});

test('tokens are priced per million and calls per unit', () => {
  assert.equal(costUsd(P['openai:gpt-4.1'], { input: 1000, output: 500, units: 1 }), 0.006);
  assert.equal(costUsd(P['serpapi:*'], { units: 4 }), 0.06);
});

test('the agent comes from the first line of its prompt', () => {
  const people = [{ id: 'cmo', name: 'AI Chief Marketing Officer' }, { id: 'sales', name: 'Sales Analyst' }];
  assert.equal(agentFromPrompt('You are Sales Analyst at Parakkat Jewels, a Kerala...', people).id, 'sales');
  assert.equal(agentFromPrompt('You classify marketing data.', people), null);
});
