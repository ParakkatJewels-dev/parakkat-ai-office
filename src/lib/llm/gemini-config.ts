import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { GeminiError, type GeminiConfig } from './gemini-core.mjs';
import { createGeminiStore } from './gemini-store.mjs';

const store = createGeminiStore();
/** Private configuration never crosses the server/client boundary. */
export const getGeminiConfig = () => store.getConfig();
export const getGeminiStatus = () => store.getStatus();
export const saveGeminiOverride = (key: string) => store.saveKey(key);
export const removeGeminiOverride = () => store.useEnvironment();
export async function geminiConfigured() { return !!(await store.getConfig()).apiKey; }

export function safeGeminiError(error: unknown) {
  return error instanceof GeminiError ? error.message : 'The Gemini connection could not be updated. Check the server setup and try again.';
}

/** Records the captured key's image result only if that key is still selected. */
export async function recordGeminiImageResult(config: GeminiConfig, error?: unknown) {
  try { await store.recordImageResult(config, error); await syncGeminiStatus(); }
  catch { /* Diagnostics must not discard a successfully generated image. */ }
}

/** Configuration is not proof of quota. Preserve the result of a real image request during sync. */
export async function syncGeminiStatus() {
  const status = await store.getStatus();
  await supabaseAdmin().from('connections').upsert({ provider: 'gemini', status: status.status,
    account_ref: status.imageModel, last_error: status.error, last_synced_at: status.checkedAt });
}
