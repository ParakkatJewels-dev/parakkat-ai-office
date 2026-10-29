'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getJevConfig, removeJevOverride, safeJevError, saveJevOverride, syncJevStatus } from '@/lib/llm/jev-config';
import { checkJevModels, cleanJevKey, JevError } from '@/lib/llm/jev-core.mjs';
import { testJevClassification } from '@/lib/llm/jev';
import { Paused } from '@/lib/pause';
import { withUsage } from '@/lib/usage';
import { isAiBudgetError } from '@/lib/ai-budget';

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'super_admin') redirect('/office');
}
function back(message: string, error = false): never {
  revalidatePath('/admin'); revalidatePath('/usage');
  redirect(`/admin?tab=ai&${error ? 'error' : 'msg'}=${encodeURIComponent(message)}#jev`);
}

/** Save checks available model names only. It never submits source content for classification. */
export async function saveJevKey(form: FormData) {
  await requireAdmin();
  try {
    const current = await getJevConfig(), entered = String(form.get('key') || '').trim();
    const apiKey = cleanJevKey(entered || current.apiKey);
    await checkJevModels(apiKey, current.model);
    await saveJevOverride(apiKey);
    await syncJevStatus();
  } catch (error) { back(safeJevError(error), true); }
  back('Jev key saved securely and model access checked. Run a classification test to verify inference access.');
}

/** One small synthetic request, after an explicit administrator action. */
export async function runJevTest(form: FormData) {
  await requireAdmin();
  if (form.get('classify') !== 'yes') back('Press Run test to request one classification.', true);
  const db = supabaseAdmin(), holder = randomUUID();
  const lock = await db.rpc('acquire_job_lock', { p_name:'jev-classification-test', p_holder:holder, p_seconds:60 });
  if (lock.error || !lock.data) back('A Jev test is already running, or its lock is unavailable. Wait a moment and try again.', true);
  let message = '', failed = false;
  try {
    await withUsage({ feature:'connection_test' }, () => testJevClassification());
    message = 'Jev completed one synthetic classification successfully.';
  } catch (error) {
    failed = true; message = error instanceof Paused || isAiBudgetError(error) ? error.message : safeJevError(error);
  } finally { await db.rpc('release_job_lock', { p_name:'jev-classification-test', p_holder:holder }); }
  back(message, failed);
}

export async function useJevServerKey() {
  await requireAdmin();
  try {
    if (!(await getJevConfig()).apiKey) throw new JevError('No Jev key is configured.', 'missing_key');
    await removeJevOverride();
    await syncJevStatus();
  } catch (error) { back(safeJevError(error), true); }
  back('Saved Jev override removed. The installed server key is used if one is configured.');
}
