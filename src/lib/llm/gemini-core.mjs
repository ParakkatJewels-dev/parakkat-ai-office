// Server-side protocol helpers. Errors deliberately never contain provider bodies or credentials.
export class GeminiError extends Error {
  constructor(message, code = 'request_failed') { super(message); this.name = 'GeminiError'; this.code = code; }
}

export function cleanGeminiKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (key.length < 20 || key.length > 512 || /[\s\x00-\x1f\x7f]/.test(key))
    throw new GeminiError('Enter a valid Gemini API key.', 'invalid_key');
  return key;
}

export function resolveGeminiConfig(saved, env = {}) {
  const apiKey = saved?.tokens?.access_token || env.GEMINI_API_KEY || '';
  const imageModel = env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
  const oneKOnly = ['gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image'].includes(imageModel);
  const imageSize = env.GEMINI_IMAGE_SIZE || (oneKOnly ? '1K' : '2K');
  if (!['1K', '2K', '4K'].includes(imageSize) || (oneKOnly && imageSize !== '1K'))
    throw new GeminiError('Choose a supported Gemini image size: 1K, 2K or 4K. This model may support only 1K.', 'invalid_image_size');
  return {
    apiKey, source: saved?.tokens?.access_token ? 'saved' : apiKey ? 'environment' : 'none',
    imageModel, imageSize,
    textModel: env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash',
  };
}

export function publicGeminiConfig(config) {
  return { configured: !!config.apiKey, source: config.source, imageModel: config.imageModel, imageSize: config.imageSize, textModel: config.textModel };
}

/** Resolution is a request setting, not a prompt suggestion. Legacy 2.5 lacks imageSize. */
export function geminiImageGenerationConfig(config, aspectRatio) {
  return { responseModalities: ['TEXT', 'IMAGE'], imageConfig: {
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(config.imageModel === 'gemini-2.5-flash-image' ? {} : { imageSize: config.imageSize }),
  } };
}

export function geminiFailure(status, data) {
  if (status === 429) {
    const zeroQuota = /(?:limit|quotaValue)[\s"':=]+0\b/i.test(JSON.stringify(data || {}));
    return new GeminiError(zeroQuota
      ? 'This Gemini project has no image quota. Use a key from a project with image billing and quota, then generate a test again.'
      : 'Gemini quota or rate limit reached. Check this key’s project billing and quota, then try again later.', 'quota');
  }
  if (status === 401 || status === 403 || data?.error?.status === 'PERMISSION_DENIED')
    return new GeminiError('Gemini rejected this key or its permissions. Check the key’s project, API restrictions, and billing.', 'authentication');
  if (status === 404) return new GeminiError('The configured Gemini model is unavailable to this project. Check the image model setting.', 'model_unavailable');
  if (status === 400) return new GeminiError('Gemini rejected the key, model, or request settings. Check the configuration and try again.', 'invalid_request');
  return new GeminiError(status >= 500 ? 'Gemini is temporarily unavailable. Try again later.' : 'Gemini could not complete the request. Check the provider settings.', 'request_failed');
}

export async function geminiRequest({ apiKey, model, body, signal, fetch: request = globalThis.fetch }) {
  if (!apiKey) throw new GeminiError('Add a Gemini key in Settings → AI providers before generating images.', 'missing_key');
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(model))
    throw new GeminiError('The Gemini model setting is invalid.', 'invalid_model');
  let response;
  try {
    response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}${body ? ':generateContent' : ''}`, {
      method: body ? 'POST' : 'GET', headers: { 'x-goog-api-key': apiKey, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(body ? 180_000 : 30_000)]) : AbortSignal.timeout(body ? 180_000 : 30_000), redirect: 'error', cache: 'no-store',
    });
  } catch { throw new GeminiError('Gemini could not be reached before the request timed out. Try again later.', 'network'); }
  let data;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('empty');
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > (body && response.ok ? 24 * 1024 * 1024 : 1024 * 1024)) throw new Error('large');
        chunks.push(value);
      }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } catch { throw response.ok ? new GeminiError('Gemini returned an unreadable response. Try again.', 'invalid_response') : geminiFailure(response.status); }
  if (!response.ok) throw geminiFailure(response.status, data);
  return data;
}

/** Checks model access only; never sends a prompt or claims generation quota is available. */
export async function checkGeminiModel(apiKey, model, request = globalThis.fetch) {
  const data = await geminiRequest({ apiKey, model, fetch: request });
  if (data?.name !== `models/${model}` || !data.supportedGenerationMethods?.includes('generateContent'))
    throw new GeminiError('The configured Gemini model does not support content generation for this key.', 'model_unavailable');
}

export function geminiImage(parts) {
  // Reasoning image models can return low-resolution draft images before the
  // final result. A thought image is never the finished deliverable.
  const img = Array.isArray(parts) && parts.find(part => !part?.thought && part?.inlineData)?.inlineData;
  if (!img || !['image/png', 'image/jpeg', 'image/webp'].includes(img.mimeType) || typeof img.data !== 'string'
    || !img.data.length || img.data.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(img.data))
    throw new GeminiError('Gemini did not return a usable image. Revise the brief and try again.', 'no_image');
  const data = Buffer.from(img.data, 'base64');
  if (!data.length) throw new GeminiError('Gemini returned an empty image. Try again.', 'no_image');
  return { data, mimeType: img.mimeType };
}
