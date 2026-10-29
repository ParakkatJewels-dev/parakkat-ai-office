import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, symlink, chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuthClient, authEnabled } from '../src/lib/chatgpt/auth.mjs';

const ISSUER = 'https://auth.openai.com';
const scopes = 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct';
const keys = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

async function fixture(t, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'parakkat-chatgpt-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = { dir, now: Date.now(), calls: [], tokenCalls: 0, refreshCalls: 0, revokeCalls: 0, nonce: null, claims: {}, scope: scopes, clientId: 'oaiapp_one', subject: 'subject-one', ...opts };
  f.jwt = async (overrides = {}) => new SignJWT({ email: 'owner@example.com', nonce: f.nonce, ...f.claims, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(f.issuer || ISSUER).setAudience(f.audience || f.clientId)
    .setSubject(f.subject).setIssuedAt(Math.floor(f.now / 1000)).setExpirationTime(Math.floor(f.now / 1000) + (f.expiry ?? 3600)).sign(keys.privateKey);
  f.fetch = async (url, init) => {
    f.calls.push({ url, init });
    if (String(url).endsWith('/.well-known/openid-configuration')) return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/api/accounts/authorize`, token_endpoint: `${ISSUER}/api/accounts/oauth/token`, jwks_uri: `${ISSUER}/.well-known/jwks.json`, revocation_endpoint: `${ISSUER}/oauth/revoke` });
    if (String(url).endsWith('/.well-known/jwks.json')) return json({ keys: [jwk] });
    if (String(url).endsWith('/oauth/revoke')) { f.revokeCalls++; return new Response('', { status: f.revokeStatus || 200 }); }
    if (String(url).endsWith('/oauth/token')) {
      f.tokenCalls++;
      const body = new URLSearchParams(init.body); f.lastTokenBody = body;
      if (body.get('grant_type') === 'refresh_token') {
        f.refreshCalls++;
        if (f.refreshError) return json({ error: f.refreshError, error_description: 'NEVER PRINT SECRET' }, f.refreshStatus || 400);
        await new Promise(r => setTimeout(r, 20));
        return json({ access_token: `access-refreshed-${f.refreshCalls}`, refresh_token: `refresh-rotated-${f.refreshCalls}`, token_type: 'Bearer', expires_in: 3600, ...(f.refreshScope ? { scope: f.refreshScope } : {}) });
      }
      if (f.codeError) return json({ error: f.codeError }, 400);
      return json({ access_token: `access-${f.clientId}`, refresh_token: `refresh-${f.clientId}`, id_token: await f.jwt(), token_type: 'Bearer', expires_in: 3600, scope: f.scope });
    }
    throw new Error(`Unexpected network request: ${url}`);
  };
  f.client = createAuthClient({ directory: dir, enabled: true, now: () => f.now, fetch: f.fetch });
  f.start = async (options = {}) => {
    const tx = await f.client.createLogin(options); f.nonce = new URL(tx.authorizationUrl).searchParams.get('nonce'); return tx;
  };
  f.callback = (tx, values = {}) => {
    const url = new URL(tx.redirectUri); url.search = new URLSearchParams({ code: 'code-once', state: tx.state, client_id: f.clientId, ...values }).toString(); return url;
  };
  f.login = async (options = {}) => { const tx = await f.start(options); await f.client.completeLogin(tx, f.callback(tx)); return tx; };
  return f;
}

test('OAuth is opt-in for self-hosted servers and a status read creates no credential files', async t => {
  const oldEnabled = process.env.CHATGPT_AUTH_ENABLED, oldVercel = process.env.VERCEL;
  t.after(() => {
    if (oldEnabled === undefined) delete process.env.CHATGPT_AUTH_ENABLED; else process.env.CHATGPT_AUTH_ENABLED = oldEnabled;
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
  });
  delete process.env.CHATGPT_AUTH_ENABLED; delete process.env.VERCEL;
  assert.equal(authEnabled(), false);
  process.env.CHATGPT_AUTH_ENABLED = 'true'; assert.equal(authEnabled(), true);
  process.env.VERCEL = '1'; assert.equal(authEnabled(), false);
  const f = await fixture(t), client = createAuthClient({ directory: join(f.dir, 'not-created'), enabled: false });
  assert.equal((await client.getChatGPTStatus()).connected, false);
  await assert.rejects(stat(join(f.dir, 'not-created')), { code: 'ENOENT' });
  await assert.rejects(client.createLogin(), { code: 'chatgpt_disabled' });
});

test('concurrent host initialization persists a single opaque host identity', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => f.client.ensureHost()));
  assert.equal(new Set(results).size, 1);
  assert.match(results[0], /^urn:uuid:/);
  assert.equal((await stat(f.dir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(f.dir, 'host.json'))).mode & 0o777, 0o600);
});

test('PKCE login uses the issued client, validates identity, and returns only safe status metadata', async t => {
  const f = await fixture(t), tx = await f.start(), url = new URL(tx.authorizationUrl);
  assert.equal(url.origin, ISSUER);
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('agent_name_hint'), 'Parakkat AI Office');
  assert.equal(url.searchParams.get('scope'), scopes.replace('openid email profile', 'openid profile email'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('id_token_hint'), false);
  assert.equal(tx.codeVerifier, undefined);
  await f.client.completeLogin(tx, f.callback(tx));
  assert.equal(f.lastTokenBody.get('client_id'), 'oaiapp_one');
  assert.equal(f.lastTokenBody.get('redirect_uri'), tx.redirectUri);
  assert.equal(f.lastTokenBody.get('resource'), 'https://api.openai.com/v1');
  assert.equal(createHash('sha256').update(f.lastTokenBody.get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));
  const s = await f.client.getChatGPTStatus();
  assert.equal(s.connected, true); assert.equal(s.accounts[0].email, 'owner@example.com');
  assert.equal(JSON.stringify(s).includes('access-'), false);
  assert.equal(JSON.stringify(s).includes('refresh-'), false);
  assert.equal((await stat(join(f.dir, 'credentials.json'))).mode & 0o777, 0o600);
  assert.equal(await f.client.getAccessToken(), 'access-oaiapp_one');
  await assert.rejects(f.client.completeLogin(tx, f.callback(tx)), { code: 'invalid_state' });
  assert.equal(f.tokenCalls, 1);
});

test('invalid, expired, denied, and mismatched callbacks never redeem a code', async t => {
  for (const scenario of ['state', 'expired', 'denied', 'no-client', 'dynamic-client', 'path', 'duplicate']) {
    await t.test(scenario, async t => {
      const f = await fixture(t), tx = await f.start(), cb = f.callback(tx);
      if (scenario === 'state') cb.searchParams.set('state', 'wrong');
      if (scenario === 'expired') f.now += 600_001;
      if (scenario === 'denied') cb.searchParams.set('error', 'access_denied');
      if (scenario === 'no-client') cb.searchParams.delete('client_id');
      if (scenario === 'dynamic-client') cb.searchParams.set('client_id', 'dynamic_agent_client');
      if (scenario === 'path') cb.pathname = '/callback';
      if (scenario === 'duplicate') cb.searchParams.append('state', tx.state);
      await assert.rejects(f.client.completeLogin(tx, cb));
      assert.equal(f.tokenCalls, 0);
      assert.equal((await f.client.getChatGPTStatus()).connected, false);
    });
  }
});

test('ID token nonce, audience, issuer, expiration, and signature are mandatory', async t => {
  for (const scenario of ['nonce', 'audience', 'issuer', 'expired', 'signature']) {
    await t.test(scenario, async t => {
      const f = await fixture(t), tx = await f.start();
      if (scenario === 'nonce') f.claims.nonce = 'wrong-nonce';
      if (scenario === 'audience') f.audience = 'oaiapp_wrong';
      if (scenario === 'issuer') f.issuer = 'https://evil.example';
      if (scenario === 'expired') f.expiry = -60;
      if (scenario === 'signature') { const sign = f.jwt; f.jwt = async () => { const token = await sign(); return token.slice(0, -16) + 'AAAAAAAAAAAAAAAA'; }; }
      await assert.rejects(f.client.completeLogin(tx, f.callback(tx)), { code: 'invalid_identity' });
      assert.equal((await f.client.getChatGPTStatus()).accounts.length, 0);
    });
  }
});

test('returning sign-in keeps registration/models and rejects another client or identity', async t => {
  const f = await fixture(t); await f.login();
  const first = (await f.client.getChatGPTStatus()).activeAccountId;
  await f.client.setModels({ manager: 'test-manager', worker: 'test-worker' }, first);
  let tx = await f.start({ accountId: first }), url = new URL(tx.authorizationUrl);
  assert.equal(url.searchParams.get('client_id'), 'oaiapp_one');
  assert.equal(url.searchParams.has('agent_name_hint'), false);
  assert.equal(url.searchParams.has('id_token_hint'), false);
  let cb = f.callback(tx); cb.searchParams.delete('client_id');
  await f.client.completeLogin(tx, cb);
  assert.deepEqual((await f.client.getChatGPTStatus()).models, { manager: 'test-manager', worker: 'test-worker' });
  tx = await f.start({ accountId: first });
  await assert.rejects(f.client.completeLogin(tx, f.callback(tx, { client_id: 'oaiapp_other' })), { code: 'invalid_client' });
  tx = await f.start({ accountId: first }); f.subject = 'somebody-else';
  await assert.rejects(f.client.completeLogin(tx, f.callback(tx)), { code: 'invalid_identity' });
  assert.equal((await f.client.getChatGPTStatus()).activeAccountId, first);
});

test('missing plan consent preserves the validated registration but cannot run inference', async t => {
  const f = await fixture(t, { scope: 'openid profile email' }); await f.login();
  const status = await f.client.getChatGPTStatus();
  assert.equal(status.connected, false); assert.equal(status.accounts.length, 1);
  await assert.rejects(f.client.getAccessToken(), { code: 'not_connected' });
  const tx = await f.start({ accountId: status.activeAccountId }), params = new URL(tx.authorizationUrl).searchParams;
  assert.equal(params.get('client_id'), 'oaiapp_one');
  assert.equal(params.get('prompt'), 'consent');
  assert.ok(params.get('scope').includes('chatgpt.tokens.use.direct'));
});

test('an invalid authorization grant retries with the issued client ID and fresh PKCE/state', async t => {
  const f = await fixture(t), first = await f.start(); f.codeError = 'invalid_grant';
  await assert.rejects(f.client.completeLogin(first, f.callback(first)), { code: 'invalid_grant' });
  assert.equal((await f.client.getChatGPTStatus()).accounts.length, 0);
  const retry = await f.start({ retryOf: first }), params = new URL(retry.authorizationUrl).searchParams;
  assert.equal(params.get('client_id'), 'oaiapp_one'); assert.equal(params.has('agent_name_hint'), false);
  assert.notEqual(retry.state, first.state);
  assert.notEqual(params.get('code_challenge'), new URL(first.authorizationUrl).searchParams.get('code_challenge'));
  await assert.rejects(f.start({ retryOf: first }), { code: 'invalid_state' });
  f.codeError = null;
  await f.client.completeLogin(retry, f.callback(retry));
  assert.equal((await f.client.getChatGPTStatus()).connected, true);
});

test('concurrent refreshes serialize across client instances and persist rotated credentials together', async t => {
  const f = await fixture(t); await f.login(); f.now += 3_550_000;
  const second = createAuthClient({ directory: f.dir, enabled: true, now: () => f.now, fetch: f.fetch });
  const tokens = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? second : f.client).getAccessToken()));
  assert.equal(f.refreshCalls, 1); assert.equal(new Set(tokens).size, 1); assert.equal(tokens[0], 'access-refreshed-1');
  assert.equal(f.lastTokenBody.has('scope'), false); assert.equal(f.lastTokenBody.get('client_id'), 'oaiapp_one');
  const stored = JSON.parse(await readFile(join(f.dir, 'credentials.json'), 'utf8')).accounts[0];
  assert.equal(stored.tokens.refresh_token, 'refresh-rotated-1');
  assert.equal(stored.tokens.access_token, 'access-refreshed-1');
  assert.ok(stored.tokens.expires_at > f.now);
});

test('separate Node processes cannot race a rotating refresh token', async t => {
  const f = await fixture(t); await f.login(); f.now += 3_550_000;
  const moduleUrl = new URL('../src/lib/chatgpt/auth.mjs', import.meta.url).href;
  const script = `
    import { createAuthClient } from ${JSON.stringify(moduleUrl)};
    import { appendFile } from 'node:fs/promises';
    import { join } from 'node:path';
    const [dir, now] = process.argv.slice(1);
    const fetch = async (url) => {
      if (url.endsWith('openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize', token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token', jwks_uri: 'https://auth.openai.com/.well-known/jwks.json' });
      await appendFile(join(dir, 'refresh-count'), 'refresh\\n');
      await new Promise(resolve => setTimeout(resolve, 100));
      return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600 });
    };
    const client = createAuthClient({ directory: dir, enabled: true, now: () => Number(now), fetch });
    await client.getAccessToken();
  `;
  const exec = promisify(execFile);
  await Promise.all([0, 1, 2].map(() => exec(process.execPath, ['--input-type=module', '-e', script, f.dir, String(f.now)])));
  assert.equal(await readFile(join(f.dir, 'refresh-count'), 'utf8'), 'refresh\n');
});

test('terminal refresh failures clear only tokens; temporary failures preserve renewable credentials', async t => {
  for (const terminal of [true, false]) await t.test(String(terminal), async t => {
    const f = await fixture(t); await f.login(); f.now += 3_550_000;
    const id = (await f.client.getChatGPTStatus()).activeAccountId;
    f.refreshError = terminal ? 'invalid_grant' : 'server_error'; f.refreshStatus = terminal ? 400 : 503;
    await assert.rejects(f.client.getAccessToken(), e => !e.message.includes('NEVER PRINT SECRET'));
    const status = await f.client.getChatGPTStatus();
    assert.equal(status.activeAccountId, id); assert.equal(status.accounts.length, 1); assert.equal(status.connected, !terminal);
  });
});

test('account switching keeps per-account models and disconnect never erases another account', async t => {
  const f = await fixture(t); await f.login();
  const one = (await f.client.getChatGPTStatus()).activeAccountId;
  await f.client.setModels({ manager: 'one-manager', worker: 'one-worker' }, one);
  f.clientId = 'oaiapp_two'; await f.login();
  const two = (await f.client.getChatGPTStatus()).activeAccountId;
  assert.notEqual(one, two); assert.deepEqual((await f.client.getChatGPTStatus()).models, { manager: null, worker: null });
  await assert.rejects(f.client.setModels({ manager: 'wrong', worker: 'wrong' }, one), { code: 'account_changed' });
  await f.client.selectAccount(one);
  const snapshot = await f.client.getAuthContext();
  assert.equal(snapshot.accountId, one); assert.equal(snapshot.accessToken, 'access-oaiapp_one'); assert.equal(snapshot.models.manager, 'one-manager');
  await f.client.selectAccount(two);
  assert.deepEqual(await f.client.disconnectAccount(one), { revoked: true });
  const status = await f.client.getChatGPTStatus();
  assert.equal(status.activeAccountId, two); assert.equal(status.connected, true); assert.equal(status.accounts.find(a => a.id === one).connected, false);
  assert.equal(f.revokeCalls, 1);
});

test('failed revocation retries boundedly, removes local tokens, and reports remote uncertainty', async t => {
  const f = await fixture(t, { revokeStatus: 503 }); await f.login();
  assert.deepEqual(await f.client.disconnectAccount(), { revoked: false });
  assert.equal(f.revokeCalls, 3); assert.equal((await f.client.getChatGPTStatus()).connected, false);
  const raw = await readFile(join(f.dir, 'credentials.json'), 'utf8');
  assert.equal(raw.includes('access-oaiapp'), false); assert.equal(raw.includes('refresh-oaiapp'), false);
});

test('a persisted usage stop belongs to the request account and survives reauthorization', async t => {
  const f = await fixture(t); await f.login();
  const one = (await f.client.getChatGPTStatus()).activeAccountId;
  f.clientId = 'oaiapp_two'; await f.login();
  const two = (await f.client.getChatGPTStatus()).activeAccountId;
  await f.client.markAccountUsageBlocked(one);
  assert.equal((await f.client.getAuthContext()).accountId, two);
  assert.equal((await f.client.getAuthContext()).usageBlocked, false);
  await f.client.selectAccount(one);
  assert.equal((await f.client.getChatGPTStatus()).usageBlocked, true);
  assert.equal((await f.client.getAuthContext()).usageBlocked, true);
  f.clientId = 'oaiapp_one'; await f.login({ accountId: one });
  assert.equal((await f.client.getChatGPTStatus()).usageBlocked, true);
  await f.client.clearAccountUsageBlock(one);
  assert.equal((await f.client.getChatGPTStatus()).usageBlocked, false);
});

test('export transfers only the active account; import verifies identity and preserves the VPS host', async t => {
  const f = await fixture(t); await f.login();
  const sourceHost = await f.client.ensureHost();
  f.clientId = 'oaiapp_two'; await f.login();
  const target = join(f.dir, 'transfer.json'); await f.client.exportCredentials(target);
  const raw = await readFile(target, 'utf8'), bundle = JSON.parse(raw);
  assert.equal(bundle.account.client_id, 'oaiapp_two'); assert.equal(raw.includes(sourceHost), false); assert.equal(raw.includes('oaiapp_one'), false);
  await assert.rejects(f.client.exportCredentials(target), { code: 'unsafe_storage' });
  const destination = createAuthClient({ directory: join(f.dir, 'vps'), enabled: true, now: () => f.now, fetch: f.fetch });
  const vpsHost = await destination.ensureHost(); assert.notEqual(vpsHost, sourceHost);
  await destination.importCredentials(target);
  assert.equal(await destination.ensureHost(), vpsHost);
  assert.equal((await destination.getChatGPTStatus()).connected, true);
  assert.equal((await destination.getChatGPTStatus()).accounts.length, 1);
});

test('storage rejects symlinks and permissive imported credential files', async t => {
  const f = await fixture(t); await f.login();
  const target = join(f.dir, 'transfer.json'); await f.client.exportCredentials(target);
  const linked = join(f.dir, 'linked.json'); await symlink(target, linked);
  await assert.rejects(f.client.importCredentials(linked), { code: 'unsafe_storage' });
  const unsafeDir = join(f.dir, 'link-dir'); await symlink(f.dir, unsafeDir);
  const client = createAuthClient({ directory: unsafeDir, enabled: true });
  await assert.rejects(client.ensureHost(), { code: 'unsafe_storage' });
  const nested = createAuthClient({ directory: join(unsafeDir, 'nested'), enabled: true });
  await assert.rejects(nested.ensureHost(), { code: 'unsafe_storage' });
  await chmod(target, 0o644);
  await assert.rejects(f.client.importCredentials(target), { code: 'unsafe_storage' });
});

test('import rejects a tampered client/identity mapping without touching the active account', async t => {
  const f = await fixture(t); await f.login();
  const activeBefore = (await f.client.getChatGPTStatus()).activeAccountId;
  const path = join(f.dir, 'transfer.json'); await f.client.exportCredentials(path);
  const bundle = JSON.parse(await readFile(path, 'utf8'));
  bundle.account.subject = 'attacker-subject';
  bundle.account.id = createHash('sha256').update(`${ISSUER}\0${bundle.account.client_id}\0attacker-subject`).digest('hex');
  await writeFile(path, JSON.stringify(bundle), { mode: 0o600 });
  await assert.rejects(f.client.importCredentials(path), { code: 'invalid_identity' });
  assert.equal((await f.client.getChatGPTStatus()).activeAccountId, activeBefore);
  assert.equal((await f.client.getChatGPTStatus()).accounts.length, 1);
});
