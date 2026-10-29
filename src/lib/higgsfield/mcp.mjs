// Server only. Tokens and MCP session identifiers never leave this transport.
import { randomUUID } from 'node:crypto';
import { getHiggsfieldAuthContext } from './auth.mjs';

export const HIGGSFIELD_MCP_URL = 'https://mcp.higgsfield.ai/mcp';
const MAX_RESPONSE = 4 * 1024 * 1024;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export class HiggsfieldMcpError extends Error {
  constructor(message, code = 'higgsfield_mcp_error', { status, outcomeUnknown = false } = {}) {
    super(message); this.name = 'HiggsfieldMcpError'; this.code = code; this.status = status; this.outcomeUnknown = outcomeUnknown; this.submittedUnknown = outcomeUnknown;
  }
}

export function unwrapHiggsfieldResult(result) {
  if (!object(result)) throw new HiggsfieldMcpError('Higgsfield returned an invalid tool response.', 'invalid_response');
  if (result.isError) throw new HiggsfieldMcpError('Higgsfield could not complete this operation. Check the connection, model inputs and available credits.', 'provider_rejected');
  if (result.structuredContent != null) return result.structuredContent;
  if (result.content != null && !Array.isArray(result.content)) throw new HiggsfieldMcpError('Higgsfield returned invalid tool content.', 'invalid_response');
  const texts = (result.content || []).filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text);
  if (texts.length === 1) { try { return JSON.parse(texts[0]); } catch { return { text: texts[0] }; } }
  if (texts.length) { try { return JSON.parse(texts.join('\n')); } catch { return { text: texts.join('\n') }; } }
  return result;
}

/** Resolve the account's actual selected workspace; do not silently switch it. */
export function selectedHiggsfieldWorkspace(result) {
  const rows = Array.isArray(result) ? result : result?.workspaces ?? result?.data?.workspaces;
  if (!Array.isArray(rows)) throw new HiggsfieldMcpError('Higgsfield did not return workspace information.', 'invalid_workspace');
  const selected = rows.filter(row => row?.is_selected === true);
  if (selected.length !== 1 || typeof selected[0].id !== 'string' || !selected[0].id || selected[0].id.length > 500)
    throw new HiggsfieldMcpError('Select one Higgsfield workspace before connecting AI Office.', 'invalid_workspace');
  return { id: selected[0].id, name: typeof selected[0].name === 'string' ? selected[0].name.slice(0, 200) : 'Higgsfield workspace' };
}

async function rpcBody(response, id, signal) {
  if (!response.body) throw new HiggsfieldMcpError('Higgsfield returned an empty response.', 'invalid_response');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const sse = response.headers.get('content-type')?.includes('text/event-stream');
  let size = 0, buffer = '';
  const parse = text => { try { return JSON.parse(text); } catch { throw new HiggsfieldMcpError('Higgsfield returned an invalid response.', 'invalid_response'); } };
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) throw new HiggsfieldMcpError('Higgsfield returned too much data.', 'response_too_large');
      buffer += decoder.decode(value, { stream: true });
      if (sse) {
        buffer = buffer.replace(/\r\n/g, '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data || data === '[DONE]') continue;
          const message = parse(data);
          if (message.id === id) return message;
        }
      }
    }
    if (!sse) { const message = parse(buffer + decoder.decode()); if (message.id === id) return message; }
    throw new HiggsfieldMcpError('Higgsfield did not return the requested operation result.', 'invalid_response');
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Each operation owns its MCP session. Mutations are never retried automatically. */
export function createHiggsfieldMcpClient({ fetch: fetcher = globalThis.fetch, getAuthContext = getHiggsfieldAuthContext } = {}) {
  async function operate(method, params, options = {}) {
    const timeout = options.timeoutMs ?? 60_000;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 180_000) throw new HiggsfieldMcpError('Invalid Higgsfield request timeout.', 'invalid_request');
    const deadline = AbortSignal.timeout(timeout), signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const auth = await getAuthContext({ expectedAccountId: options.expectedAccountId, expectedWorkspaceId: options.expectedWorkspaceId });
    if (!auth?.accessToken) throw new HiggsfieldMcpError('Connect Higgsfield first.', 'not_connected');
    let session, protocol = '2025-03-26', submitted = false;
    async function sendRpc(rpcMethod, rpcParams, notification = false) {
      signal.throwIfAborted();
      const id = randomUUID(), headers = { authorization: `Bearer ${auth.accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': protocol };
      if (session) headers['mcp-session-id'] = session;
      let response;
      try {
        response = await fetcher(HIGGSFIELD_MCP_URL, { method: 'POST', headers, redirect: 'error', signal,
          body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method: rpcMethod, ...(rpcParams == null ? {} : { params: rpcParams }) }) });
      } catch { throw new HiggsfieldMcpError(signal.aborted ? 'Higgsfield request timed out or was cancelled. Check its job status before retrying.' : 'Could not reach Higgsfield. Check its job status before retrying.', signal.aborted ? 'request_aborted' : 'network_error', { outcomeUnknown: submitted }); }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new HiggsfieldMcpError(response.status === 401 ? 'Higgsfield authorization expired. Connect the account again.' : `Higgsfield request failed (HTTP ${response.status}).`, response.status === 401 ? 'not_authorized' : 'http_error', { status: response.status, outcomeUnknown: submitted && response.status >= 500 });
      }
      if (notification) { await response.body?.cancel().catch(() => {}); return null; }
      if (rpcMethod === 'initialize') {
        const value = response.headers.get('mcp-session-id');
        if (value && (value.length > 1024 || /[\r\n]/.test(value))) throw new HiggsfieldMcpError('Higgsfield returned an invalid session.', 'invalid_response');
        session = value || undefined;
      }
      let message;
      try { message = await rpcBody(response, id, signal); }
      catch (error) {
        if (error instanceof HiggsfieldMcpError) { error.outcomeUnknown = submitted; error.submittedUnknown = submitted; throw error; }
        throw new HiggsfieldMcpError('Higgsfield response was interrupted. Check its job status before retrying.', 'request_aborted', { outcomeUnknown: submitted });
      }
      if (message.jsonrpc !== '2.0' || message.error || !Object.hasOwn(message, 'result')) {
        const error = new HiggsfieldMcpError('Higgsfield rejected this operation.', 'rpc_error', { outcomeUnknown: submitted });
        if (Number.isSafeInteger(message.error?.code)) error.rpcCode = message.error.code;
        const providerMessage = typeof message.error?.message === 'string' ? message.error.message.slice(0, 2000) : '';
        if (/unknown tool|tool[^\n]{0,150}not found|no tool (?:with|named)/i.test(providerMessage)) error.rejection = 'unknown_tool';
        else if (/invalid param|invalid argument|validation|missing required/i.test(providerMessage)) error.rejection = 'invalid_params';
        const issues = Array.isArray(message.error?.data) ? message.error.data : message.error?.data?.errors;
        if (Array.isArray(issues)) error.validationFields = issues.slice(0, 10).map(issue => issue?.loc ?? issue?.path).filter(path => Array.isArray(path) && path.length > 0 && path.length <= 8 && path.every(part => typeof part === 'string' && /^[A-Za-z_$][A-Za-z0-9_$-]{0,79}$/.test(part) || Number.isSafeInteger(part) && part >= 0 && part <= 1000)).map(path => path.join('.'));
        throw error;
      }
      return message.result;
    }
    async function rpc(rpcMethod, rpcParams, notification = false) {
      try { return await sendRpc(rpcMethod, rpcParams, notification); }
      catch (error) {
        if (error instanceof HiggsfieldMcpError) {
          error.rpcMethod = rpcMethod;
          if (rpcMethod === 'tools/call' && /^[a-z][a-z0-9_]{0,100}$/.test(rpcParams?.name)) error.toolName = rpcParams.name;
          if (/^\d{4}-\d{2}-\d{2}$/.test(protocol)) error.protocolVersion = protocol;
        }
        throw error;
      }
    }
    const initialized = await rpc('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'parakkat-ai-office', version: '1.0.0' } });
    if (!['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(initialized?.protocolVersion)) throw new HiggsfieldMcpError('Higgsfield selected an unsupported protocol.', 'protocol_error');
    protocol = initialized.protocolVersion;
    await rpc('notifications/initialized', null, true);
    // Tokens can remain valid when a user switches their workspace elsewhere.
    if (auth.workspaceId && method === 'tools/call' && !['get_profile', 'list_workspaces', 'workspace_list'].includes(params.name)) {
      const workspaceTool = auth.workspaceTool === 'workspace_list' ? 'workspace_list' : 'list_workspaces';
      const current = selectedHiggsfieldWorkspace(unwrapHiggsfieldResult(await rpc('tools/call', { name: workspaceTool, arguments: {} })));
      if (current.id !== auth.workspaceId) throw new HiggsfieldMcpError('The Higgsfield workspace changed. Reconnect before generating.', 'workspace_changed');
    }
    submitted = method === 'tools/call' && !['get_profile', 'list_workspaces', 'workspace_list', 'balance', 'models_list', 'models_get', 'models_explore', 'models_search', 'models_recommend', 'jobs_wait'].includes(params.name)
      && !(params.name === 'generate_image' && params.arguments?.params?.get_cost === true);
    return rpc(method, params);
  }
  return {
    async callHiggsfieldTool(name, args = {}, options = {}) {
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,100}$/.test(name) || !object(args)) throw new HiggsfieldMcpError('Invalid Higgsfield operation.', 'invalid_request');
      // The app's own OAuth client exposes the generic MCP catalog, which differs
      // from the ChatGPT plugin. These two routes were verified from its live schema.
      let nativeName = name, nativeArgs = args;
      if (name === 'models_get') {
        if (typeof args.model_id !== 'string' || !args.model_id || args.model_id.length > 200) throw new HiggsfieldMcpError('Choose a valid Higgsfield model.', 'invalid_request');
        nativeName = 'models_explore'; nativeArgs = { action: 'get', model_id: args.model_id };
      } else if (name === 'estimate_image_cost') {
        if (!object(args.params) || typeof args.params.model !== 'string' || !args.params.model) throw new HiggsfieldMcpError('Choose a Higgsfield model before requesting its cost.', 'invalid_request');
        // Place this last: even a caller-supplied false must never submit a quote.
        nativeName = 'generate_image'; nativeArgs = { params: { ...args.params, get_cost: true } };
      }
      const result = unwrapHiggsfieldResult(await operate('tools/call', { name: nativeName, arguments: nativeArgs }, options));
      if (name === 'models_get' && result?.id !== args.model_id) throw new HiggsfieldMcpError('Higgsfield did not return the requested model metadata.', 'invalid_model_response');
      if (name === 'estimate_image_cost' && Array.isArray(result?.results) && result.results.length) throw new HiggsfieldMcpError('Higgsfield unexpectedly returned a generation for a cost request. Check its Assets before retrying.', 'cost_submission_unexpected', { outcomeUnknown: true });
      return result;
    },
    async listHiggsfieldTools(options = {}) {
      if (options.cursor != null && (typeof options.cursor !== 'string' || !options.cursor || options.cursor.length > 4096)) throw new HiggsfieldMcpError('Invalid Higgsfield catalog cursor.', 'invalid_request');
      return operate('tools/list', options.cursor ? { cursor: options.cursor } : {}, options);
    },
  };
}
export const { callHiggsfieldTool, listHiggsfieldTools } = createHiggsfieldMcpClient();
export { HiggsfieldMcpError as HiggsfieldError };
