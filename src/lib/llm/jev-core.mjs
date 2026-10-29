// Official TypeSafe System One contract; injectable transport keeps tests offline.
export class JevError extends Error {
  constructor(message, code = 'jev_error') { super(message); this.name = 'JevError'; this.code = code; }
}
export function cleanJevKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[\x21-\x7e]{16,512}$/.test(key)) throw new JevError('Enter a valid Jev API key without spaces or line breaks.', 'invalid_key');
  return key;
}
export function resolveJevConfig(saved, env = process.env) {
  const apiKey = saved?.apiKey || env.JEV_API_KEY || '';
  const model = env.JEV_MODEL || 'jev-latest';
  if (!/^jev-[a-zA-Z0-9.-]{1,80}$/.test(model)) throw new JevError('The configured Jev model is invalid.', 'invalid_model');
  return { apiKey, model, source: saved?.apiKey ? 'saved' : apiKey ? 'environment' : 'none' };
}
export const publicJevConfig = config => ({ configured: !!config.apiKey, model: config.model, source: config.source });
export function jevFailure(status) {
  if (status === 401 || status === 403) return new JevError('Jev rejected this API key. Check its access in the TypeSafe console.', 'authentication');
  if (status === 402) return new JevError('Jev needs account credits. Review billing in the TypeSafe console.', 'credits');
  if (status === 429) return new JevError('Jev reached a usage or rate limit. Review the TypeSafe console before retrying.', 'rate_limit');
  if (status >= 500) return new JevError('Jev is temporarily unavailable. Try again later.', 'unavailable');
  return new JevError('Jev could not complete this request. Check the configured model and request.', 'request_failed');
}
async function boundedJSON(response) {
  if (!response.body) throw new JevError('Jev returned an empty response.', 'invalid_response');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new JevError('Jev returned an unexpectedly large response.', 'invalid_response');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new JevError('Jev returned an unreadable response.', 'invalid_response'); }
  } catch (error) {
    if (error instanceof JevError) throw error;
    throw new JevError('Jev returned an unreadable response.', 'invalid_response');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function jevRequest({ apiKey, body, signal, fetch: request = globalThis.fetch }) {
  const key = cleanJevKey(apiKey);
  const timeout = AbortSignal.timeout(30000), bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
  bounded.throwIfAborted();
  let response;
  try {
    response = await request('https://api.typesafe.ai/v1/systemone', { method: 'POST', redirect: 'error', cache: 'no-store', signal: bounded,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { if (signal?.aborted) throw signal.reason; throw new JevError('Jev could not be reached before the request deadline.', 'network'); }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw jevFailure(response.status); }
  return boundedJSON(response);
}
export async function checkJevModels(apiKey, model = 'jev-latest', request = globalThis.fetch) {
  const key = cleanJevKey(apiKey); let response;
  try { response = await request('https://api.typesafe.ai/v1/models', { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${key}` } }); }
  catch { throw new JevError('Jev model access could not be checked. Try again later.', 'network'); }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw jevFailure(response.status); }
  const data = await boundedJSON(response);
  const models = Array.isArray(data.models) ? data.models : [];
  if (!models.some(item => item?.name === model)) throw new JevError('The selected Jev model is not available to this key.', 'model_unavailable');
  return true;
}
export function jevUsage(data) {
  const inputTokens = data?.usage?.input_tokens, outputTokens = data?.usage?.output_tokens;
  const usageKnown = Number.isSafeInteger(inputTokens) && inputTokens >= 0 && Number.isSafeInteger(outputTokens) && outputTokens >= 0;
  return { inputTokens: usageKnown ? inputTokens : undefined, outputTokens: usageKnown ? outputTokens : undefined, usageKnown };
}
export function validateJevAnswers(data, questions) {
  const answers = {};
  for (const [key, question] of Object.entries(questions)) {
    const value = data?.answers?.[key], probabilities = value?.probabilities;
    if (!value || value.type !== 'choice' || !Object.hasOwn(question.criteria, value.choice) || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 || !probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) throw new JevError('Jev returned an incomplete classification.', 'invalid_response');
    const entries = Object.entries(probabilities);
    if (entries.length !== Object.keys(question.criteria).length || entries.some(([option, probability]) => !Object.hasOwn(question.criteria, option) || !Number.isFinite(probability) || probability < 0 || probability > 1) || Math.abs(entries.reduce((sum, [, p]) => sum + p, 0) - 1) > .025) throw new JevError('Jev returned invalid choice probabilities.', 'invalid_response');
    if (entries.some(([, probability]) => probability > probabilities[value.choice] + 1e-6)) throw new JevError('Jev returned a choice inconsistent with its probabilities.', 'invalid_response');
    answers[key] = { choice: value.choice, confidence: value.confidence, probabilities: { ...probabilities } };
  }
  return answers;
}

/** Shared guidance appears exactly once, regardless of the number of questions. */
export function buildJevBody(system, state, questions, model) {
  if (typeof system !== 'string' || !system.trim() || typeof state !== 'string' || !questions || typeof questions !== 'object' || Array.isArray(questions)) throw new JevError('The classification request is invalid.', 'invalid_request');
  const entries = Object.entries(questions);
  if (!entries.length || entries.length > 8) throw new JevError('A classification needs between one and eight questions.', 'invalid_request');
  for (const [key, question] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(key) || !question || typeof question.instructions !== 'string' || !question.instructions.trim() || !question.criteria || typeof question.criteria !== 'object' || Array.isArray(question.criteria)) throw new JevError('The classification questions are invalid.', 'invalid_request');
    const choices = Object.entries(question.criteria);
    if (!choices.length || choices.length > 32 || choices.some(([option, description]) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(option) || typeof description !== 'string')) throw new JevError('The classification options are invalid.', 'invalid_request');
  }
  return { model, state: { agentGuidance: system, evidence: state }, questions: Object.fromEntries(entries.map(([key, question]) => [key, {
    type: 'choice', instructions: `Apply the shared agentGuidance to the evidence. ${question.instructions}`, criteria: { ...question.criteria },
  }])) };
}
