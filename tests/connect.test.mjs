// Sealing saved platform access, and checking Shopify's signature on its redirect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { keyFrom, seal, open, normalizeShop, shopifyHmacOk } from '../src/lib/connectors/oauth-core.mjs';

test('tokens round-trip and do not open with another key', () => {
  const k = keyFrom('service-key'), box = seal({ access_token: 'abc', refresh_token: 'def' }, k);
  assert.ok(!box.includes('abc'));
  assert.deepEqual(open(box, k), { access_token: 'abc', refresh_token: 'def' });
  assert.throws(() => open(box, keyFrom('other-key')));
  assert.throws(() => open(box.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), k));
});

test('store names become myshopify domains, anything else is refused', () => {
  assert.equal(normalizeShop('Parakkat-Jewels'), 'parakkat-jewels.myshopify.com');
  assert.equal(normalizeShop('https://parakkat-jewels.myshopify.com/admin'), 'parakkat-jewels.myshopify.com');
  assert.equal(normalizeShop('evil.com'), null);
  assert.equal(normalizeShop('a.myshopify.com.evil.com'), null);
});

test('only a redirect signed with our secret passes', () => {
  const secret = 'shh', q = new URLSearchParams({ code: 'c1', shop: 's.myshopify.com', state: 'x', timestamp: '1' });
  const msg = [...q.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  q.set('hmac', createHmac('sha256', secret).update(msg).digest('hex'));
  assert.ok(shopifyHmacOk(q, secret));
  assert.ok(!shopifyHmacOk(q, 'wrong'));
  q.set('shop', 'other.myshopify.com'); assert.ok(!shopifyHmacOk(q, secret));
});
