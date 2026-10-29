'use server';
import {prepareCampaignRetry} from '@/lib/agents/campaign-checkpoint-core.mjs';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { startCampaign, advance } from '@/lib/agents/campaign';
import { claimSync, runClaimed, BUSY } from '@/lib/agents/sync';
import { publishApproved } from '@/lib/agents/publish';
import { loadAccess, saveAccess, saveSettings, dropAccess, type Platform } from '@/lib/connectors/vault';
import { testOdoo } from '@/lib/connectors/odoo';
import { normalizeOdooUrl, guessDb } from '@/lib/connectors/odoo-core.mjs';
import { connectionRows } from '@/lib/connectors/connect';
import { chosen } from '@/lib/connectors/accounts.mjs';
import { errText } from '@/lib/errors';
import { checkPause, setPaused } from '@/lib/pause';
import { runOpportunityReview } from '@/lib/agents/opportunities';
import { withUsage } from '@/lib/usage';

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
const fail = async (e: unknown): Promise<never> => redirect(`/admin?${await tabOf()}error=${encodeURIComponent(errText(e))}`);

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
  try {
    await checkPause();
    const db=supabaseAdmin(),id=String(form.get('id'));
    if(form.get('retry')==='1'){
      const previous=await db.from('agent_runs').select('state,status,automation_task_id').eq('id',id).maybeSingle();
      if(previous.error||!previous.data||previous.data.status!=='failed')throw new Error('This campaign changed. Refresh before retrying.');
      if(previous.data.automation_task_id)throw new Error('Retry this campaign from its task in Automations after correcting its inputs.');
      const state=prepareCampaignRetry(previous.data.state);
      const saved=await db.from('agent_runs').update({status:'running',state,error:null,finished_at:null}).eq('id',id).eq('status','failed').select('id').maybeSingle();
      if(saved.error||!saved.data)throw new Error('This campaign changed. Refresh before retrying.');
    }
    await advance(db,id);
  } catch (e) { await fail(e); }
  await done();
}
export async function togglePause(form: FormData) {
  const { user } = await admin();
  const on = form.get('pause') === '1';
  try { await setPaused(on, user.id); } catch (e) { await fail(e); }
  revalidatePath('/', 'layout');
  await done(on ? 'Paused. The agents stop at their next step, make no AI or API calls and publish nothing until you resume.' : 'Resumed. The agents carry on from where they stopped at the next minute.');
}
/** Start a sync and answer at once: it runs on after the page has loaded, and the bar at the top shows it until it ends. */
export async function syncNow() {
  await admin();
  const db = supabaseAdmin();
  let holder: string | null = null;
  try { holder = await claimSync(db); } catch (e) { await fail(e); }
  if (!holder) return done(BUSY);
  after(async () => { try { await runClaimed(db, holder!); } catch { /* kept in sync_last for the Admin page */ } });
  await done('Sync started. It runs in the background, so you can carry on; the bar at the top shows when it is done.');
}
/** The same bounded review is used by the hourly scheduler and an explicit manager request. */
export async function findOpportunitiesNow() {
  const { user } = await admin();
  try { await checkPause(); } catch (error) { await fail(error); }
  after(async () => {
    try {
      await withUsage({ feature: 'autopilot:opportunities' }, () => runOpportunityReview(supabaseAdmin(), { trigger: 'manual', requestedBy: user.id }));
    } catch { /* The runner owns its progress and outcome under the same lease as scheduled reviews. */ }
  });
  revalidatePath('/admin');
  redirect(`/admin?tab=operations&reviewRequested=${Date.now()}&msg=${encodeURIComponent('Opportunity review requested. The AI leads will review the latest evidence and send their proposals to Approvals. Progress appears below.')}#opportunities`);
}
export async function publishAgain(form: FormData) {
  await admin();
  try { await publishApproved(supabaseAdmin(), String(form.get('id'))); } catch (e) { await fail(e); }
  await done('Published to Meta. Delivery is subject to Meta review and account status.');
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

/**
 * Connect Odoo with an API key. The key is tried before it is saved, and saved encrypted; it is never shown again.
 * Leaving the key empty keeps the one already saved, so the other details can change without typing it again.
 */
export async function connectOdoo(form: FormData) {
  const { user } = await admin();
  const f = (k: string) => String(form.get(k) || '').trim();
  let msg = '';
  try {
    const url = normalizeOdooUrl(f('url'));
    if (!url) throw new Error('Enter the Odoo address, starting with https://, for example https://parakkat.odoo.com.');
    const saved = await loadAccess('odoo'), key = f('key') || saved?.tokens.access_token;
    if (!key) throw new Error('Enter the API key.');
    const cfg = { url, db: f('db') || guessDb(url), login: f('login'), key, online: f('online').split(',').map(x => x.trim()).filter(Boolean).slice(0, 20) };
    const t = await testOdoo(cfg);
    await saveAccess('odoo', { access_token: key }, { url, db: cfg.db, login: cfg.login, online: cfg.online, version: t.version, warehouses: t.warehouses.slice(0, 30), pos: t.pos.slice(0, 30) }, null, user.id);
    await supabaseAdmin().from('connections').upsert({ provider: 'odoo', status: 'connected', account_ref: `${new URL(url).host}${cfg.db ? ` · ${cfg.db}` : ''}`, last_error: null });
    msg = `Odoo ${t.version} connected: ${t.warehouses.length} warehouse${t.warehouses.length === 1 ? '' : 's'} and ${t.pos.length} point${t.pos.length === 1 ? '' : 's'} of sale found. Press Sync data now to pull sales and stock.`;
  } catch (e) { await fail(e); }
  await done(msg);
}

export async function disconnectOdoo() {
  await admin();
  try {
    await dropAccess('odoo');
    await supabaseAdmin().from('connections').upsert({ provider: 'odoo', status: 'not_connected', account_ref: null, last_error: null });
  } catch (e) { await fail(e); }
  await done('Odoo disconnected. Delete the API key in Odoo too (Preferences > Account Security) if it is no longer needed.');
}
