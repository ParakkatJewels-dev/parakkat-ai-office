import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createHiggsfieldAuthClient, safeHiggsfieldAuthError } from '../src/lib/higgsfield/auth.mjs';
import { HiggsfieldMcpError } from '../src/lib/higgsfield/mcp.mjs';

const issuer = 'https://clerk.higgsfield.ai';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', use: 'sig', alg: 'RS256' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'higgsfield-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let current = 1_800_000_000_000, nonce, refreshCount = 0, tokenCount = 0, registrationCount = 0;
  const env = { CREDENTIALS_KEY: 'test-encryption-secret', APP_URL: 'https://office.test' };
  const metadata = { issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, jwks_uri: `${issuer}/.well-known/jwks.json`, revocation_endpoint: `${issuer}/oauth/token/revoke`, code_challenge_methods_supported: ['S256'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'] };
  const signed = async (subject = 'user_test', tokenNonce = nonce) => new SignJWT({ nonce: tokenNonce }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience('client-test').setSubject(subject).setIssuedAt(Math.floor(current / 1000)).setExpirationTime(Math.floor(current / 1000) + 3600).sign(privateKey);
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/.well-known/oauth-authorization-server')) return json(metadata);
    if (url.endsWith('/.well-known/jwks.json')) return json({ keys: [jwk] });
    if (url.endsWith('/oauth/register')) { registrationCount++; return json({ client_id: 'client-test', token_endpoint_auth_method: 'none', redirect_uris: ['https://office.test/api/higgsfield/callback'] }); }
    if (url.endsWith('/oauth/token/revoke')) return new Response(null, { status: overrides.revokeFails ? 500 : 200 });
    if (url.endsWith('/oauth/token')) {
      tokenCount++;
      const params = new URLSearchParams(init.body), refreshing = params.get('grant_type') === 'refresh_token';
      if (refreshing) {
        refreshCount++; await new Promise(resolve => setTimeout(resolve, 30));
        if (overrides.refreshFails) return json({ error: overrides.refreshError || 'invalid_grant', error_description: 'secret-do-not-leak' }, 400);
      }
      return json({ access_token: refreshing ? 'new-access-secret' : 'access-secret', refresh_token: refreshing ? 'new-refresh-secret' : 'refresh-secret', token_type: 'Bearer', expires_in: 3600, scope: 'openid email offline_access', id_token: await signed(overrides.subject || 'user_test', overrides.badNonce ? 'wrong-nonce' : nonce) });
    }
    throw new Error(`Unexpected fixture URL ${url}`);
  };
  const diagnostics = [];
  const options = { directory, env, now: () => current, fetch: fetcher, diagnostic: event => diagnostics.push(event), mcp: { async callHiggsfieldTool(name) { return name === 'get_profile' ? { id: 'user_test', name: 'Test account' } : { workspaces: [{ id: 'workspace-test', name: null, is_selected: true }] }; } } };
  const client = createHiggsfieldAuthClient(options);
  async function start() { const login = await client.startHiggsfieldLogin('office-user', 'https://office.test'); nonce = new URL(login.url).searchParams.get('nonce'); return login; }
  const callback = login => `https://office.test/api/higgsfield/callback?state=${login.state}&code=one-use-code&iss=${encodeURIComponent(issuer)}`;
  async function login() { const login = await start(); await client.finishHiggsfieldLogin('office-user', callback(login), login.state); return login; }
  return { client, options, directory, env, start, login, callback, requests, metadata, diagnostics, advance: ms => { current += ms; }, counts: () => ({ refreshCount, tokenCount, registrationCount }) };
}

test('Higgsfield status is local, disconnected by default and exposes no credentials', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.client.getHiggsfieldStatus(), { connected: false });
  assert.equal(f.requests.length, 0);
  await assert.rejects(readFile(join(f.directory, 'credentials.enc')), { code: 'ENOENT' });
});
test('OAuth registration uses fixed callback, PKCE and encrypted private state; login binds account and workspace', async t => {
  const f = await fixture(t), login = await f.start(), url = new URL(login.url);
  assert.equal(url.origin, issuer); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://office.test/api/higgsfield/callback');
  assert.equal(url.searchParams.get('scope'), 'openid email offline_access');
  const registration = JSON.parse(f.requests.find(row => row.url.endsWith('/oauth/register')).init.body);
  assert.equal(registration.token_endpoint_auth_method, 'none');
  assert.equal((await readFile(join(f.directory, 'credentials.enc'), 'utf8')).includes(login.state), false);
  await f.client.finishHiggsfieldLogin('office-user', f.callback(login), login.state);
  assert.deepEqual(await f.client.getHiggsfieldStatus(), { connected: true, accountId: 'user_test', accountName: 'Test account', workspaceId: 'workspace-test', workspaceName: 'Higgsfield workspace' });
  assert.equal((await stat(join(f.directory, 'credentials.enc'))).mode & 0o777, 0o600);
  const raw = await readFile(join(f.directory, 'credentials.enc'), 'utf8');
  for (const secret of ['access-secret', 'refresh-secret', 'office-user', 'user_test']) assert.equal(raw.includes(secret), false);
});
test('OAuth rejects another browser, user and callback before exchanging its code', async t => {
  const f = await fixture(t), login = await f.start();
  await assert.rejects(f.client.finishHiggsfieldLogin('office-user', f.callback(login), 'different-cookie'), { code: 'invalid_state' });
  await assert.rejects(f.client.finishHiggsfieldLogin('another-user', f.callback(login), login.state), { code: 'invalid_state' });
  await assert.rejects(f.client.finishHiggsfieldLogin('office-user', f.callback(login).replace('office.test', 'attacker.test'), login.state), { code: 'invalid_state' });
  assert.equal(f.counts().tokenCount, 0);
  await f.client.finishHiggsfieldLogin('office-user', f.callback(login), login.state);
});
test('OAuth callback is single use, expires and duplicate parameters are rejected', async t => {
  const f = await fixture(t), login = await f.login();
  await assert.rejects(f.client.finishHiggsfieldLogin('office-user', f.callback(login), login.state), { code: 'invalid_state' });
  const next = await f.start();
  await assert.rejects(f.client.finishHiggsfieldLogin('office-user', `${f.callback(next)}&code=second`, next.state), { code: 'invalid_callback' });
  f.advance(601_000);
  await assert.rejects(f.client.finishHiggsfieldLogin('office-user', f.callback(next), next.state), { code: 'invalid_state' });
  assert.equal(f.counts().tokenCount, 1);
});
test('OIDC nonce and MCP identity mismatch cannot replace a connection', async t => {
  for (const overrides of [{ badNonce: true }, { subject: 'different-account' }]) {
    const f = await fixture(t, overrides), login = await f.start();
    await assert.rejects(f.client.finishHiggsfieldLogin('office-user', f.callback(login), login.state), { code: 'invalid_identity' });
    assert.equal((await f.client.getHiggsfieldStatus()).connected, false);
  }
});
test('Concurrent refreshes across clients rotate credentials only once under a filesystem lock', async t => {
  const f = await fixture(t); await f.login(); f.advance(3_550_000);
  const second = createHiggsfieldAuthClient(f.options);
  const results = await Promise.all([f.client.getHiggsfieldAuthContext(), second.getHiggsfieldAuthContext()]);
  assert.equal(f.counts().refreshCount, 1);
  assert.deepEqual(results.map(row => row.accessToken), ['new-access-secret', 'new-access-secret']);
  await assert.rejects(second.getHiggsfieldAuthContext({ expectedAccountId: 'other' }), { code: 'account_changed' });
  await assert.rejects(second.getHiggsfieldAuthContext({ expectedWorkspaceId: 'other' }), { code: 'account_changed' });
});
test('Terminal refresh failure clears credentials without exposing provider error text', async t => {
  const f = await fixture(t, { refreshFails: true }); await f.login(); f.advance(3_550_000);
  await assert.rejects(f.client.getHiggsfieldAuthContext(), error => error.code === 'invalid_grant' && !error.message.includes('secret-do-not-leak'));
  assert.equal((await f.client.getHiggsfieldStatus()).connected, false);
  await assert.rejects(f.client.getHiggsfieldAuthContext(), { code: 'not_connected' });
  assert.equal(f.counts().refreshCount, 1);
});
test('Disconnect removes credentials and cancels pending login even when revocation fails', async t => {
  const f = await fixture(t, { revokeFails: true }); await f.login(); const login = await f.start();
  assert.deepEqual(await f.client.disconnectHiggsfield(), { revoked: false });
  assert.deepEqual(await f.client.getHiggsfieldStatus(), { connected: false });
  await assert.rejects(f.client.finishHiggsfieldLogin('office-user', f.callback(login), login.state), { code: 'invalid_state' });
});
test('A revoked OAuth client is registered afresh on reconnect', async t => {
  const f = await fixture(t, { refreshFails: true, refreshError: 'invalid_client' }); await f.login(); f.advance(3_550_000);
  await assert.rejects(f.client.getHiggsfieldAuthContext(), { code: 'invalid_client' });
  await f.start();
  assert.equal(f.counts().registrationCount, 2);
});
test('Discovery endpoints and app origin are pinned', async t => {
  const f = await fixture(t);
  await assert.rejects(f.client.startHiggsfieldLogin('office-user', 'https://attacker.test'), { code: 'invalid_origin' });
  f.metadata.token_endpoint = 'https://attacker.test/token';
  await assert.rejects(f.start(), { code: 'discovery_error' });
  assert.equal(f.counts().registrationCount, 0);
});
test('Credential files cannot redirect through symlinks or have public permissions', async t => {
  const f = await fixture(t);
  const elsewhere = join(f.directory, 'elsewhere'); await writeFile(elsewhere, 'sensitive', { mode: 0o600 });
  await symlink(elsewhere, join(f.directory, 'credentials.enc'));
  assert.equal((await f.client.getHiggsfieldStatus()).connected, false);
  await assert.rejects(f.start(), { code: 'unsafe_storage' });
});
test('OAuth verification diagnostics expose stage and known error codes without provider text or tokens', async t => {
  const f = await fixture(t);
  f.options.mcp.callHiggsfieldTool = async () => { const error = new HiggsfieldMcpError('raw-access-secret', 'rpc_error'); error.rpcCode = -32601; throw error; };
  const login = await f.start();
  await assert.rejects(f.client.finishHiggsfieldLogin('office-user', f.callback(login), login.state), error => {
    assert.equal(error.code, 'verify_get_profile');
    assert.match(error.message, /account verification failed/);
    assert.match(error.message, /RPC -32601/);
    assert.equal(error.message.includes('raw-access-secret'), false);
    return true;
  });
  assert.equal((await f.client.getHiggsfieldStatus()).connected, false);
  assert.equal(safeHiggsfieldAuthError(new Error('native-sensitive-detail')).includes('native-sensitive-detail'), false);
});
test('Generic MCP catalogs use verified OIDC identity and persist the discovered workspace alias', async t => {
  const f = await fixture(t), called = [];
  f.options.mcp.listHiggsfieldTools = async ({ cursor } = {}) => cursor ? { tools: [{ name: 'workspace_list', inputSchema: { type: 'object', properties: {} } }] } : { tools: [{ name: 'models_explore', description: 'secret-description', inputSchema: { type: 'object' } }], nextCursor: 'private-cursor' };
  f.options.mcp.callHiggsfieldTool = async name => { called.push(name); assert.equal(name, 'workspace_list'); return { workspaces: [{ id: 'workspace-test', name: 'Private', is_selected: true }] }; };
  await f.login();
  assert.deepEqual(called, ['workspace_list']);
  assert.equal((await f.client.getHiggsfieldStatus()).accountId, 'user_test');
  assert.equal((await f.client.getHiggsfieldAuthContext()).workspaceTool, 'workspace_list');
  const logged = JSON.stringify(f.diagnostics);
  assert.match(logged, /models_explore/); assert.match(logged, /workspace_list/);
  for (const secret of ['secret-description', 'private-cursor', 'user_test', 'access-secret']) assert.equal(logged.includes(secret), false);
});
test('Catalog discovery rejects repeated pagination without connecting an unverified workspace', async t => {
  const f = await fixture(t); let calls = 0;
  f.options.mcp.listHiggsfieldTools = async () => { calls++; return { tools: [], nextCursor: 'repeat' }; };
  const login = await f.start();
  await assert.rejects(f.client.finishHiggsfieldLogin('office-user', f.callback(login), login.state), { code: 'verify_catalog' });
  assert.equal(calls, 2); assert.equal((await f.client.getHiggsfieldStatus()).connected, false);
});
