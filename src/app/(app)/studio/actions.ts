'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { makeDesign, canDesign, type Format, LANGS } from '@/lib/agents/design';
import { errText } from '@/lib/errors';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';

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
    redirect(`/studio?tab=order&error=${encodeURIComponent(errText(e))}`);
  }
  revalidatePath('/studio');
  redirect(`/studio?made=${id}#d-${id}`);
}

/**
 * A head marks an AI image good or bad, with a note. The review is saved with the image and becomes a lesson
 * for the team that made it, so the next designs follow it; a new review of the same image replaces its old lesson.
 */
export async function reviewImage(form: FormData) {
  const { db, role, user } = await requireUser();
  if (!(await canDesign(db, role))) redirect('/office');
  const back = String(form.get('back') || '/studio');
  try {
    const source = String(form.get('source')), id = String(form.get('id')), verdict = String(form.get('verdict')), note = String(form.get('note') || '').trim().slice(0, 600);
    if (!['design', 'creative'].includes(source) || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Unknown image.');
    if (!['good', 'bad'].includes(verdict)) throw new Error('Choose Good or Bad.');
    if (verdict === 'bad' && !note) throw new Error('Say what is wrong, so the designers can fix it next time.');
    const admin = supabaseAdmin();
    // read through the head's own access, so a head can only review what they can see
    const { data: img } = await db.from('ai_images').select('kind, brief, headline').eq('source', source).eq('id', id).maybeSingle();
    if (!img) throw new Error('That image is not one you can review.');
    const { error } = await admin.from('image_reviews').upsert({ source, item_id: id, verdict, note: note || null, reviewer: user.id, reviewer_role: role, updated_at: new Date().toISOString() });
    if (error) throw error;
    const what = `${img.kind.replace('_', ' ')} "${(img.headline || img.brief || '').slice(0, 80)}"`;
    const lesson = verdict === 'good'
      ? `The ${ROLE_LABEL[role as AppRole]} liked the ${what}${note ? `: ${note}` : ''}. Make more like it.`
      : `The ${ROLE_LABEL[role as AppRole]} rejected the ${what}: ${note}. Avoid this.`;
    await admin.from('lessons').update({ active: false }).eq('source', 'image_review').eq('source_id', id);
    const { error: le } = await admin.from('lessons').insert({ department_id: img.kind === 'poster' ? 'catalog' : 'creative', source: 'image_review', source_id: id,
      decision: verdict === 'good' ? 'worked' : 'rejected', lesson, by_role: role });
    if (le) throw le;
  } catch (e) {
    redirect(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(errText(e))}`);
  }
  revalidatePath('/studio');
  redirect(`${back}${back.includes('?') ? '&' : '?'}msg=${encodeURIComponent('Review saved. The designers read it from their next design.')}`);
}
