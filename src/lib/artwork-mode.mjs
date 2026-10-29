/** Provider selection alone never submits work; explicit requests create durable jobs. */
export function artworkProviderMode(env = process.env) {
  const value=String(env.ARTWORK_PROVIDER || '').trim().toLowerCase();
  return value==='gemini' ? 'gemini' : value==='higgsfield' ? 'higgsfield' : 'manual';
}
/** Compatibility guard: non-Gemini requests retain their brief/import lifecycle until explicitly started. */
export function isChatGPTHandoff(env = process.env) {
  return artworkProviderMode(env) !== 'gemini';
}
