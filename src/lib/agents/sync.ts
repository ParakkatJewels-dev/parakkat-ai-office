import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { has } from '@/lib/env';
import { syncProducts, syncOrders, shopifyReady } from '@/lib/connectors/shopify';
import { syncAdInsights, syncInstagram } from '@/lib/connectors/meta';
import { syncGoogleAds } from '@/lib/connectors/google';
import { learnFromData } from './learn';
import { emit } from './events';

const JOBS: { provider: string; bot: string; needs: string[]; ready?: () => boolean; run: (db: SupabaseClient) => Promise<string>; ref?: () => string | undefined }[] = [
  { provider: 'shopify', bot: 'shopifySync', needs: ['SHOPIFY_STORE_DOMAIN'], ready: shopifyReady, ref: () => process.env.SHOPIFY_STORE_DOMAIN,
    run: async db => `${await syncProducts(db)} products, ${await syncOrders(db)} product-days of orders` },
  { provider: 'meta', bot: 'metaSync', needs: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'], ref: () => process.env.META_AD_ACCOUNT_ID,
    run: async db => `${await syncAdInsights(db)} ad-days` },
  { provider: 'instagram', bot: 'metaSync', needs: ['META_ACCESS_TOKEN', 'META_IG_USER_ID'], ref: () => process.env.META_IG_USER_ID,
    run: async db => `${await syncInstagram(db)} posts` },
  { provider: 'google_ads', bot: 'googleSync', needs: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_OAUTH_REFRESH_TOKEN'], ref: () => process.env.GOOGLE_ADS_CUSTOMER_ID,
    run: async db => `${await syncGoogleAds(db)} ad-days` },
];

/** Pull fresh data from every connected platform. Each Data Hub bot reports to the Data Hub Lead. */
export async function syncAll(db: SupabaseClient) {
  const results: Record<string, string> = {};
  for (const j of JOBS) {
    if (!has(...j.needs) || (j.ready && !j.ready())) { results[j.provider] = 'not connected'; continue; }
    try {
      await emit(db, null, 'think', j.bot, `Syncing ${j.provider.replace('_', ' ')}`);
      const msg = await j.run(db);
      results[j.provider] = msg;
      await db.from('connections').upsert({ provider: j.provider, status: 'connected', account_ref: j.ref?.() ?? null, last_synced_at: new Date().toISOString(), last_error: null });
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
