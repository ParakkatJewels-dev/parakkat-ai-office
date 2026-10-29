import test from 'node:test';
import assert from 'node:assert/strict';
import { createHiggsfieldMcpClient, selectedHiggsfieldWorkspace, unwrapHiggsfieldResult } from '../src/lib/higgsfield/mcp.mjs';

const structured = value => ({ content: [], structuredContent: value });
function transport({ result = { done: true }, workspace = 'workspace', format = 'json', failure, auth = {} } = {}) {
  const calls = []; let cancelled = false;
  const client = createHiggsfieldMcpClient({
    getAuthContext: async options => { assert.equal(options.expectedAccountId, 'account'); return { accessToken: 'private-token', accountId: 'account', workspaceId: 'workspace', ...auth }; },
    fetch: async (url, init) => {
      assert.equal(url, 'https://mcp.higgsfield.ai/mcp'); assert.equal(init.redirect, 'error');
      const body = JSON.parse(init.body); calls.push({ body, headers: init.headers });
      assert.equal(init.headers.authorization, 'Bearer private-token');
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: {} } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'private-session' } });
      if (body.method === 'tools/call' && ['list_workspaces', 'workspace_list'].includes(body.params.name)) return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: structured({ workspaces: [{ id: workspace, is_selected: true }] }) }), { headers: { 'content-type': 'application/json' } });
      if (failure) return failure(body, init);
      const response = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
      if (format === 'sse') return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(': heartbeat\r\n\r\nevent: message\r\ndata: ' + response + '\r\n\r\n')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
      return new Response(response, { headers: { 'content-type': 'application/json' } });
    },
  });
  return { client, calls, cancelled: () => cancelled };
}
const options = { expectedAccountId: 'account' };
test('MCP initializes, carries its private session, checks workspace and unwraps structured data', async () => {
  const f = transport({ result: structured({ jobs: [{ id: 'job' }] }) });
  assert.deepEqual(await f.client.callHiggsfieldTool('generate_image', { params: { prompt: 'test' } }, options), { jobs: [{ id: 'job' }] });
  assert.deepEqual(f.calls.map(row => row.body.method), ['initialize', 'notifications/initialized', 'tools/call', 'tools/call']);
  assert.equal(f.calls.at(-1).headers['mcp-session-id'], 'private-session');
  assert.equal(f.calls.at(-1).body.params.name, 'generate_image');
});
test('SSE resolves the matching JSON-RPC message and cancels the long-lived stream', async () => {
  const f = transport({ result: { content: [{ type: 'text', text: '{"job_id":"job"}' }] }, format: 'sse' });
  assert.deepEqual(await f.client.callHiggsfieldTool('generate_image', {}, options), { job_id: 'job' });
  assert.equal(f.cancelled(), true);
});
test('Workspace drift prevents generation before submission', async () => {
  const f = transport({ workspace: 'changed' });
  await assert.rejects(f.client.callHiggsfieldTool('generate_image', {}, options), { code: 'workspace_changed', submittedUnknown: false });
  assert.equal(f.calls.some(row => row.body.params?.name === 'generate_image'), false);
});
test('Generation network failures mark unknown outcome and never retry', async () => {
  const f = transport({ failure: async () => { throw new Error('private-token should never leak'); } });
  await assert.rejects(f.client.callHiggsfieldTool('generate_image', {}, options), error => error.code === 'network_error' && error.submittedUnknown && !error.message.includes('private-token'));
  assert.equal(f.calls.filter(row => row.body.params?.name === 'generate_image').length, 1);
});
test('Generation timeout marks unknown outcome and bounds a hung response', async () => {
  const f = transport({ failure: async (_body, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('late')), 100);
    init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  }) });
  await assert.rejects(f.client.callHiggsfieldTool('generate_image', {}, { ...options, timeoutMs: 20 }), { code: 'request_aborted', submittedUnknown: true });
  assert.equal(f.calls.filter(row => row.body.params?.name === 'generate_image').length, 1);
});
test('HTTP and provider errors are sanitized; server errors retain unknown outcome', async () => {
  const server = transport({ failure: async () => new Response('access-secret', { status: 503 }) });
  await assert.rejects(server.client.callHiggsfieldTool('generate_image', {}, options), { code: 'http_error', status: 503, submittedUnknown: true });
  const denied = transport({ failure: async () => new Response('access-secret', { status: 401 }) });
  await assert.rejects(denied.client.callHiggsfieldTool('generate_image', {}, options), { code: 'not_authorized', submittedUnknown: false });
  assert.throws(() => unwrapHiggsfieldResult({ isError: true, content: [{ type: 'text', text: 'secret' }] }), error => !error.message.includes('secret'));
});
test('Read-only list-tools and account calls do not perform a mutation or select a workspace', async () => {
  const f = transport({ result: { tools: [{ name: 'generate_image', inputSchema: {} }] } });
  const response = await f.client.listHiggsfieldTools(options);
  assert.equal(response.tools[0].name, 'generate_image');
  assert.equal(f.calls.at(-1).body.method, 'tools/list');
  assert.equal(f.calls.some(row => row.body.params?.name === 'workspace_select'), false);
  assert.throws(() => selectedHiggsfieldWorkspace({ workspaces: [] }), { code: 'invalid_workspace' });
});
test('RPC rejection identifies the exact safe method and tool without retaining provider error text', async () => {
  const f = transport({ failure: async body => new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Unknown tool get_profile with private-token', data: { errors: [{ loc: ['params', 'name'], input: 'private-token' }] } } }), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(f.client.callHiggsfieldTool('get_profile', {}, options), error => {
    assert.equal(error.rpcCode, -32602); assert.equal(error.rpcMethod, 'tools/call'); assert.equal(error.toolName, 'get_profile'); assert.equal(error.protocolVersion, '2025-03-26'); assert.equal(error.rejection, 'unknown_tool');
    assert.deepEqual(error.validationFields, ['params.name']); assert.equal(JSON.stringify(error).includes('private-token'), false); return true;
  });
});
test('MCP workspace guard uses the alias verified during OAuth, and catalog cursors are passed as RPC params', async () => {
  const f = transport({ auth: { workspaceTool: 'workspace_list' }, result: structured({ credits: 0 }) });
  await f.client.callHiggsfieldTool('balance', {}, options);
  assert.equal(f.calls[2].body.params.name, 'workspace_list');
  await f.client.listHiggsfieldTools({ ...options, cursor: 'opaque-cursor' });
  assert.deepEqual(f.calls.at(-1).body.params, { cursor: 'opaque-cursor' });
});
test('Own-app model discovery uses the exact native get action and rejects different metadata', async () => {
  const f = transport({ result: structured({ id: 'gpt_image_2_5', output_type: 'image' }) });
  await f.client.callHiggsfieldTool('models_get', { model_id: 'gpt_image_2_5', action: 'search' }, options);
  assert.deepEqual(f.calls.at(-1).body.params, { name: 'models_explore', arguments: { action: 'get', model_id: 'gpt_image_2_5' } });
  const other = transport({ result: structured({ id: 'another_model' }) });
  await assert.rejects(other.client.callHiggsfieldTool('models_get', { model_id: 'gpt_image_2_5' }, options), { code: 'invalid_model_response' });
});
test('Cost adapter always forces the native cost-only flag while preserving requested image settings', async () => {
  const f = transport({ result: structured({ cost: { credits: 7, credits_exact: 7.5 } }) });
  const params = { model: 'gpt_image_2_5', quality: 'high', variant: 'sunburst', resolution: '2k', use_unlim: false, get_cost: false };
  const result = await f.client.callHiggsfieldTool('estimate_image_cost', { params }, options);
  assert.deepEqual(result.cost, { credits: 7, credits_exact: 7.5 });
  assert.deepEqual(f.calls.at(-1).body.params, { name: 'generate_image', arguments: { params: { ...params, get_cost: true } } });
  assert.equal(params.get_cost, false); // The adapter does not mutate caller state.
  const calls = f.calls.filter(row => row.body.params?.name === 'generate_image');
  assert.equal(calls.length, 1); assert.equal(calls[0].body.params.arguments.params.get_cost, true);
});
test('A real image request is unchanged and an unexpected job in a quote is never retried', async () => {
  const real = transport({ result: structured({ results: [{ id: 'job' }] }) });
  const params = { model: 'gpt_image_2_5', prompt: 'Approved artwork', count: 1 };
  await real.client.callHiggsfieldTool('generate_image', { params }, options);
  assert.deepEqual(real.calls.at(-1).body.params.arguments, { params });
  assert.equal(Object.hasOwn(real.calls.at(-1).body.params.arguments.params, 'get_cost'), false);
  const quote = transport({ result: structured({ cost: { credits: 7 }, results: [{ id: 'unexpected-job' }] }) });
  await assert.rejects(quote.client.callHiggsfieldTool('estimate_image_cost', { params }, options), { code: 'cost_submission_unexpected', submittedUnknown: true });
  assert.equal(quote.calls.filter(row => row.body.params?.name === 'generate_image').length, 1);
});
test('Failed native cost requests stay cost-only and do not report a normal image submission', async () => {
  const f = transport({ failure: async () => { throw new Error('Connection lost'); } });
  await assert.rejects(f.client.callHiggsfieldTool('estimate_image_cost', { params: { model: 'gpt_image_2_5' } }, options), { code: 'network_error', submittedUnknown: false });
  const calls = f.calls.filter(row => row.body.params?.name === 'generate_image');
  assert.equal(calls.length, 1); assert.equal(calls[0].body.params.arguments.params.get_cost, true);
});
