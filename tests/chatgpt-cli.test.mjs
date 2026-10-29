import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { callbackMatches, login, parseArgs } from '../scripts/chatgpt.mjs';

test('CLI requires explicit account/model arguments and rejects conflicting login choices', () => {
  assert.deepEqual(parseArgs(['login', '--new-account', '--no-open', '--port', '1456']).options, { 'new-account': true, 'no-open': true, port: '1456' });
  for (const args of [['use'], ['login', '--account', 'a', '--new-account'], ['login', '--port', '0'], ['login', '--port', '1455x'], ['set-models', '--manager', 'one'], ['models', 'unexpected']]) {
    assert.throws(() => parseArgs(args));
  }
  assert.equal(parseArgs(['resume', 'account-a']).positional[0], 'account-a');
});

test('loopback callback rejects wrong host, origin, method, path, state, and duplicate state', () => {
  const transaction = { redirectUri: 'http://127.0.0.1:1455/auth/callback', state: 'expected-state' };
  const good = { method: 'GET', headers: { host: '127.0.0.1:1455' }, url: '/auth/callback?state=expected-state&code=example' };
  assert.equal(callbackMatches(good, transaction), true);
  for (const patch of [
    { method: 'POST' }, { headers: { host: 'localhost:1455' } }, { headers: { host: 'attacker.example' } },
    { url: 'http://attacker.example/auth/callback?state=expected-state' },
    { url: '/another/path?state=expected-state' }, { url: '/auth/callback?state=wrong-state' },
    { url: '/auth/callback?state=expected-state&state=expected-state' }, { url: '/auth/callback' },
  ]) assert.equal(callbackMatches({ ...good, ...patch }, transaction), false);
});

async function availablePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForListener(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/unrelated`, { signal: AbortSignal.timeout(500) });
      await response.text();
      if (response.status === 400) return;
    } catch { /* listener has not started */ }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('The CLI callback listener did not start.');
}

test('CLI binds loopback, ignores unrelated callbacks, and retries an expired code once with its registration', { timeout: 10_000 }, async () => {
  const port = await availablePort(), transactions = [], callbacks = [], loginOptions = [];
  const status = { connected: true, enabled: true, activeAccountId: 'saved-account', accounts: [], models: { manager: null, worker: null } };
  const auth = {
    getChatGPTStatus: async () => status,
    createLogin: async options => {
      loginOptions.push(options);
      const transaction = { authorizationUrl: 'https://auth.openai.com/api/accounts/authorize?client_id=test', redirectUri: `http://127.0.0.1:${port}/auth/callback`, state: `state-${transactions.length}`, expiresAt: Date.now() + 600_000 };
      transactions.push(transaction);
      callbacks.push((async () => {
        await waitForListener(port);
        const response = await fetch(`${transaction.redirectUri}?state=${transaction.state}&code=test-code`);
        return { status: response.status, text: await response.text() };
      })());
      return transaction;
    },
    completeLogin: async transaction => {
      if (transaction === transactions[0]) throw Object.assign(new Error('Code expired.'), { code: 'invalid_grant' });
    },
  };
  const sigintBefore = process.listenerCount('SIGINT'), sigtermBefore = process.listenerCount('SIGTERM');
  await login(auth, { port: String(port), 'no-open': true });
  const results = await Promise.all(callbacks);
  assert.deepEqual(results.map(result => result.status), [400, 200]);
  assert.match(results[1].text, /ChatGPT connected/);
  assert.equal(transactions.length, 2);
  assert.equal(loginOptions[0].accountId, 'saved-account');
  assert.equal(loginOptions[1].retryOf, transactions[0]);
  assert.equal(process.listenerCount('SIGINT'), sigintBefore);
  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore);
});

test('CLI refuses to display an authorization URL containing a retained identity token', async () => {
  const auth = {
    getChatGPTStatus: async () => ({ activeAccountId: null }),
    createLogin: async () => ({ authorizationUrl: 'https://auth.openai.com/api/accounts/authorize?id_token_hint=secret', redirectUri: 'http://127.0.0.1:1455/auth/callback', state: 'test' }),
  };
  await assert.rejects(login(auth, { 'no-open': true }), /Cannot display/);
});
