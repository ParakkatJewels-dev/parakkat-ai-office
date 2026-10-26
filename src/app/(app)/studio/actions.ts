'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { after } from 'next/server';
import { queueDesign, queueRedesign, drawItem, canDesign, type Format, type Source, LANGS } from '@/lib/agents/design';
import { folderIdFrom } from '@/lib/agents/library-core.mjs';
import { folderInfo } from '@/lib/connectors/drive';
import { errText } from '@/lib/errors';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';

/** A head orders a design. It is drawn in the background, so they can leave the page; the gallery shows it arriving. */
export async function orderDesign(form: FormData) {
  const { db, role, user } = await requireUser();
  if (!(await canDesign(db, role))) redirect('/office');
  let id = '';
  try {
    const lang = String(form.get('language') || 'en') as keyof typeof LANGS;
    id = await queueDesign(supabaseAdmin(), {
      format: String(form.get('format')) as Format, brief: String(form.get('brief') || '').trim(), headline: String(form.get('headline') || '').trim(),
      language: lang in LANGS ? lang : 'en', productIds: form.getAll('product').map(Number).filter(Boolean), userId: user.id,
    });
  } catch (e) {
    redirect(`/studio?tab=order&error=${encodeURIComponent(errText(e))}`);
  }
  // runs after the page has answered; the tick picks it up if this call is cut short
  after(() => drawItem(supabaseAdmin(), 'design', id).catch(() => null));
  revalidatePath('/studio');
  redirect(`/studio?made=${id}#d-${id}`);
}

/**
 * A new version of any AI image: a Studio order, or a campaign banner from the Approvals page. The note says what to
 * change; with no note the designers try a different direction. The earlier version is kept.
 * Studio orders need the Creative head or the Super Admin; a campaign banner, anyone whose sign-off the campaign needs.
 */
export async function redesign(form: FormData) {
  const { db, role } = await requireUser();
  const back = String(form.get('back') || '/studio'), source = String(form.get('source')), id = String(form.get('id'));
  const to = (k: 'msg' | 'error', t: string) => `${back.split('#')[0]}${back.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(t)}${back.includes('#') ? `#${back.split('#')[1]}` : ''}`;
  try {
    if (!['design', 'creative'].includes(source) || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Unknown image.');
    if (source === 'design' && !(await canDesign(db, role))) throw new Error('Only the Creative head or the Super Admin can redesign Studio orders.');
    if (source === 'creative') {
      // read through the person's own access: heads see only the campaigns that need their sign-off
      const { data: c } = await db.from('creatives').select('id, campaigns(status)').eq('id', id).maybeSingle();
      if (!c) throw new Error('That banner is not one you can change.');
      if ((c.campaigns as any)?.status === 'live') throw new Error('This campaign is live. Its banner can no longer change.');
    }
    await queueRedesign(supabaseAdmin(), source as Source, id, String(form.get('note') || ''));
  } catch (e) {
    redirect(to('error', errText(e)));
  }
  after(() => drawItem(supabaseAdmin(), source as Source, id).catch(() => null));
  revalidatePath(back.split(/[?#]/)[0]);
  redirect(to('msg', 'Redesign started. It takes about a minute; this page updates on its own and you can leave it.'));
}

/** Super Admin: add a Drive folder of past designs, by link or from the search. The library job reads it next. */
export async function addFolder(form: FormData) {
  const { role, user } = await requireUser();
  if (role !== 'super_admin') redirect('/studio');
  try {
    const id = folderIdFrom(form.get('folder'));
    if (!id) throw new Error('Paste a Google Drive folder link, or pick a folder from the search.');
    const f = await folderInfo(id);
    const admin = supabaseAdmin();
    const { error } = await admin.from('design_library_folders').upsert({ id: f.id, root_id: f.id, name: f.name, added_by: user.id, page_token: null, scanned_at: null, error: null });
    if (error) throw error;
    await admin.from('autopilot_jobs').upsert({ name: 'library', last_run_at: null });
  } catch (e) {
    redirect(`/studio?tab=library&error=${encodeURIComponent(errText(e))}`);
  }
  revalidatePath('/studio');
  redirect(`/studio?tab=library&msg=${encodeURIComponent('Folder added. The Banner Designer starts reading it within a few minutes, in the background.')}`);
}

/** Super Admin: stop using a folder. Its subfolders and the designs read from them go with it. */
export async function removeFolder(form: FormData) {
  const { role } = await requireUser();
  if (role !== 'super_admin') redirect('/studio');
  const id = String(form.get('id') || ''), admin = supabaseAdmin();
  const { data: subs } = await admin.from('design_library_folders').select('id').eq('root_id', id);
  const ids = [id, ...(subs || []).map(s => s.id)];
  const { data: files } = await admin.from('design_refs').select('image_path').in('folder_id', ids).not('image_path', 'is', null).limit(5000);
  const paths = (files || []).map(f => f.image_path!);
  for (let i = 0; i < paths.length; i += 500) await admin.storage.from('creatives').remove(paths.slice(i, i + 500));
  await admin.from('design_library_folders').delete().in('id', ids);
  revalidatePath('/studio');
  redirect(`/studio?tab=library&msg=${encodeURIComponent('Folder removed from the library.')}`);
}

/** Read the folders again now: the library job runs on the next tick instead of waiting its turn. */
export async function scanNow() {
  const { db, role } = await requireUser();
  if (!(await canDesign(db, role))) redirect('/office');
  const admin = supabaseAdmin();
  await admin.from('design_library_folders').update({ scanned_at: null, error: null }).is('page_token', null);
  await admin.from('design_refs').update({ status: 'new', error: null }).eq('status', 'failed');
  await admin.from('autopilot_jobs').upsert({ name: 'library', last_run_at: null });
  revalidatePath('/studio');
  redirect(`/studio?tab=library&msg=${encodeURIComponent('Reading the folders again in the background. New designs show up here as they are studied.')}`);
}

/** A head pins a past design (use it more) or hides it (never use it). */
export async function markRef(form: FormData) {
  const { db, role } = await requireUser();
  if (!(await canDesign(db, role))) redirect('/office');
  const id = String(form.get('id') || ''), what = String(form.get('what') || ''), back = String(form.get('back') || '/studio?tab=library');
  const patch = what === 'pin' ? { pinned: true, hidden: false } : what === 'unpin' ? { pinned: false } : what === 'hide' ? { hidden: true, pinned: false } : what === 'show' ? { hidden: false } : null;
  if (patch && /^[0-9a-f-]{36}$/.test(id)) await supabaseAdmin().from('design_refs').update(patch).eq('id', id);
  revalidatePath('/studio');
  redirect(back);
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
