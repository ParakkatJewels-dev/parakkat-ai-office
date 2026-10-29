'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { authEnabled, disconnectAccount, selectAccount, setModels } from '@/lib/chatgpt/auth.mjs';
import { listChatGPTModels, resumeChatGPTUsage } from '@/lib/llm/chatgpt.mjs';

async function requireAdmin() {
  const { role } = await requireUser();
  if (role !== 'super_admin') redirect('/office');
  if (!authEnabled()) throw new Error('ChatGPT OAuth must be enabled on your self-hosted server first.');
}

function back(message: string, error = false): never {
  revalidatePath('/admin');
  redirect(`/admin?tab=ai&${error ? 'error' : 'msg'}=${encodeURIComponent(message)}#chatgpt`);
}

// Auth and inference helpers expose deliberately safe errors, never upstream token-response bodies.
const messageOf = (e: unknown) => e instanceof Error && e.name.startsWith('ChatGPT')
  ? e.message : 'The ChatGPT connection could not be updated. Check the server setup and try again.';

export async function chooseChatGPTAccount(form: FormData) {
  await requireAdmin();
  try { await selectAccount(String(form.get('account') || '')); }
  catch (e) { back(messageOf(e), true); }
  back('ChatGPT account selected. New agent requests will use this account.');
}

export async function saveChatGPTModels(form: FormData) {
  await requireAdmin();
  try {
    const account = String(form.get('account') || '');
    const manager = String(form.get('manager') || ''), worker = String(form.get('worker') || '');
    const choices = await listChatGPTModels(account);
    if ([manager, worker].some(model => !choices.some(choice => choice.slug === model))) {
      const error = new Error('Choose models currently available to the selected ChatGPT account.');
      error.name = 'ChatGPTConfigurationError';
      throw error;
    }
    await setModels({ manager, worker }, account);
  } catch (e) { back(messageOf(e), true); }
  back('ChatGPT models saved.');
}

export async function disconnectChatGPT(form: FormData) {
  await requireAdmin();
  let revoked = false;
  try { ({ revoked } = await disconnectAccount(String(form.get('account') || ''))); }
  catch (e) { back(messageOf(e), true); }
  back(revoked ? 'ChatGPT disconnected.' : 'ChatGPT disconnected locally. Remote revocation was not confirmed; disconnect this app in ChatGPT Settings too.');
}

export async function resumeChatGPT(form: FormData) {
  await requireAdmin();
  try { await resumeChatGPTUsage(String(form.get('account') || '')); }
  catch (e) { back(messageOf(e), true); }
  back('ChatGPT requests resumed. If the plan limit is still reached, requests will pause again.');
}
