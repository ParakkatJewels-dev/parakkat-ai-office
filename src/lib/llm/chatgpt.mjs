// Server/CLI only. ChatGPT plan usage uses the public Responses endpoint, never backend-api.
import { createHash } from 'node:crypto';
const API = 'https://api.openai.com/v1';
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_BYTES = 4 * 1024 * 1024;
const CATALOG_MS = 5 * 60_000;
const lowReasoningModel = model => /^gpt-(?:6(?:\.1)?-(?:astra|sol|luna)|5\.6(?:-(?:astra|sol|luna))?)(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
const outputLimit = value => Number.isFinite(value) ? Math.max(256, Math.min(8000, Math.trunc(value))) : 2400;

// A cancelled caller must not cancel a model-catalog request shared by another caller.
function waitFor(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { void promise.catch(() => {}); reject(signal.reason); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

export class ChatGPTError extends Error {
  constructor(message, code = 'chatgpt_error') {
    super(message);
    this.name = 'ChatGPTError';
    this.code = code;
  }
}

const validCount = value => Number.isSafeInteger(value) && value >= 0;
function responseUsage(response) {
  const usage=response?.usage;
  return { model:typeof response?.model==='string'?response.model:null,
    inputTokens:validCount(usage?.input_tokens)?usage.input_tokens:0,
    outputTokens:validCount(usage?.output_tokens)?usage.output_tokens:0,
    usageKnown:validCount(usage?.input_tokens)&&validCount(usage?.output_tokens),
    reasoningTokens:validCount(usage?.output_tokens_details?.reasoning_tokens)?usage.output_tokens_details.reasoning_tokens:null };
}
const withUsage = (error,usage) => {
  if(usage.usageKnown)error.usage={model:usage.model,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,usageKnown:true,reasoningTokens:usage.reasoningTokens};
  return error;
};

function providerError(status, code, requestId) {
  const failure = (message, category) => {
    const error = new ChatGPTError(message, category);
    error.status = status || undefined;
    if (typeof code === 'string' && /^[a-zA-Z0-9_]{1,120}$/.test(code)) error.providerCode = code;
    if (typeof requestId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(requestId)) error.requestId = requestId;
    return error;
  };
  if (code === 'subscription_sharing_usage_limit_exceeded')
    return failure('The ChatGPT app usage limit has been reached. Review the app’s limits in ChatGPT Settings → Usage before trying again.', 'usage_limit');
  if (status === 429)
    return failure('ChatGPT is receiving requests too quickly. Wait briefly before trying again.', 'rate_limit');
  if (code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable')
    return failure('ChatGPT could not check usage availability right now. Your connection is saved; try again later.', 'usage_unavailable');
  if (code === 'subscription_sharing_user_not_eligible')
    return failure('ChatGPT plan usage is not available to this user or workspace under its current policy. Check account eligibility with OpenAI.', 'ineligible');
  if (code === 'subscription_sharing_unsupported_capability')
    return failure('This ChatGPT plan connection does not support part of the request. Check the selected model and requested features.', 'unsupported');
  if (status === 401 || code === 'invalid_token' || code === 'token_expired')
    return failure('ChatGPT rejected the account’s authorization. Check its plan permission and reconnect the saved account if its access was revoked.', 'authentication');
  if (status === 403)
    return failure('This ChatGPT account has not allowed this request. Check the app’s plan permission, workspace policy, and selected model.', 'permission');
  if (status >= 500)
    return failure('ChatGPT is temporarily unavailable. Try again shortly.', 'unavailable');
  return failure('ChatGPT could not complete the request. Check the selected model and try again.', 'request_failed');
}

async function boundedJSON(response, maxBytes = 1024 * 1024) {
  if (!response.body) throw new ChatGPTError('ChatGPT returned an empty response.', 'invalid_response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ChatGPTError('ChatGPT returned an unexpectedly large response.', 'response_too_large');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ChatGPTError('ChatGPT returned an unreadable response.', 'invalid_response'); }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Read SSE through its terminal event; text deltas alone are never a successful response. */
export async function consumeResponsesStream(body, { maxBytes = MAX_STREAM_BYTES, maxTextBytes = MAX_TEXT_BYTES } = {}) {
  if (!body) throw new ChatGPTError('ChatGPT returned an empty stream.', 'interrupted');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', dataLines = [], eventBytes = 0, bytes = 0, text = '', textBytes = 0, refused = false;
  const addText = value => {
    if (typeof value !== 'string') throw new ChatGPTError('ChatGPT returned an unreadable text event.', 'invalid_stream');
    textBytes += Buffer.byteLength(value);
    if (textBytes > maxTextBytes) throw new ChatGPTError('The ChatGPT response exceeded the app’s output limit.', 'response_too_large');
    text += value;
  };
  const dispatch = () => {
    if (!dataLines.length) return null;
    const raw = dataLines.join('\n');
    dataLines = []; eventBytes = 0;
    if (raw === '[DONE]') throw new ChatGPTError('The ChatGPT stream ended before completion. Retry the request.', 'interrupted');
    let event;
    try { event = JSON.parse(raw); } catch { throw new ChatGPTError('ChatGPT returned an unreadable stream event.', 'invalid_stream'); }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string')
      throw new ChatGPTError('ChatGPT returned an invalid stream event.', 'invalid_stream');
    if (event.type === 'response.output_text.delta') addText(event.delta);
    if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') refused = true;
    if (event.type === 'response.failed') throw withUsage(providerError(0, event.response?.error?.code),responseUsage(event.response));
    if (event.type === 'error') throw providerError(0, event.code || event.error?.code);
    if (event.type === 'response.incomplete')
      throw withUsage(new ChatGPTError('ChatGPT returned an incomplete response. Retry with a smaller request.', 'incomplete'),responseUsage(event.response));
    if (event.type !== 'response.completed') return null;
    const response = event.response;
    const terminalUsage = responseUsage(response);
    try {
      if (!response || response.status !== 'completed')
        throw new ChatGPTError('ChatGPT did not confirm a completed response.', 'incomplete');
      const parts = Array.isArray(response.output)
        ? response.output.flatMap(item => Array.isArray(item?.content) ? item.content : []) : [];
      if (refused || parts.some(part => part?.type === 'refusal'))
        throw new ChatGPTError('ChatGPT declined this request. Revise the instructions and try again.', 'refusal');
      const finalParts = parts.filter(part => part?.type === 'output_text');
      if (finalParts.length) {
        text = ''; textBytes = 0;
        for (const part of finalParts) addText(part.text);
      }
      if (!text.trim()) throw new ChatGPTError('ChatGPT completed without a text answer.', 'empty_response');
      return {text,...terminalUsage};
    } catch (error) {
      if (error instanceof ChatGPTError) throw withUsage(error, terminalUsage);
      throw error;
    }
  };
  const line = value => {
    if (!value) return dispatch();
    if (value.startsWith('data:')) {
      const data = value.slice(5).replace(/^ /, '');
      eventBytes += Buffer.byteLength(data);
      if (eventBytes > MAX_EVENT_BYTES) throw new ChatGPTError('ChatGPT returned an unexpectedly large event.', 'response_too_large');
      dataLines.push(data);
    }
    return null;
  };
  const readLines = final => {
    for (;;) {
      const at = buffer.search(/[\r\n]/);
      if (at < 0) return null;
      // A CR at the end of a chunk might be the first half of CRLF.
      if (!final && buffer[at] === '\r' && at === buffer.length - 1) return null;
      const width = buffer[at] === '\r' && buffer[at + 1] === '\n' ? 2 : 1;
      const value = buffer.slice(0, at);
      buffer = buffer.slice(at + width);
      const result = line(value);
      if (result) return result;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const result = readLines(true);
        if (result) return result;
        throw new ChatGPTError('The ChatGPT stream was interrupted before completion. Retry the request.', 'interrupted');
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new ChatGPTError('The ChatGPT stream exceeded the app’s response limit.', 'response_too_large');
      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) throw new ChatGPTError('ChatGPT returned an unexpectedly large event.', 'response_too_large');
      const result = readLines(false);
      if (result) return result;
    }
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    throw new ChatGPTError('The ChatGPT stream was interrupted or unreadable. Retry the request.', 'interrupted');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Injectable dependencies keep protocol tests independent of real credentials and network requests. */
export function createChatGPTClient({
  getAuthContext = async () => (await import('../chatgpt/auth.mjs')).getAuthContext(),
  markAccountUsageBlocked = async accountId => (await import('../chatgpt/auth.mjs')).markAccountUsageBlocked(accountId),
  clearAccountUsageBlock = async accountId => (await import('../chatgpt/auth.mjs')).clearAccountUsageBlock(accountId),
  fetch: request = globalThis.fetch,
  env = process.env,
  now = Date.now,
} = {}) {
  // A failed disk write still backs off locally. Successful writes use only shared state,
  // so a Resume from another CLI/web process takes effect immediately.
  const locallyBlocked = new Map();
  const catalogs = new Map();
  const call = async (url, options) => {
    try { return await request(url, options); }
    catch { throw new ChatGPTError('Could not reach ChatGPT before the request timed out. Check the server’s connection and try again.', 'network'); }
  };
  const check = async response => {
    if (response.ok) return;
    const data = await boundedJSON(response).catch(() => null);
    throw providerError(response.status, data?.error?.code, response.headers.get('openai-request-id') || response.headers.get('x-request-id'));
  };
  const fetchCatalog = async accessToken => {
    const response = await call(`${API}/models`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000), cache: 'no-store', redirect: 'error',
    });
    await check(response);
    const data = await boundedJSON(response);
    if (!Array.isArray(data?.models)) throw new ChatGPTError('ChatGPT returned an invalid model catalog.', 'invalid_models');
    const seen = new Set();
    const models = data.models.filter(m => m?.visibility === 'list' && typeof m.slug === 'string' && m.slug && !seen.has(m.slug) && seen.add(m.slug))
      .map(m => ({ slug: m.slug, display_name: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.slug }));
    if (!models.length) throw new ChatGPTError('No ChatGPT models are available to this account. Check its plan and workspace access.', 'no_models');
    return models;
  };
  const catalog = async (context, signal, refresh = false) => {
    signal?.throwIfAborted();
    // Both account identity and authorization revision matter; never reuse another account's catalog.
    const key = createHash('sha256').update(JSON.stringify([context.accountId, context.accessToken])).digest('hex');
    for (const [id, entry] of catalogs) if (!entry.pending && entry.expiresAt <= now()) catalogs.delete(id);
    let entry = catalogs.get(key);
    if (!entry || (!entry.pending && (refresh || entry.expiresAt <= now()))) {
      entry = { pending: true, expiresAt: 0, promise: null };
      const current = entry;
      current.promise = fetchCatalog(context.accessToken).then(models => {
        current.pending = false; current.expiresAt = now() + CATALOG_MS;
        return models;
      }, error => { if (catalogs.get(key) === current) catalogs.delete(key); throw error; });
      catalogs.set(key, current);
      if (catalogs.size > 16) for (const [id, item] of catalogs) { if (id !== key && !item.pending) { catalogs.delete(id); break; } }
    }
    const models = await waitFor(entry.promise, signal);
    return models.map(model => ({ ...model }));
  };
  return {
    async resumeChatGPTUsage(accountId) {
      await clearAccountUsageBlock(accountId);
      locallyBlocked.delete(accountId);
    },
    async listChatGPTModels(expectedAccountId, { refresh = true } = {}) {
      const context = await getAuthContext();
      if (expectedAccountId && context.accountId !== expectedAccountId)
        throw new ChatGPTError('The active ChatGPT account changed. Refresh the page before choosing a model.', 'account_changed');
      return catalog(context, undefined, refresh);
    },
    async chatGPTJSON(tier, system, user, { signal, timeoutMs = 240_000, maxOutputTokens = 2400, expectedAccountId, expectedModel } = {}) {
      if (tier !== 'manager' && tier !== 'worker') throw new ChatGPTError('Unknown AI worker tier.', 'invalid_tier');
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, 240_000)));
      signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      signal.throwIfAborted();
      const context = await getAuthContext();
      signal.throwIfAborted();
      if (expectedAccountId && context.accountId !== expectedAccountId)
        throw new ChatGPTError('The active ChatGPT account changed before this task started. Retry using the current account.', 'account_changed');
      if ((locallyBlocked.get(context.accountId) || 0) <= now()) locallyBlocked.delete(context.accountId);
      if (context.usageBlocked || locallyBlocked.has(context.accountId))
        throw new ChatGPTError('ChatGPT requests are paused for this account after a usage limit. Review ChatGPT Settings → Usage, then resume ChatGPT from Settings → AI providers.', 'usage_paused');
      try {
        const models = await catalog(context, signal);
        signal.throwIfAborted();
        const requested = env[tier === 'manager' ? 'CHATGPT_MANAGER_MODEL' : 'CHATGPT_WORKER_MODEL'] || context.models?.[tier];
        const model = requested || models[0].slug;
        if (expectedModel && model !== expectedModel)
          throw new ChatGPTError('The selected ChatGPT model changed before this task started. Retry using the current model.', 'model_changed');
        if (!models.some(m => m.slug === model))
          throw new ChatGPTError('The selected ChatGPT model is not available to this account. Choose a model in Settings → AI providers.', 'model_unavailable');
        const response = await call(`${API}/responses`, {
          method: 'POST',
          headers: { authorization: `Bearer ${context.accessToken}`, 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({
            model, instructions: `${system}\nReply with one valid JSON object only. Do not include markdown fences or other text.`,
            input: [{ role: 'user', content: user }], store: false, stream: true,
            max_output_tokens: outputLimit(maxOutputTokens),
            ...(lowReasoningModel(model) ? { reasoning: { effort: 'low' } } : {}),
          }),
          signal, cache: 'no-store', redirect: 'error',
        });
        await check(response);
        const result = await consumeResponsesStream(response.body);
        let value;
        try { value = JSON.parse(result.text); }
        catch { throw withUsage(new ChatGPTError('ChatGPT returned an answer that was not valid JSON. Retry the request.', 'invalid_json'),result); }
        if (value === null || Array.isArray(value) || typeof value !== 'object')
          throw withUsage(new ChatGPTError('ChatGPT returned an answer that was not a JSON object. Retry the request.', 'invalid_json'),result);
        return { value, model: result.model || model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, usageKnown: result.usageKnown, reasoningTokens: result.reasoningTokens };
      } catch (error) {
        if (error instanceof ChatGPTError && error.code === 'usage_limit') {
          try { await markAccountUsageBlocked(context.accountId); }
          catch { locallyBlocked.set(context.accountId, now() + 5 * 60_000); }
        }
        throw error;
      }
    },
  };
}

const client = createChatGPTClient();
export const listChatGPTModels = (expectedAccountId, options) => client.listChatGPTModels(expectedAccountId, options);
export const chatGPTJSON = (tier, system, user, options) => client.chatGPTJSON(tier, system, user, options);
export const resumeChatGPTUsage = accountId => client.resumeChatGPTUsage(accountId);
