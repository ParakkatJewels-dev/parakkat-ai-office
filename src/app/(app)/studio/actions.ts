'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { makeDesign, canDesign, type Format, LANGS } from '@/lib/agents/design';

export async function orderDesign(form: FormData) {
  const { db, role, user } = await requireUser();
  if (!(await canDesign(db, role))) redirect('/office');
  let id = '';
  try {
    const lang = String(form.get('language') || 'en') as keyof typeof LANGS;
    id = await makeDesign(supabaseAdmin(), {
      format: String(form.get('format')) as Format, brief: String(form.get('brief') || '').trim(), headline: String(form.get('headline') || '').trim(),
      language: lang in LANGS ? lang : 'en', productIds: form.getAll('product').map(Number).filter(Boolean), userId: user.id,
    });
  } catch (e) {
    redirect(`/studio?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  revalidatePath('/studio');
  redirect(`/studio?made=${id}#d-${id}`);
}
