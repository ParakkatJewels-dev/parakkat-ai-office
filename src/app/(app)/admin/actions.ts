'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { startCampaign, advance } from '@/lib/agents/campaign';
import { syncAll } from '@/lib/agents/sync';
import { publishApproved } from '@/lib/agents/publish';

async function admin() {
  const u = await requireUser();
  if (u.role !== 'super_admin') redirect('/office');
  return u;
}
const done = (msg?: string) => { revalidatePath('/admin'); redirect(msg ? `/admin?msg=${encodeURIComponent(msg)}` : '/admin'); };
const fail = (e: unknown) => redirect(`/admin?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);

export async function setRole(form: FormData) {
  const { db } = await admin();
  const { error } = await db.from('profiles').update({ role: form.get('role') }).eq('id', form.get('id'));
  if (error) fail(error); done('Role saved.');
}
export async function setHead(form: FormData) {
  const { db } = await admin();
  const { error } = await db.from('departments').update({ human_head_role: form.get('role') }).eq('id', form.get('id'));
  if (error) fail(error); done('Department head saved.');
}
export async function addCompetitor(form: FormData) {
  await admin();
  const handle = String(form.get('instagram') || '').replace(/^@/, '').trim() || null;
  const { error } = await supabaseAdmin().from('competitors').insert({ name: String(form.get('name')).trim(), instagram_handle: handle, website: String(form.get('website') || '') || null, facebook_page_id: String(form.get('fbpage') || '') || null });
  if (error) fail(error); done('Competitor added.');
}
export async function runCampaign(form: FormData) {
  await admin();
  let id = '';
  try { id = await startCampaign(supabaseAdmin(), String(form.get('occasion')).trim()); await advance(supabaseAdmin(), id); } catch (e) { fail(e); }
  done('Campaign started. Watch it in the Office; the next steps run every minute.');
}
export async function nextStep(form: FormData) {
  await admin();
  try { await advance(supabaseAdmin(), String(form.get('id'))); } catch (e) { fail(e); }
  done();
}
export async function syncNow() {
  await admin();
  let r: Record<string, string> = {};
  try { r = await syncAll(supabaseAdmin()); } catch (e) { fail(e); }
  done(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · '));
}
export async function publishAgain(form: FormData) {
  await admin();
  try { await publishApproved(supabaseAdmin(), String(form.get('id'))); } catch (e) { fail(e); }
  done('Published.');
}
