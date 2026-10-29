'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getGeminiConfig, removeGeminiOverride, safeGeminiError, saveGeminiOverride, syncGeminiStatus } from '@/lib/llm/gemini-config';
import { checkGeminiModel, cleanGeminiKey, GeminiError } from '@/lib/llm/gemini-core.mjs';
import { generateGeminiTestImage } from '@/lib/llm/gemini';
import { Paused } from '@/lib/pause';
import { withUsage } from '@/lib/usage';
import { isAiBudgetError } from '@/lib/ai-budget';
import { isChatGPTHandoff } from '@/lib/artwork-mode.mjs';

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'super_admin') redirect('/office');
  return user;
}
function back(message: string, error = false): never {
  revalidatePath('/admin'); revalidatePath('/studio');
  redirect(`/admin?tab=ai&${error ? 'error' : 'msg'}=${encodeURIComponent(message)}#gemini`);
}
/** Key stays in the app-owned private VPS volume. Only metadata requests run on Save. */
export async function saveGeminiKey(form: FormData) {
  await requireAdmin();
  try {
    const current = await getGeminiConfig();
    const entered = String(form.get('key') || '').trim(), apiKey = cleanGeminiKey(entered || current.apiKey);
    await Promise.all([checkGeminiModel(apiKey, current.imageModel), checkGeminiModel(apiKey, current.textModel)]);
    await saveGeminiOverride(apiKey);
    await syncGeminiStatus();
  } catch (e) { back(safeGeminiError(e), true); }
  back('Gemini key saved securely and model access checked. Image quota is not verified yet. Press Generate test to check it.');
}

/** An explicit user action is required for this single billable image request. */
export async function generateGeminiTest(form: FormData) {
  await requireAdmin();
  if (isChatGPTHandoff()) back('Gemini is disabled. Generate artwork in ChatGPT or Higgsfield, then import it in Design Studio.', true);
  if (form.get('generate') !== 'yes') back('Press Generate test to request one image.', true);
  const db = supabaseAdmin(), holder = randomUUID();
  const { data: acquired, error: lockError } = await db.rpc('acquire_job_lock', { p_name: 'gemini-image-test', p_holder: holder, p_seconds: 210 });
  if (lockError || !acquired) back('An image test is already running, or its lock is unavailable. Wait a moment and try again.', true);
  let message = '', failed = false;
  try {
    await withUsage({ feature: 'connection_test' }, () => generateGeminiTestImage());
    message = 'Gemini generated a test image successfully. Studio images now use this key on the server.';
  } catch (e) {
    failed = true; message = e instanceof Paused || isAiBudgetError(e) ? e.message : safeGeminiError(e);
  } finally { await db.rpc('release_job_lock', { p_name: 'gemini-image-test', p_holder: holder }); }
  back(message, failed);
}

export async function useGeminiServerKey() {
  await requireAdmin();
  try {
    if (!(await getGeminiConfig()).apiKey) throw new GeminiError('No Gemini key is configured.', 'missing_key');
    await removeGeminiOverride();
    await syncGeminiStatus();
  } catch (e) { back(safeGeminiError(e), true); }
  back('Saved Gemini override removed. The installed server key is used if one is configured; generate a test to verify image access.');
}
