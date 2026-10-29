// Server only. OAuth credentials are encrypted in the existing private provider volume.
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open as openFile, readlink, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { keyFrom, seal, open as unseal } from '../connectors/oauth-core.mjs';

const ISSUER = 'https://clerk.higgsfield.ai';
const RESOURCE = 'https://mcp.higgsfield.ai/mcp';
const METADATA = `${ISSUER}/.well-known/oauth-authorization-server`;
const SCOPES = 'openid email offline_access';
const TERMINAL = new Set(['invalid_grant', 'invalid_client', 'invalid_token']);
const random = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const validText = (value, max = 32768) => typeof value === 'string' && value.length > 0 && value.length <= max;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const empty = () => ({ version: 1, revision: 0, clients: [], pending: [], account: null });
export const HIGGSFIELD_STATE_COOKIE = 'parakkat_higgsfield_oauth';
export class HiggsfieldAuthError extends Error {
  constructor(message, code = 'higgsfield_auth_error', status) { super(message); this.name = 'HiggsfieldAuthError'; this.code = code; this.status = status; }
}
export function safeHiggsfieldAuthError(error) {
  if (error instanceof HiggsfieldAuthError) return error.message;
  const messages = {
    not_authorized: 'Higgsfield rejected the account authorization. Connect again.',
    http_error: 'Higgsfield could not verify the account connection.',
    rpc_error: 'Higgsfield rejected an account verification operation.',
    provider_rejected: 'Higgsfield could not complete account verification.',
    invalid_response: 'Higgsfield returned an unsupported verification response.',
    invalid_workspace: 'Higgsfield did not identify one selected workspace.',
    protocol_error: 'Higgsfield selected an unsupported connection protocol.',
    network_error: 'Higgsfield account verification could not reach the provider.',
    request_aborted: 'Higgsfield account verification timed out or was interrupted.',
    response_too_large: 'Higgsfield returned too much verification data.',
  };
  if (error?.name === 'HiggsfieldMcpError' && Object.hasOwn(messages, error.code)) {
    const detail = Number.isInteger(error.rpcCode) ? `; RPC ${error.rpcCode}` : Number.isInteger(error.status) ? `; HTTP ${error.status}` : '';
    const method = ['initialize', 'notifications/initialized', 'tools/call', 'tools/list'].includes(error.rpcMethod) ? `; ${error.rpcMethod}` : '';
    const tool = typeof error.toolName === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(error.toolName) ? ` ${error.toolName}` : '';
    return `${messages[error.code]} (${error.code}${detail}${method}${tool})`;
  }
  return 'Higgsfield could not connect. Please try again.';
}

export function createHiggsfieldAuthClient(options = {}) {
  const env = options.env || process.env;
  const directory = () => resolve(options.directory || env.HIGGSFIELD_AUTH_DIR || join(env.GEMINI_CONFIG_DIR || join(homedir(), '.config/parakkat-ai-office/provider-secrets'), 'higgsfield'));
  const now = () => options.now?.() ?? Date.now();
  const fetcher = options.fetch || globalThis.fetch;
  const key = () => keyFrom(env.CREDENTIALS_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  const owner = process.getuid?.();
  let metadataCache, keysCache;
  function diagnostic(stage, error, catalog, shape) {
    const code = error?.name === 'HiggsfieldMcpError' && /^[a-z_]{1,50}$/.test(error.code || '') ? error.code : undefined;
    const event = { stage, ...(code ? { code } : {}), ...(Number.isSafeInteger(error?.rpcCode) ? { rpcCode: error.rpcCode } : {}), ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
      ...(['initialize', 'notifications/initialized', 'tools/call', 'tools/list'].includes(error?.rpcMethod) ? { rpcMethod: error.rpcMethod } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(error?.protocolVersion || '') ? { protocolVersion: error.protocolVersion } : {}),
      ...(/^[a-z][a-z0-9_]{0,100}$/.test(error?.toolName || '') ? { toolName: error.toolName } : {}),
      ...(['unknown_tool', 'invalid_params'].includes(error?.rejection) ? { rejection: error.rejection } : {}),
      ...(Array.isArray(error?.validationFields) ? { validationFields: error.validationFields.filter(field => typeof field === 'string' && /^[A-Za-z_$][A-Za-z0-9_$.-]{0,500}$/.test(field)).slice(0, 10) } : {}) };
    const safeName = value => typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$.-]{0,100}$/.test(value);
    if (catalog?.tools) {
      const wanted = new Set(['get_profile', 'profile', 'list_workspaces', 'workspace_list', 'balance', 'models_get', 'models_explore', 'models_list', 'estimate_image_cost', 'media_upload', 'media_confirm', 'generate_image', 'jobs_wait', 'job_status', 'get_preferences', 'create_project']);
      const rows = catalog.tools.filter(row => safeName(row?.name)).slice(0, 500);
      const fields = schema => {
        const found = [];
        function visit(value, path = '', depth = 0) {
          if (depth > 4 || !value?.properties || typeof value.properties !== 'object') return;
          for (const [name, property] of Object.entries(value.properties)) {
            if (!safeName(name) || found.length >= 120) continue;
            const field = path ? `${path}.${name}` : name;
            found.push({ field, required: Array.isArray(value.required) && value.required.includes(name), ...(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'].includes(property?.type) ? { type: property.type } : {}) });
            visit(property, field, depth + 1);
          }
        }
        visit(schema); return found;
      };
      event.catalog = { names: rows.map(row => row.name), more: !!catalog.nextCursor, schemas: rows.filter(row => wanted.has(row.name)).map(row => ({ name: row.name, inputFields: fields(row.inputSchema), outputFields: fields(row.outputSchema) })) };
    }
    if (shape && typeof shape === 'object' && !Array.isArray(shape)) event.resultFields = Object.keys(shape).filter(safeName).slice(0, 30);
    if (options.diagnostic) options.diagnostic(event);
    else console.error('[higgsfield-oauth-verification]', JSON.stringify(event));
  }
  function originFor(value) {
    let url;
    try { url = new URL(value); } catch { throw new HiggsfieldAuthError('AI Office has an invalid public URL.', 'invalid_origin'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new HiggsfieldAuthError('Use AI Office’s HTTPS address to connect Higgsfield.', 'invalid_origin');
    if (env.APP_URL && url.origin !== new URL(env.APP_URL).origin) throw new HiggsfieldAuthError('The Higgsfield callback does not match this AI Office.', 'invalid_origin');
    return url.origin;
  }
  async function statSafe(path) {
    const absolute = resolve(path), root = parse(absolute).root;
    let current = root;
    for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
      current = join(current, part);
      let stat; try { stat = await lstat(current); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (stat.isSymbolicLink()) {
        const systemAlias = process.platform === 'darwin' && ['/tmp', '/var', '/etc'].includes(current) && resolve(dirname(current), await readlink(current)) === `/private${current}`;
        if (!systemAlias) throw new HiggsfieldAuthError('Higgsfield storage cannot use symbolic links.', 'unsafe_storage');
      }
    }
    return lstat(absolute);
  }
  async function prepare() {
    const dir = directory(), previous = await statSafe(dir);
    if (previous && (!previous.isDirectory() || (owner != null && previous.uid !== owner))) throw new HiggsfieldAuthError('Higgsfield storage has an invalid owner or type.', 'unsafe_storage');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stat = await statSafe(dir);
    if (!stat?.isDirectory() || (owner != null && stat.uid !== owner)) throw new HiggsfieldAuthError('Higgsfield storage is unavailable.', 'unsafe_storage');
    await chmod(dir, 0o700);
    return dir;
  }
  async function readPrivate(path) {
    const stat = await statSafe(path);
    if (!stat) return null;
    if (!stat.isFile() || stat.size > 1_000_000 || (stat.mode & 0o077) || (owner != null && stat.uid !== owner)) throw new HiggsfieldAuthError('Higgsfield credentials require private file permissions.', 'unsafe_storage');
    const file = await openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const checked = await file.stat();
      if (checked.ino !== stat.ino || checked.dev !== stat.dev || !checked.isFile() || checked.size > 1_000_000 || (checked.mode & 0o077) || (owner != null && checked.uid !== owner)) throw new HiggsfieldAuthError('Higgsfield credential storage changed.', 'unsafe_storage');
      return await file.readFile('utf8');
    } finally { await file.close(); }
  }
  async function readStore() {
    const raw = await readPrivate(join(directory(), 'credentials.enc'));
    if (!raw) return empty();
    let value;
    try { value = unseal(raw, key()); } catch { throw new HiggsfieldAuthError('Higgsfield credentials could not be decrypted.', 'invalid_storage'); }
    if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.pending) || value.pending.length > 20 || !Array.isArray(value.clients) || value.clients.length > 10) throw new HiggsfieldAuthError('Higgsfield credential storage is invalid.', 'invalid_storage');
    return value;
  }
  async function saveStore(value) {
    const dir = directory(), target = join(dir, 'credentials.enc'), temporary = join(dir, `.${randomUUID()}.tmp`);
    await statSafe(target);
    let file;
    try {
      file = await openFile(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      await file.writeFile(seal(value, key())); await file.sync(); await file.close(); file = null;
      await rename(temporary, target);
    } finally { if (file) await file.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function locked(fn) {
    const dir = await prepare(), path = join(dir, 'auth.lock'), nonce = random(), started = Date.now();
    let lock;
    while (!lock) {
      try { lock = await openFile(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw new HiggsfieldAuthError('Higgsfield credentials could not be locked.', 'storage_error');
        await statSafe(path);
        if (Date.now() - started > (options.lockTimeoutMs ?? 20_000)) throw new HiggsfieldAuthError('Another Higgsfield connection update is running. Try again shortly.', 'credentials_locked');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try { await lock.writeFile(nonce); await lock.close(); lock = null; return await fn(); }
    finally { if (lock) await lock.close(); if (same(await readPrivate(path), nonce)) await unlink(path); }
  }
  function endpoint(value, path) {
    if (value !== `${ISSUER}${path}`) throw new HiggsfieldAuthError('Higgsfield returned an untrusted OAuth endpoint.', 'discovery_error');
    return value;
  }
  async function json(url, init = {}) {
    let response;
    const signal = AbortSignal.timeout(options.requestTimeoutMs ?? 15_000);
    try { response = await fetcher(url, { ...init, redirect: 'error', signal }); }
    catch { throw new HiggsfieldAuthError('Could not reach Higgsfield authorization. Try again later.', 'network_error'); }
    if (Number(response.headers.get('content-length')) > 1_000_000 || !response.body) { await response.body?.cancel().catch(() => {}); throw new HiggsfieldAuthError('Higgsfield authorization returned an invalid response.', 'invalid_response'); }
    const reader = response.body.getReader(), parts = []; let size = 0, data;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) throw new HiggsfieldAuthError('Higgsfield authorization returned too much data.', 'invalid_response');
        parts.push(value);
      }
      try { data = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { data = null; }
    } catch (error) {
      if (error instanceof HiggsfieldAuthError) throw error;
      throw new HiggsfieldAuthError('Higgsfield authorization was interrupted. Connect again.', 'network_error');
    } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!response.ok) {
      const code = TERMINAL.has(data?.error) ? data.error : 'oauth_request_failed';
      throw new HiggsfieldAuthError(`Higgsfield authorization failed (HTTP ${response.status}).${TERMINAL.has(code) ? ' Connect again.' : ''}`, code, response.status);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HiggsfieldAuthError('Higgsfield authorization returned an invalid response.', 'invalid_response');
    return data;
  }
  async function metadata() {
    if (metadataCache && now() - metadataCache.at < 3600_000) return metadataCache.value;
    const result = await json(METADATA);
    if (result.issuer !== ISSUER || !result.code_challenge_methods_supported?.includes('S256') || !result.grant_types_supported?.includes('authorization_code') || !result.token_endpoint_auth_methods_supported?.includes('none')) throw new HiggsfieldAuthError('Higgsfield OAuth capabilities could not be verified.', 'discovery_error');
    const value = { authorization: endpoint(result.authorization_endpoint, '/oauth/authorize'), token: endpoint(result.token_endpoint, '/oauth/token'), registration: endpoint(result.registration_endpoint, '/oauth/register'), jwks: endpoint(result.jwks_uri, '/.well-known/jwks.json'), revocation: endpoint(result.revocation_endpoint, '/oauth/token/revoke') };
    metadataCache = { at: now(), value }; return value;
  }
  async function identity(token, clientId, nonce, expectedSubject) {
    if (!validText(token)) throw new HiggsfieldAuthError('Higgsfield did not return a verifiable identity.', 'invalid_identity');
    const meta = await metadata();
    async function keys(force = false) {
      if (!force && keysCache && now() - keysCache.at < 3600_000) return keysCache.value;
      const result = await json(meta.jwks);
      if (!Array.isArray(result.keys) || result.keys.length > 100) throw new HiggsfieldAuthError('Higgsfield identity keys are invalid.', 'invalid_identity');
      keysCache = { at: now(), value: createLocalJWKSet(result) }; return keysCache.value;
    }
    try {
      const verify = keyset => jwtVerify(token, keyset, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'iat', 'exp'], algorithms: ['RS256'], currentDate: new Date(now()), clockTolerance: 5 });
      let payload;
      try { ({ payload } = await verify(await keys())); } catch (error) { if (error.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw error; ({ payload } = await verify(await keys(true))); }
      if (!validText(payload.sub, 500) || payload.iat > now() / 1000 + 5 || (nonce != null && !same(payload.nonce, nonce)) || (expectedSubject && payload.sub !== expectedSubject) || (payload.azp != null && payload.azp !== clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new Error('identity');
      return payload;
    } catch { throw new HiggsfieldAuthError('Higgsfield identity did not match this connection. Connect again.', 'invalid_identity'); }
  }
  function tokens(result, old) {
    const refresh = result.refresh_token || old?.refresh_token;
    const scopes = typeof result.scope === 'string' ? result.scope.split(/\s+/).filter(Boolean) : old?.scopes || SCOPES.split(' ');
    if (!validText(result.access_token) || !validText(refresh) || String(result.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in > 31_536_000 || !scopes.includes('openid') || !scopes.includes('offline_access')) throw new HiggsfieldAuthError('Higgsfield did not return renewable access.', 'invalid_tokens');
    return { access_token: result.access_token, refresh_token: refresh, expires_at: now() + result.expires_in * 1000, scopes };
  }
  async function getHiggsfieldStatus() {
    try {
      const account = (await readStore()).account;
      return { connected: !!account?.tokens?.access_token, ...(account ? { accountId: account.id, accountName: account.name, workspaceId: account.workspaceId, workspaceName: account.workspaceName } : {}), ...(account?.error ? { error: account.error } : {}) };
    } catch { return { connected: false, error: 'Higgsfield credentials could not be read safely. Check the server connection settings.' }; }
  }
  async function startHiggsfieldLogin(userId, origin) {
    if (!validText(userId, 500)) throw new HiggsfieldAuthError('Sign in to AI Office first.', 'invalid_user');
    key(); // Verify secure persistence is configured before registering a remote client.
    const base = originFor(origin), redirectUri = `${base}/api/higgsfield/callback`, meta = await metadata();
    return locked(async () => {
      const store = await readStore();
      let client = store.clients.find(item => item.redirectUri === redirectUri);
      if (!client) {
        const registered = await json(meta.registration, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Parakkat AI Office', client_uri: base, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPES }) });
        if (!validText(registered.client_id, 500) || (registered.token_endpoint_auth_method && registered.token_endpoint_auth_method !== 'none') || (registered.redirect_uris && (!Array.isArray(registered.redirect_uris) || !registered.redirect_uris.includes(redirectUri)))) throw new HiggsfieldAuthError('Higgsfield could not register this AI Office callback.', 'invalid_client');
        client = { id: registered.client_id, redirectUri };
        store.clients = [...store.clients.slice(-9), client];
      }
      const state = random(), nonce = random(), verifier = random(), expiresAt = now() + 600_000;
      store.pending = store.pending.filter(item => item.expiresAt > now() && item.userId !== userId).slice(-19);
      store.pending.push({ stateHash: digest(state), userId, nonce, verifier, redirectUri, clientId: client.id, expiresAt, revision: store.revision });
      await saveStore(store);
      const url = new URL(meta.authorization);
      url.search = new URLSearchParams({ client_id: client.id, response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: digestBase64(verifier) }).toString();
      return { url: url.toString(), state };
    });
  }
  async function finishHiggsfieldLogin(userId, callbackUrl, cookieState) {
    let callback; try { callback = new URL(callbackUrl); } catch { throw new HiggsfieldAuthError('Invalid Higgsfield callback.', 'invalid_state'); }
    const state = callback.searchParams.get('state');
    if (!validText(state, 200) || !same(state, cookieState)) throw new HiggsfieldAuthError('Higgsfield sign-in expired or did not start in this browser.', 'invalid_state');
    for (const field of ['state', 'code', 'error', 'iss']) if (callback.searchParams.getAll(field).length > 1) throw new HiggsfieldAuthError('Higgsfield callback contains duplicate parameters.', 'invalid_callback');
    const transaction = await locked(async () => {
      const store = await readStore(), found = store.pending.find(item => item.stateHash === digest(state));
      if (!found || found.userId !== userId || found.expiresAt <= now() || found.revision !== store.revision || callback.origin + callback.pathname !== found.redirectUri) throw new HiggsfieldAuthError('Higgsfield sign-in expired or belongs to another session.', 'invalid_state');
      store.pending = store.pending.filter(item => item !== found); await saveStore(store); return found;
    });
    if (callback.searchParams.has('error')) throw new HiggsfieldAuthError('Higgsfield sign-in was cancelled or declined.', 'access_denied');
    if (callback.searchParams.has('iss') && callback.searchParams.get('iss') !== ISSUER) throw new HiggsfieldAuthError('Higgsfield authorization issuer did not match.', 'invalid_identity');
    const code = callback.searchParams.get('code');
    if (!validText(code, 4096)) throw new HiggsfieldAuthError('Higgsfield did not return an authorization code.', 'invalid_callback');
    const meta = await metadata();
    let result;
    try { result = await json(meta.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: transaction.clientId, code, code_verifier: transaction.verifier, redirect_uri: transaction.redirectUri, resource: RESOURCE }) }); }
    catch (error) {
      if (error.code === 'invalid_client') await locked(async () => { const store = await readStore(); store.clients = store.clients.filter(client => client.id !== transaction.clientId); await saveStore(store); });
      throw error;
    }
    const who = await identity(result.id_token, transaction.clientId, transaction.nonce), tokenSet = tokens(result);
    const { createHiggsfieldMcpClient, selectedHiggsfieldWorkspace } = await import('./mcp.mjs');
    const mcp = options.mcp || createHiggsfieldMcpClient({ fetch: fetcher, getAuthContext: async () => ({ accessToken: tokenSet.access_token }) });
    let catalog;
    if (typeof mcp.listHiggsfieldTools === 'function') {
      try {
        catalog = { tools: [] };
        const seen = new Set(), deadline = Date.now() + 35_000;
        for (let page = 0; page < 8; page++) {
          const timeoutMs = deadline - Date.now();
          if (timeoutMs < 1) throw new HiggsfieldAuthError('Higgsfield connection discovery timed out. Connect again.', 'catalog_timeout');
          const result = await mcp.listHiggsfieldTools({ ...(catalog.nextCursor ? { cursor: catalog.nextCursor } : {}), timeoutMs });
          if (!Array.isArray(result?.tools) || result.tools.length + catalog.tools.length > 1500) throw new HiggsfieldAuthError('Higgsfield returned an invalid connection catalog.', 'invalid_catalog');
          catalog.tools.push(...result.tools);
          catalog.nextCursor = result.nextCursor;
          if (!catalog.nextCursor) break;
          if (!validText(catalog.nextCursor, 4096) || seen.has(catalog.nextCursor)) throw new HiggsfieldAuthError('Higgsfield returned an invalid catalog cursor.', 'invalid_catalog');
          seen.add(catalog.nextCursor);
        }
        if (catalog.nextCursor) throw new HiggsfieldAuthError('Higgsfield connection discovery exceeded the supported catalog size.', 'invalid_catalog');
        diagnostic('catalog', null, catalog);
      } catch (error) { diagnostic('catalog_failed', error, catalog); throw new HiggsfieldAuthError(`Higgsfield sign-in succeeded, but connection discovery failed. ${safeHiggsfieldAuthError(error)}`, 'verify_catalog'); }
    }
    const acceptsEmpty = tool => tool && (!Array.isArray(tool.inputSchema?.required) || tool.inputSchema.required.length === 0);
    const toolByName = name => catalog?.tools.find(tool => tool?.name === name);
    const verifyTool = async (name, label) => {
      try { return await mcp.callHiggsfieldTool(name, {}); }
      catch (error) { diagnostic('verification_failed', error); throw new HiggsfieldAuthError(`Higgsfield sign-in succeeded, but ${label} failed. ${safeHiggsfieldAuthError(error)}`, `verify_${name}`); }
    };
    // Generic MCP clients need not expose the ChatGPT plugin's optional profile tool.
    // The signed OIDC subject already verifies this exact OAuth account/client/nonce.
    const profile = !catalog || acceptsEmpty(toolByName('get_profile')) ? await verifyTool('get_profile', 'account verification') : { id: who.sub, name: validText(who.name, 200) ? who.name : who.email_verified === true && validText(who.email, 200) ? who.email : 'Higgsfield account' };
    if (!validText(profile?.id, 500) || profile.id !== who.sub) throw new HiggsfieldAuthError('Higgsfield returned a different account identity.', 'invalid_identity');
    const workspaceTool = catalog ? ['list_workspaces', 'workspace_list'].find(name => acceptsEmpty(toolByName(name))) : 'list_workspaces';
    if (!workspaceTool) throw new HiggsfieldAuthError('Higgsfield sign-in succeeded, but this connection does not expose supported workspace discovery. Its tool catalog has been recorded for verification.', 'verify_workspace_catalog');
    let workspace;
    let workspaceResult;
    try { workspaceResult = await verifyTool(workspaceTool, 'workspace discovery'); workspace = selectedHiggsfieldWorkspace(workspaceResult); }
    catch (error) { if (error instanceof HiggsfieldAuthError) throw error; diagnostic('workspace_selection_failed', error, null, workspaceResult); throw new HiggsfieldAuthError(`Higgsfield sign-in succeeded, but workspace selection could not be verified. ${safeHiggsfieldAuthError(error)}`, 'verify_workspace'); }
    await locked(async () => {
      const store = await readStore();
      if (store.revision !== transaction.revision) throw new HiggsfieldAuthError('The Higgsfield connection changed during sign-in. Connect again.', 'connection_changed');
      store.account = { id: profile.id, subject: who.sub, name: validText(profile.name, 200) ? profile.name : 'Higgsfield account', workspaceId: workspace.id, workspaceName: workspace.name, workspaceTool, clientId: transaction.clientId, tokens: tokenSet };
      store.revision++; store.pending = []; await saveStore(store);
    });
    return getHiggsfieldStatus();
  }
  async function getHiggsfieldAuthContext({ expectedAccountId, expectedWorkspaceId } = {}) {
    return locked(async () => {
      const store = await readStore(), account = store.account;
      if (!account?.tokens?.access_token) throw new HiggsfieldAuthError('Connect a Higgsfield account first.', 'not_connected');
      if ((expectedAccountId && account.id !== expectedAccountId) || (expectedWorkspaceId && account.workspaceId !== expectedWorkspaceId)) throw new HiggsfieldAuthError('The Higgsfield account or workspace changed. Prepare a new request.', 'account_changed');
      if (account.tokens.expires_at <= now() + 60_000) {
        try {
          const meta = await metadata(), result = await json(meta.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.tokens.refresh_token, resource: RESOURCE }) });
          if (result.id_token) await identity(result.id_token, account.clientId, null, account.subject);
          account.tokens = tokens(result, account.tokens); delete account.error; await saveStore(store);
        } catch (error) {
          if (TERMINAL.has(error.code) || error.code === 'invalid_identity') {
            if (error.code === 'invalid_client') store.clients = store.clients.filter(client => client.id !== account.clientId);
            account.tokens = null; account.error = 'Higgsfield authorization expired. Connect again.'; store.revision++; store.pending = []; await saveStore(store);
          }
          throw error;
        }
      }
      return { accessToken: account.tokens.access_token, accountId: account.id, workspaceId: account.workspaceId, workspaceTool: account.workspaceTool === 'workspace_list' ? 'workspace_list' : 'list_workspaces' };
    });
  }
  async function disconnectHiggsfield() {
    return locked(async () => {
      const store = await readStore(), account = store.account;
      // Forget first: a failed revocation must never leave this app connected.
      store.account = null; store.pending = []; store.revision++; await saveStore(store);
      if (!account?.tokens?.refresh_token) return { revoked: true };
      let revoked = false;
      try {
        const meta = await metadata();
        const response = await fetcher(meta.revocation, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: account.tokens.refresh_token, token_type_hint: 'refresh_token', client_id: account.clientId }) });
        revoked = response.ok; await response.body?.cancel().catch(() => {});
      } catch { /* Local credentials have already been removed. */ }
      return { revoked };
    });
  }
  return { getHiggsfieldStatus, startHiggsfieldLogin, finishHiggsfieldLogin, getHiggsfieldAuthContext, disconnectHiggsfield };
}
const digestBase64 = value => createHash('sha256').update(value).digest('base64url');
export const { getHiggsfieldStatus, startHiggsfieldLogin, finishHiggsfieldLogin, getHiggsfieldAuthContext, disconnectHiggsfield } = createHiggsfieldAuthClient();
