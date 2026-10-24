// How long the Shopify sync waits between queries, from what Shopify reports about its query budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isThrottled, waitMs } from '../src/lib/connectors/shopify-limits.mjs';

const cost = (available, requested = 200) => ({ requestedQueryCost: requested, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: available, restoreRate: 100 } });

test('spots a throttled answer', () => {
  assert.ok(isThrottled({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }));
  assert.ok(!isThrottled({ data: {} }));
  assert.ok(!isThrottled({ errors: [{ message: 'other' }] }));
});

test('no wait while the budget is healthy, a wait when it runs low', () => {
  assert.equal(waitMs(cost(1500)), 0);
  assert.equal(waitMs(cost(100)), 3100); // (400 - 100) / 100 per second, plus a little margin
});

test('after a throttle, waits until this query can be paid for, or backs off when Shopify gave no figures', () => {
  assert.equal(waitMs(cost(50), { throttled: true }), 1600);
  assert.equal(waitMs(undefined, { throttled: true, attempt: 0 }), 1000);
  assert.equal(waitMs(undefined, { throttled: true, attempt: 3 }), 8000);
  assert.equal(waitMs(undefined, { throttled: true, attempt: 10 }), 30000);
});
