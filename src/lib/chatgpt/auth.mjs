// Server/CLI only. ChatGPT credentials stay on the self-hosted machine, never in Supabase or browser state.
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readlink, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const DYNAMIC = 'dynamic_agent_client';
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const EMPTY_MODELS = () => ({ manager: null, worker: null });
const TERMINAL_REFRESH = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const random = () => randomBytes(32).toString('base64url');
const text = (v, max = 32768) => typeof v === 'string' && v.length > 0 && v.length <= max;
const accountKey = (clientId, subject) => createHash('sha256').update(`${ISSUER}\0${clientId}\0${subject}`).digest('hex');
const emptyStore = () => ({ version: 1, activeAccountId: null, accounts: [] });

export class ChatGPTAuthError extends Error {
  constructor(message, code = 'chatgpt_auth_error', status = undefined) {
    super(message); this.name = 'ChatGPTAuthError'; this.code = code; this.status = status;
  }
}

export function authEnabled() { return process.env.CHATGPT_AUTH_ENABLED === 'true' && !process.env.VERCEL; }

/** Injectable I/O makes protocol/security tests independent of credentials and external services. */
export function createAuthClient(options = {}) {
  const directory = () => resolve(options.directory || process.env.CHATGPT_AUTH_DIR || join(homedir(), '.config/parakkat-ai-office/chatgpt'));
  const enabled = () => options.enabled ?? authEnabled();
  const now = () => options.now?.() ?? Date.now();
  const request = (url, init) => (options.fetch || globalThis.fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const transactions = new WeakMap();
  const retries = new WeakMap();
  let discoveryCache, jwksCache;

  function requireEnabled() {
    if (!enabled()) throw new ChatGPTAuthError('Enable CHATGPT_AUTH_ENABLED=true on a self-hosted server to use ChatGPT.', 'chatgpt_disabled');
  }
  async function statSafe(path) {
    // Refuse redirected storage anywhere in the path, except macOS's canonical system aliases.
    const absolute = resolve(path), root = parse(absolute).root, parts = relative(root, absolute).split(sep).filter(Boolean);
    let current = root;
    for (const part of parts) {
      current = join(current, part);
      let s; try { s = await lstat(current); } catch (e) { if (e.code === 'ENOENT') break; throw e; }
      if (s.isSymbolicLink()) {
        const systemAlias = process.platform === 'darwin' && ['/var', '/tmp', '/etc'].includes(current)
          && resolve(dirname(current), await readlink(current)) === `/private${current}`;
        if (!systemAlias) throw new ChatGPTAuthError('ChatGPT storage must not traverse symbolic links.', 'unsafe_storage');
      }
    }
    try {
      const s = await lstat(path);
      if (s.isSymbolicLink()) throw new ChatGPTAuthError('ChatGPT storage must not be a symbolic link.', 'unsafe_storage');
      return s;
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async function prepareDirectory() {
    const dir = directory(), existing = await statSafe(dir);
    if (existing && !existing.isDirectory()) throw new ChatGPTAuthError('ChatGPT storage must be a directory.', 'unsafe_storage');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (!(await statSafe(dir))?.isDirectory()) throw new ChatGPTAuthError('ChatGPT storage is unavailable.', 'unsafe_storage');
    await chmod(dir, 0o700);
    return dir;
  }
  async function readJson(path, missing = null) {
    const stat = await statSafe(path);
    if (!stat) return missing;
    if (!stat.isFile() || stat.size > 2_000_000) throw new ChatGPTAuthError('ChatGPT credential file is invalid.', 'invalid_storage');
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new ChatGPTAuthError('ChatGPT credential file must have owner-only permissions (chmod 600).', 'unsafe_storage');
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = await file.stat();
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > 2_000_000
        || (process.platform !== 'win32' && (opened.mode & 0o077))) throw new ChatGPTAuthError('ChatGPT credential file changed or has unsafe permissions.', 'unsafe_storage');
      const raw = await file.readFile('utf8');
      try { return JSON.parse(raw); } catch { throw new ChatGPTAuthError('ChatGPT credential file is invalid JSON.', 'invalid_storage'); }
    } finally { await file.close(); }
  }
  async function writeJson(path, value, { exclusive = false } = {}) {
    const current = await statSafe(path);
    if (current && (!current.isFile() || exclusive)) throw new ChatGPTAuthError(exclusive ? 'The destination already exists. Choose a new private file.' : 'ChatGPT storage is not a regular file.', 'unsafe_storage');
    const temp = join(dirname(path), `.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      await handle.writeFile(JSON.stringify(value), 'utf8');
      await handle.sync(); await handle.close(); handle = null;
      if (exclusive) {
        // Reserve the final path without overwriting a user's existing file.
        const reserved = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
        await reserved.close();
      }
      await statSafe(path);
      await rename(temp, path);
      await chmod(path, 0o600);
    } finally {
      if (handle) await handle.close();
      await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
  }
  async function locked(fn) {
    const dir = await prepareDirectory(), path = join(dir, 'auth.lock');
    const owner = { pid: process.pid, nonce: random(), created_at: now() };
    const started = Date.now();
    let file;
    while (!file) {
      try {
        file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        // Never reclaim a live lock on a time heuristic: a suspended refresh may still own it.
        await statSafe(path);
        if (Date.now() - started > 20_000) throw new ChatGPTAuthError('ChatGPT credentials are busy. If a process crashed, stop all app and login processes before removing auth.lock from CHATGPT_AUTH_DIR.', 'credentials_locked');
        await pause(25 + Math.floor(Math.random() * 35));
      }
    }
    try {
      await file.writeFile(JSON.stringify(owner)); await file.close(); file = null;
      return await fn(dir);
    } finally {
      if (file) await file.close();
      const saved = await readJson(path).catch(() => null);
      if (saved?.nonce === owner.nonce) await unlink(path);
    }
  }
  function validateModels(value) {
    const out = EMPTY_MODELS();
    for (const tier of ['manager', 'worker']) {
      if (value?.[tier] != null) {
        if (!text(value[tier], 200) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value[tier])) throw new ChatGPTAuthError('Choose valid ChatGPT models.', 'invalid_models');
        out[tier] = value[tier];
      }
    }
    return out;
  }
  function validateAccount(account) {
    if (!account || account.issuer !== ISSUER || !text(account.subject, 500) || !text(account.client_id, 500) || account.client_id === DYNAMIC || !/^oaiapp_[A-Za-z0-9_-]+$/.test(account.client_id)
      || account.id !== accountKey(account.client_id, account.subject) || (account.email != null && !text(account.email, 320))) {
      throw new ChatGPTAuthError('ChatGPT account registration is invalid.', 'invalid_storage');
    }
    const model = validateModels(account.models);
    let tokens = null;
    if (account.tokens != null) {
      const t = account.tokens;
      if (!text(t.access_token) || !text(t.refresh_token) || !text(t.id_token) || t.token_type !== 'Bearer' || !Number.isFinite(t.expires_at)
        || !Array.isArray(t.scopes) || t.scopes.some(s => !text(s, 200))) throw new ChatGPTAuthError('ChatGPT credential fields are invalid.', 'invalid_storage');
      tokens = { access_token: t.access_token, refresh_token: t.refresh_token, id_token: t.id_token, token_type: 'Bearer', expires_at: t.expires_at, scopes: [...new Set(t.scopes)] };
    }
    return { id: account.id, issuer: ISSUER, subject: account.subject, client_id: account.client_id, email: account.email ?? null,
      label: `${account.email || 'ChatGPT account'} · ${account.client_id}`, models: model, tokens,
      plan_enabled: typeof account.plan_enabled === 'boolean' ? account.plan_enabled : !!tokens?.scopes.includes(DIRECT_SCOPE),
      usage_blocked: account.usage_blocked === true };
  }
  async function readStore() {
    const path = join(directory(), 'credentials.json'), data = await readJson(path, emptyStore());
    if (data?.version !== 1 || !Array.isArray(data.accounts) || data.accounts.length > 100) throw new ChatGPTAuthError('ChatGPT credential store is invalid.', 'invalid_storage');
    const accounts = data.accounts.map(validateAccount), ids = accounts.map(a => a.id);
    if (new Set(ids).size !== ids.length || (data.activeAccountId != null && !ids.includes(data.activeAccountId))) throw new ChatGPTAuthError('ChatGPT account selection is invalid.', 'invalid_storage');
    return { version: 1, activeAccountId: data.activeAccountId ?? null, accounts };
  }
  async function saveStore(store) { await writeJson(join(directory(), 'credentials.json'), store); }
  const connected = a => !!(a?.tokens?.access_token && a.tokens.refresh_token && a.tokens.scopes.includes(DIRECT_SCOPE) && a.tokens.scopes.includes('resource.invoke'));
  const active = store => store.accounts.find(a => a.id === store.activeAccountId);
  async function ensureHostUnlocked() {
    const path = join(directory(), 'host.json'), old = await readJson(path);
    if (old) {
      if (typeof old.host_id !== 'string' || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(old.host_id)) throw new ChatGPTAuthError('ChatGPT host identity is invalid.', 'invalid_storage');
      return old.host_id;
    }
    const hostId = `urn:uuid:${randomUUID()}`;
    await writeJson(path, { host_id: hostId }); return hostId;
  }
  async function ensureHost() { requireEnabled(); return locked(ensureHostUnlocked); }
  async function getChatGPTStatus() {
    // Merely visiting Admin never creates credentials or triggers refresh/network calls.
    await statSafe(directory());
    const store = await readStore(), a = active(store);
    return { enabled: enabled(), connected: enabled() && connected(a), activeAccountId: store.activeAccountId, usageBlocked: a?.usage_blocked === true,
      accounts: store.accounts.map(a => ({ id: a.id, label: a.label, email: a.email, active: a.id === store.activeAccountId, connected: connected(a), usageBlocked: a.usage_blocked })),
      models: a?.models || EMPTY_MODELS() };
  }
  function trustedEndpoint(value) {
    let url; try { url = new URL(value); } catch { throw new ChatGPTAuthError('OpenAI discovery returned an invalid endpoint.', 'discovery_error'); }
    if (url.origin !== ISSUER || url.username || url.password || url.hash) throw new ChatGPTAuthError('OpenAI discovery returned an untrusted endpoint.', 'discovery_error');
    return url.toString();
  }
  async function fetchJson(url, init = {}) {
    let response;
    try { response = await request(url, init); } catch { throw new ChatGPTAuthError('Could not reach OpenAI. Try again later.', 'network_error'); }
    let data; try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      const candidate = typeof data.error === 'string' ? data.error : data.error?.code;
      const code = TERMINAL_REFRESH.has(candidate) || candidate === 'invalid_client' ? candidate : 'oauth_request_failed';
      throw new ChatGPTAuthError(`OpenAI authentication request failed (HTTP ${response.status}).${TERMINAL_REFRESH.has(code) ? ' Sign in again.' : ''}`, code, response.status);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ChatGPTAuthError('OpenAI authentication returned an invalid response.', 'invalid_response');
    return data;
  }
  async function discovery() {
    if (discoveryCache && now() - discoveryCache.at < 3_600_000) return discoveryCache.data;
    const d = await fetchJson(DISCOVERY);
    if (d.issuer !== ISSUER) throw new ChatGPTAuthError('OpenAI discovery issuer did not match.', 'discovery_error');
    const data = { authorization_endpoint: trustedEndpoint(d.authorization_endpoint), token_endpoint: trustedEndpoint(d.token_endpoint), jwks_uri: trustedEndpoint(d.jwks_uri),
      revocation_endpoint: d.revocation_endpoint ? trustedEndpoint(d.revocation_endpoint) : null };
    discoveryCache = { at: now(), data }; return data;
  }
  async function identity(idToken, clientId, nonce, expectedSubject, { imported = false } = {}) {
    if (!text(idToken)) throw new ChatGPTAuthError('OpenAI did not return an ID token.', 'invalid_identity');
    const d = await discovery();
    async function keys(force = false) {
      if (!force && jwksCache && now() - jwksCache.at < 3_600_000) return jwksCache.keys;
      const json = await fetchJson(d.jwks_uri);
      if (!Array.isArray(json.keys) || json.keys.length > 100) throw new ChatGPTAuthError('OpenAI verification keys are invalid.', 'invalid_identity');
      jwksCache = { at: now(), keys: createLocalJWKSet(json) }; return jwksCache.keys;
    }
    let payload;
    try {
      const verify = async keyset => jwtVerify(idToken, keyset, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
        currentDate: new Date(now()), algorithms: ['RS256', 'ES256'] });
      try { ({ payload } = await verify(await keys())); }
      catch (e) { if (e.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw e; ({ payload } = await verify(await keys(true))); }
    } catch {
      throw new ChatGPTAuthError(imported ? 'The exported identity can no longer be verified. Sign in and export again.' : 'ChatGPT identity verification failed. Start a new sign-in.', 'invalid_identity');
    }
    if (!text(payload.sub, 500) || !Number.isFinite(payload.iat) || payload.iat > now() / 1000 + 5 || (nonce != null && payload.nonce !== nonce) || (expectedSubject && payload.sub !== expectedSubject)
      || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
      || (payload.azp != null && payload.azp !== clientId)) throw new ChatGPTAuthError('ChatGPT identity did not match the selected sign-in.', 'invalid_identity');
    return payload;
  }
  function tokenSet(response, old = null, requireIdentity = true) {
    const scopes = typeof response.scope === 'string' ? response.scope.split(/\s+/).filter(Boolean) : old?.scopes;
    if (!Array.isArray(scopes)) throw new ChatGPTAuthError('OpenAI did not return granted scopes.', 'invalid_response');
    if (!text(response.access_token) || !text(response.refresh_token) || !Number.isFinite(response.expires_in) || response.expires_in <= 0 || response.expires_in > 31_536_000
      || String(response.token_type).toLowerCase() !== 'bearer' || (requireIdentity && !text(response.id_token))) throw new ChatGPTAuthError('OpenAI did not return renewable ChatGPT credentials.', 'invalid_response');
    return { access_token: response.access_token, refresh_token: response.refresh_token, id_token: response.id_token || old?.id_token,
      token_type: 'Bearer', scopes: [...new Set(scopes)], expires_at: now() + response.expires_in * 1000 };
  }
  async function createLogin({ accountId, port = 1455, retryOf } = {}) {
    requireEnabled();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ChatGPTAuthError('Choose a valid callback port.', 'invalid_port');
    const hostId = await ensureHost(), store = await readStore();
    const retry = retryOf ? retries.get(retryOf) : null;
    if (retryOf && (!retry || retry.expiresAt <= now())) throw new ChatGPTAuthError('That ChatGPT sign-in retry expired. Start a new sign-in.', 'invalid_state');
    if (retryOf) retries.delete(retryOf);
    if (retry) accountId = retry.accountId;
    const account = accountId ? store.accounts.find(a => a.id === accountId) : null;
    if (accountId && !account) throw new ChatGPTAuthError('That ChatGPT account was not found.', 'account_not_found');
    const d = await discovery(), state = random(), nonce = random(), verifier = random(), redirectUri = `http://127.0.0.1:${port}/auth/callback`;
    const clientId = retry?.clientId || account?.client_id || DYNAMIC;
    const params = { client_id: clientId, ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE,
      state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') };
    if (clientId === DYNAMIC) params.agent_name_hint = 'Parakkat AI Office';
    else if (account?.email) params.login_hint = account.email;
    if (account && !account.plan_enabled) params.prompt = 'consent';
    // No ID-token hint: the CLI can safely display this URL for a remote browser without printing credentials.
    const url = new URL(d.authorization_endpoint); url.search = new URLSearchParams(params).toString();
    const result = Object.freeze({ authorizationUrl: url.toString(), redirectUri, state, expiresAt: now() + 600_000 });
    transactions.set(result, { state, nonce, verifier, redirectUri, clientId, subject: retry?.subject || account?.subject, accountId: account?.id, expiresAt: result.expiresAt });
    return result;
  }
  async function completeLogin(transaction, callbackUrl) {
    requireEnabled();
    const t = transactions.get(transaction); transactions.delete(transaction);
    let callback; try { callback = new URL(callbackUrl); } catch { /* handled below */ }
    const receivedState = callback?.searchParams.get('state');
    if (!t || t.expiresAt <= now() || !text(receivedState, 200) || receivedState.length !== t.state.length
      || !timingSafeEqual(Buffer.from(receivedState), Buffer.from(t.state)) || callback.origin + callback.pathname !== t.redirectUri) {
      throw new ChatGPTAuthError('ChatGPT sign-in state did not match or expired. Start a new sign-in.', 'invalid_state');
    }
    for (const key of ['state', 'code', 'client_id', 'error']) if (callback.searchParams.getAll(key).length > 1) throw new ChatGPTAuthError('ChatGPT callback contains duplicate parameters.', 'invalid_callback');
    if (callback.searchParams.has('error')) throw new ChatGPTAuthError('ChatGPT sign-in was declined or cancelled.', 'access_denied');
    const code = callback.searchParams.get('code'), returnedClient = callback.searchParams.get('client_id');
    const clientId = t.clientId === DYNAMIC ? returnedClient : t.clientId;
    if (!text(code, 4096) || !text(clientId, 500) || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || (t.clientId !== DYNAMIC && returnedClient && returnedClient !== t.clientId)) {
      throw new ChatGPTAuthError('ChatGPT did not return the expected client registration.', 'invalid_client');
    }
    const d = await discovery();
    let response;
    try {
      response = await fetchJson(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: clientId, code, code_verifier: t.verifier, redirect_uri: t.redirectUri, resource: RESOURCE }) });
    } catch (e) {
      if (e.code === 'invalid_grant') retries.set(transaction, { clientId, subject: t.subject, accountId: t.accountId, expiresAt: now() + 600_000 });
      throw e;
    }
    const who = await identity(response.id_token, clientId, t.nonce, t.subject);
    const scopes = typeof response.scope === 'string' ? response.scope.split(/\s+/).filter(Boolean) : [];
    const hasPlan = scopes.includes(DIRECT_SCOPE) && scopes.includes('resource.invoke');
    const tokens = hasPlan ? tokenSet(response) : null;
    await locked(async () => {
      const store = await readStore(), id = accountKey(clientId, who.sub);
      if (t.accountId && id !== t.accountId) throw new ChatGPTAuthError('ChatGPT returned a different account.', 'invalid_identity');
      const old = store.accounts.find(a => a.id === id);
      const account = validateAccount({ id, issuer: ISSUER, subject: who.sub, client_id: clientId, email: text(who.email, 320) ? who.email : null, models: old?.models || EMPTY_MODELS(), tokens, plan_enabled: hasPlan, usage_blocked: old?.usage_blocked });
      store.accounts = store.accounts.filter(a => a.id !== id); store.accounts.push(account); store.activeAccountId = id;
      await saveStore(store);
    });
  }
  async function getAuthContext() {
    requireEnabled();
    return locked(async () => {
      const store = await readStore(), account = active(store);
      if (!connected(account)) throw new ChatGPTAuthError('Connect a ChatGPT account with ChatGPT plan usage enabled.', 'not_connected');
      if (account.tokens.expires_at <= now() + 60_000) {
        const d = await discovery();
        let response;
        try {
          response = await fetchJson(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
            grant_type: 'refresh_token', client_id: account.client_id, refresh_token: account.tokens.refresh_token, resource: RESOURCE }) });
        } catch (e) {
          if (TERMINAL_REFRESH.has(e.code)) { account.tokens = null; await saveStore(store); }
          throw e;
        }
        const tokens = tokenSet(response, account.tokens, false);
        if (response.id_token) await identity(response.id_token, account.client_id, null, account.subject);
        account.tokens = tokens; account.plan_enabled = tokens.scopes.includes(DIRECT_SCOPE) && tokens.scopes.includes('resource.invoke'); await saveStore(store);
        if (!connected(account)) throw new ChatGPTAuthError('ChatGPT plan permission is disabled. Sign in again to enable it.', 'plan_permission_disabled');
      }
      return { accessToken: account.tokens.access_token, accountId: account.id, models: { ...account.models }, usageBlocked: account.usage_blocked };
    });
  }
  async function getAccessToken() { return (await getAuthContext()).accessToken; }
  async function selectAccount(id) {
    requireEnabled();
    await locked(async () => {
      const store = await readStore();
      if (!store.accounts.some(a => a.id === id)) throw new ChatGPTAuthError('That ChatGPT account was not found.', 'account_not_found');
      store.activeAccountId = id; await saveStore(store);
    });
  }
  async function setModels(models, expectedAccountId) {
    requireEnabled();
    const value = validateModels(models);
    await locked(async () => {
      const store = await readStore(), account = active(store);
      if (!account) throw new ChatGPTAuthError('Connect a ChatGPT account first.', 'not_connected');
      if (expectedAccountId && account.id !== expectedAccountId) throw new ChatGPTAuthError('The active ChatGPT account changed. Reload the page and choose its models again.', 'account_changed');
      account.models = value; await saveStore(store);
    });
  }
  async function setUsageBlocked(accountId, blocked) {
    requireEnabled();
    await locked(async () => {
      const store = await readStore(), account = store.accounts.find(a => a.id === accountId);
      if (!account) throw new ChatGPTAuthError('That ChatGPT account was not found.', 'account_not_found');
      account.usage_blocked = blocked; await saveStore(store);
    });
  }
  async function markAccountUsageBlocked(accountId) { await setUsageBlocked(accountId, true); }
  async function clearAccountUsageBlock(accountId) { await setUsageBlocked(accountId, false); }
  async function disconnectAccount(id) {
    requireEnabled();
    return locked(async () => {
      const store = await readStore(), account = store.accounts.find(a => a.id === (id || store.activeAccountId));
      if (!account) throw new ChatGPTAuthError('That ChatGPT account was not found.', 'account_not_found');
      let revoked = !account.tokens?.refresh_token;
      try {
        if (!revoked) {
          const d = await discovery();
          if (d.revocation_endpoint) for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const response = await request(d.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
                token: account.tokens.refresh_token, token_type_hint: 'refresh_token', client_id: account.client_id }) });
              if (response.status === 200) { revoked = true; break; }
              if (response.status < 500) break;
            } catch { /* retry network failures with bounded backoff */ }
            if (attempt < 2) await pause(200 * 2 ** attempt);
          }
        }
      } catch { /* Always forget local tokens; report whether remote revocation was confirmed. */ }
      account.tokens = null; await saveStore(store);
      return { revoked };
    });
  }
  async function exportCredentials(path) {
    requireEnabled();
    const target = resolve(path);
    await locked(async () => {
      const store = await readStore(), account = active(store);
      if (!connected(account)) throw new ChatGPTAuthError('Connect a ChatGPT account before exporting.', 'not_connected');
      const parent = await statSafe(dirname(target));
      if (!parent?.isDirectory()) throw new ChatGPTAuthError('Choose an existing private export directory.', 'unsafe_storage');
      await writeJson(target, { version: 1, account }, { exclusive: true });
    });
  }
  async function importCredentials(path) {
    requireEnabled();
    const imported = await readJson(resolve(path));
    if (imported?.version !== 1 || !imported.account) throw new ChatGPTAuthError('Choose an export created by this app.', 'invalid_storage');
    const account = validateAccount(imported.account);
    if (!connected(account)) throw new ChatGPTAuthError('The exported account has no ChatGPT plan permission.', 'not_connected');
    // An imported file cannot substitute an unverified identity/client mapping. Export soon after login.
    const who = await identity(account.tokens.id_token, account.client_id, null, account.subject, { imported: true });
    account.email = text(who.email, 320) ? who.email : null;
    await locked(async () => {
      await ensureHostUnlocked();
      const store = await readStore();
      store.accounts = store.accounts.filter(a => a.id !== account.id); store.accounts.push(validateAccount(account));
      store.activeAccountId = account.id; await saveStore(store);
    });
  }
  return { ensureHost, getChatGPTStatus, createLogin, completeLogin, getAuthContext, getAccessToken, selectAccount, setModels, markAccountUsageBlocked, clearAccountUsageBlock, disconnectAccount, exportCredentials, importCredentials };
}

const client = createAuthClient();
export const { ensureHost, getChatGPTStatus, createLogin, completeLogin, getAuthContext, getAccessToken, selectAccount, setModels, markAccountUsageBlocked, clearAccountUsageBlock, disconnectAccount, exportCredentials, importCredentials } = client;
