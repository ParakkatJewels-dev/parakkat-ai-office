'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { startCampaign, advance } from '@/lib/agents/campaign';
import { syncAll } from '@/lib/agents/sync';
import { publishApproved } from '@/lib/agents/publish';
import { loadAccess, saveSettings, dropAccess, type Platform } from '@/lib/connectors/vault';
import { connectionRows } from '@/lib/connectors/connect';
import { chosen } from '@/lib/connectors/accounts.mjs';

async function admin() {
  const u = await requireUser();
  if (u.role !== 'super_admin') redirect('/office');
  return u;
}
// back to the Admin tab the form was sent from, with the result on top
async function tabOf() {
  try { const t = new URL((await headers()).get('referer') || '').searchParams.get('tab'); return t && /^[a-z]+$/.test(t) ? `tab=${t}&` : ''; } catch { return ''; }
}
const done = async (msg?: string) => { revalidatePath('/admin'); const t = await tabOf(); redirect(msg ? `/admin?${t}msg=${encodeURIComponent(msg)}` : `/admin?${t.slice(0, -1)}`); };
const fail = async (e: unknown): Promise<never> => redirect(`/admin?${await tabOf()}error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);

export async function setRole(form: FormData) {
  const { db } = await admin();
  const { error } = await db.from('profiles').update({ role: form.get('role') }).eq('id', form.get('id'));
  if (error) await fail(error); await done('Role saved.');
}
export async function setHead(form: FormData) {
  const { db } = await admin();
  const { error } = await db.from('departments').update({ human_head_role: form.get('role') }).eq('id', form.get('id'));
  if (error) await fail(error); await done('Department head saved.');
}
export async function addCompetitor(form: FormData) {
  await admin();
  const handle = String(form.get('instagram') || '').replace(/^@/, '').trim() || null;
  const { error } = await supabaseAdmin().from('competitors').insert({ name: String(form.get('name')).trim(), instagram_handle: handle, website: String(form.get('website') || '') || null, facebook_page_id: String(form.get('fbpage') || '') || null });
  if (error) await fail(error); await done('Competitor added.');
}
export async function runCampaign(form: FormData) {
  await admin();
  let id = '';
  try { id = await startCampaign(supabaseAdmin(), String(form.get('occasion')).trim()); await advance(supabaseAdmin(), id); } catch (e) { await fail(e); }
  await done('Campaign started. Watch it in the Office; the next steps run every minute.');
}
export async function nextStep(form: FormData) {
  await admin();
  try { await advance(supabaseAdmin(), String(form.get('id'))); } catch (e) { await fail(e); }
  await done();
}
export async function syncNow() {
  await admin();
  let r: Record<string, string> = {};
  try { r = await syncAll(supabaseAdmin()); } catch (e) { await fail(e); }
  await done(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · '));
}
export async function publishAgain(form: FormData) {
  await admin();
  try { await publishApproved(supabaseAdmin(), String(form.get('id'))); } catch (e) { await fail(e); }
  await done('Published.');
}
export async function saveBrandBook(form: FormData) {
  const { user } = await admin();
  const f = (k: string) => String(form.get(k) || '').trim().slice(0, 4000);
  const { error } = await supabaseAdmin().from('brand_book').upsert({ id: 1, voice: f('voice'), always: f('always'), never: f('never'), notes: f('notes'), updated_at: new Date().toISOString(), updated_by: user.id });
  if (error) await fail(error); await done('Brand book saved. Every agent reads it from the next job.');
}
export async function addLesson(form: FormData) {
  const { role } = await admin();
  const lesson = String(form.get('lesson') || '').trim();
  if (!lesson) await fail('Write the lesson first.');
  const { error } = await supabaseAdmin().from('lessons').insert({ department_id: String(form.get('dept')), source: 'manual', lesson, by_role: role });
  if (error) await fail(error); await done('Lesson added.');
}
export async function retireLesson(form: FormData) {
  await admin();
  const { error } = await supabaseAdmin().from('lessons').update({ active: false }).eq('id', String(form.get('id')));
  if (error) await fail(error); await done('Lesson retired. The agents stop reading it.');
}

const PLATFORM_NAME: Record<Platform, string> = { meta: 'Meta', google: 'Google', shopify: 'Shopify' };
const platformOf = (form: FormData) => { const p = String(form.get('platform')) as Platform; if (!(p in PLATFORM_NAME)) throw new Error('Unknown platform.'); return p; };

/** Which ad account, page, Instagram account or Analytics property a connected platform should use. */
export async function chooseAccounts(form: FormData) {
  await admin();
  const f = (k: string) => String(form.get(k) || '').trim() || undefined;
  try {
    const p = platformOf(form), s = (await loadAccess(p))?.settings;
    if (!s) throw new Error(`Connect ${PLATFORM_NAME[p]} first.`);
    let patch: Record<string, string | string[] | undefined>;
    // ticked boxes come as several values with one name; a typed field may hold several ids, comma separated
    const many = (k: string) => chosen(form.getAll(k).map(String));
    if (p === 'meta') {
      const ads = many('ad'), page = (s.choices?.pages || []).find((x: any) => x.id === f('page'));
      const reach = (s.choices?.ads || []).map((x: any) => x.id);
      if (ads.some(a => !reach.includes(a))) throw new Error('One of those ad accounts is not one this sign-in can reach.');
      // new campaigns launch in the account picked for it, or the first one ticked
      const launch = f('launch') && ads.includes(f('launch')!) ? f('launch') : ads[0];
      patch = { ad_account_ids: ads, ad_account_id: launch, page_id: page?.id, ig_user_id: page?.ig || undefined };
    } else if (p === 'google') {
      const ids = many('customer').map(v => v.replace(/-/g, '')), one = (k: string) => f(k)?.replace(/-/g, '');
      patch = { customer_ids: ids, customer_id: undefined, login_customer_id: one('login'), ga4_property_id: one('ga4') };
      for (const v of [...ids, patch.login_customer_id, patch.ga4_property_id] as (string | undefined)[])
        if (v && !/^\d{4,12}$/.test(v)) throw new Error(`${v === patch.ga4_property_id ? 'The Analytics property' : 'A Google Ads account'} id should be digits only.`);
    } else throw new Error('Shopify needs no choice: it is one store.');
    await saveSettings(p, patch);
    await supabaseAdmin().from('connections').upsert(connectionRows(p, { ...s, ...patch }));
  } catch (e) { await fail(e); }
  await done('Saved. Press Sync data now to pull it in.');
}

/** Forget the access saved from the app. The platform falls back to Vercel keys if any are set. */
export async function disconnect(form: FormData) {
  await admin();
  let p: Platform = 'meta';
  try {
    p = platformOf(form); await dropAccess(p);
    await supabaseAdmin().from('connections').upsert(connectionRows(p, {}));
  } catch (e) { await fail(e); }
  await done(`${PLATFORM_NAME[p]} disconnected. Remove the app from the ${PLATFORM_NAME[p]} account too if you no longer want it to have access.`);
}
