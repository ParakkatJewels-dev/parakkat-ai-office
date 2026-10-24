import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { has } from '@/lib/env';
import { syncProducts, syncOrders, shopifyReady } from '@/lib/connectors/shopify';
import { syncAdInsights, syncInstagram, metaConfig } from '@/lib/connectors/meta';
import { syncGoogleAds, googleAdsReady } from '@/lib/connectors/google';
import { learnFromData } from './learn';
import { emit } from './events';

// ready() says whether a platform can be reached, from access connected on the Admin page or from Vercel keys, and names the account
const JOBS: { provider: string; bot: string; ready: () => Promise<string | null | undefined>; run: (db: SupabaseClient, deadline: number) => Promise<string> }[] = [
  // orders first: they are what the agents read most, and they finish quickly; products use whatever time is left
  { provider: 'shopify', bot: 'shopifySync', ready: shopifyReady,
    run: async (db, deadline) => {
      const orders = await syncOrders(db, 30, deadline), p = await syncProducts(db, deadline);
      return `${orders} product-days of orders, ${p.count} products${p.more ? ' (more next sync, it carries on where it stopped)' : ''}`;
    } },
  { provider: 'meta', bot: 'metaSync', ready: async () => (await metaConfig())?.account,
    run: async db => `${await syncAdInsights(db)} ad-days` },
  { provider: 'instagram', bot: 'metaSync', ready: async () => (await metaConfig())?.ig,
    run: async db => `${await syncInstagram(db)} posts` },
  { provider: 'google_ads', bot: 'googleSync', ready: async () => (await googleAdsReady())?.customer,
    run: async db => `${await syncGoogleAds(db)} ad-days` },
];

/** Pull fresh data from every connected platform. Each Data Hub bot reports to the Data Hub Lead. */
export async function syncAll(db: SupabaseClient) {
  // one sync at a time: two at once spend Shopify's query budget twice over and both get throttled
  const holder = randomUUID();
  const { data: got, error } = await db.rpc('acquire_job_lock', { p_name: 'sync', p_holder: holder, p_seconds: 300 });
  if (error) throw new Error(`Could not start the sync: ${error.message}`);
  if (!got) return { sync: 'A sync is already running. It finishes within five minutes; check back then.' } as Record<string, string>;
  try { return await syncLocked(db); } finally { await db.rpc('release_job_lock', { p_name: 'sync', p_holder: holder }); }
}

async function syncLocked(db: SupabaseClient) {
  const results: Record<string, string> = {};
  // the request may run for 300 seconds; each platform gets until about two and a half minutes in, then saves its place
  const deadline = Date.now() + 150_000;
  for (const j of JOBS) {
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
      const msg = e instanceof Error ? e.message : String(e);
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
  } catch (e) { results.learning = 'error: ' + (e instanceof Error ? e.message : String(e)); }
  return results;
}
