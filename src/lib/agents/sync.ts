import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { has } from '@/lib/env';
import { syncProducts, syncOrders, shopifyReady } from '@/lib/connectors/shopify';
import { syncAdInsights, syncInstagram, metaConfig } from '@/lib/connectors/meta';
import { syncGoogleAds, googleAdsReady } from '@/lib/connectors/google';
import { syncOdooStock, syncOdooSales, odooReady } from '@/lib/connectors/odoo';
import { googleId, metaId } from '@/lib/connectors/accounts.mjs';
import { learnFromData } from './learn';
import { emit } from './events';
import { errText } from '@/lib/errors';
import { checkPause, isPaused } from '@/lib/pause';

// ready() says whether a platform can be reached, from access connected on the Admin page or from Vercel keys, and names the account
const JOBS: { provider: string; bot: string; ready: () => Promise<string | null | undefined>; run: (db: SupabaseClient, deadline: number) => Promise<string> }[] = [
  // orders first: they are what the agents read most, and they finish quickly; products use whatever time is left
  { provider: 'shopify', bot: 'shopifySync', ready: shopifyReady,
    run: async (db, deadline) => {
      const orders = await syncOrders(db, 30, deadline), p = await syncProducts(db, deadline);
      return `${orders} product-days of orders, ${p.count} products${p.more ? ' (more next sync, it carries on where it stopped)' : ''}`;
    } },
  { provider: 'meta', bot: 'metaSync', ready: async () => (await metaConfig())?.accounts.map(metaId).join(', '),
    run: async db => adDays(await syncAdInsights(db)) },
  { provider: 'instagram', bot: 'metaSync', ready: async () => (await metaConfig())?.ig,
    run: async db => `${await syncInstagram(db)} posts` },
  { provider: 'google_ads', bot: 'googleSync', ready: async () => (await googleAdsReady())?.customers.map(c => googleId(c.id)).join(', '),
    run: async db => adDays(await syncGoogleAds(db)) },
  // after Shopify, so newly synced products are matched to their Odoo stock; it gets at least a minute and a half of its own
  { provider: 'odoo', bot: 'shopifySync', ready: odooReady,
    run: async (db, deadline) => {
      const until = Math.min(deadline + 120_000, Math.max(deadline, Date.now() + 90_000));
      const st = await syncOdooStock(db, until), sa = await syncOdooSales(db, until);
      return `stock for ${st.skus} products in ${st.warehouses} warehouses (${st.changed} Shopify products updated), `
        + (sa.busy ? 'sales already being read' : `${sa.days} day${sa.days === 1 ? '' : 's'} of branch sales${sa.more ? `, back to ${sa.from}; the rest comes in over the next hours` : ''}`);
    } },
];
const adDays = (r: { count: number; accounts: number; failed: string[] }) =>
  `${r.count} ad-days from ${r.accounts} account${r.accounts === 1 ? '' : 's'}${r.failed.length ? `; could not read ${r.failed.join('; ')}` : ''}`;

/** Pull fresh data from every connected platform. Each Data Hub bot reports to the Data Hub Lead. */
export async function syncAll(db: SupabaseClient) {
  const holder = await claimSync(db);
  if (!holder) return { sync: BUSY } as Record<string, string>;
  return runClaimed(db, holder);
}
export const BUSY = 'A sync is already running. It finishes within five minutes; check back then.';

/**
 * Take the sync lease, or null when a sync is already running. Taken before the page answers, so a sync started in the
 * background shows as running straight away.
 */
export async function claimSync(db: SupabaseClient) {
  await checkPause();
  // one sync at a time: two at once spend Shopify's query budget twice over and both get throttled
  const holder = randomUUID();
  const { data: got, error } = await db.rpc('acquire_job_lock', { p_name: 'sync', p_holder: holder, p_seconds: 300 });
  if (error) throw new Error(`Could not start the sync: ${error.message}`);
  return got ? holder : null;
}

/** Run the sync under a lease from claimSync, keep what each platform said for the Admin page, and let the lease go. */
export async function runClaimed(db: SupabaseClient, holder: string) {
  let results: Record<string, string> = {};
  try { results = await syncLocked(db); return results; }
  catch (e) { results = { sync: 'error: ' + errText(e) }; throw e; }
  finally {
    await db.from('sync_cursors').upsert({ name: 'sync_last', state: { at: new Date().toISOString(), results }, updated_at: new Date().toISOString() });
    await db.rpc('release_job_lock', { p_name: 'sync', p_holder: holder });
  }
}

/** Whether a sync is running now, and what the last one found. */
export async function syncStatus(db: SupabaseClient) {
  const [{ data: lock }, { data: last }] = await Promise.all([
    db.from('job_locks').select('until').eq('name', 'sync').maybeSingle(),
    db.from('sync_cursors').select('state').eq('name', 'sync_last').maybeSingle(),
  ]);
  return { running: !!lock && Date.parse(lock.until) > Date.now(), last: (last?.state || null) as { at: string; results: Record<string, string> } | null };
}

async function syncLocked(db: SupabaseClient) {
  const results: Record<string, string> = {};
  // the request may run for 300 seconds; each platform gets until about two and a half minutes in, then saves its place
  const deadline = Date.now() + 150_000;
  for (const j of JOBS) {
    if (await isPaused()) { results[j.provider] = 'paused'; continue; }
    let ref: string | null | undefined;
    try { ref = await j.ready(); } catch { ref = null; }
    if (!ref) { results[j.provider] = 'not connected'; continue; }
    try {
      await emit(db, null, 'think', j.bot, `Syncing ${j.provider.replace('_', ' ')}`);
      const msg = await j.run(db, deadline);
      results[j.provider] = msg;
      await db.from('connections').upsert({ provider: j.provider, status: 'connected', account_ref: ref, last_synced_at: new Date().toISOString(), last_error: null });
      await emit(db, null, 'say', j.bot, `Synced ${msg}.`, 'dataLead');
    } catch (e) {
      const msg = errText(e);
      results[j.provider] = 'error: ' + msg;
      await db.from('connections').upsert({ provider: j.provider, status: 'error', last_error: msg.slice(0, 500) });
      await emit(db, null, 'feedback', j.bot, `Sync failed: ${msg.slice(0, 160)}`, 'dataLead');
    }
  }
  for (const [provider, key] of [['openai', 'OPENAI_API_KEY'], ['gemini', 'GEMINI_API_KEY'], ['jev', 'JEV_API_KEY']]) {
    await db.from('connections').upsert({ provider, status: has(key) ? 'connected' : 'not_connected' });
  }
  // with fresh numbers in, the memory updates what the agents know about results and analytics
  try {
    const l = await learnFromData(db);
    results.learning = `${l.results} result and ${l.analytics} analytics lessons`;
    if (l.results + l.analytics) await emit(db, null, 'say', 'dataLead', `Updated the team's memory: ${results.learning}.`, 'cmo');
  } catch (e) { results.learning = 'error: ' + (errText(e)); }
  return results;
}
