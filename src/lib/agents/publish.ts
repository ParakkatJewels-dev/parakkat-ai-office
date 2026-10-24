import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishCampaign, metaConfig } from '@/lib/connectors/meta';
import { emit } from './events';

/**
 * Put an approved plan live. Called only after decide_approval returned 'approved', which the database
 * allows only for the Super Admin once every required head has approved.
 */
export async function publishApproved(db: SupabaseClient, approvalId: string, siteUrl = 'https://parakkatjewels.com') {
  const { data: a } = await db.from('approvals').select('id, status, campaign_id').eq('id', approvalId).single();
  if (!a || a.status !== 'approved') throw new Error('Only a plan the Super Admin approved can be published.');
  const { data: c } = await db.from('campaigns').select().eq('id', a.campaign_id).single();
  const { data: cr } = await db.from('creatives').select().eq('campaign_id', a.campaign_id).not('image_path', 'is', null).limit(1).maybeSingle();
  const ids: Record<string, unknown> = { ...(c.external_ids || {}) };

  const meta = await metaConfig();
  if (c.channels.includes('meta') && meta?.account && meta.page) {
    if (!cr) throw new Error('This plan has no banner image to publish on Meta.');
    await emit(db, c.run_id, 'think', 'metaSpec', `Creating ${c.name} on Meta within the approved cap`);
    const img = await db.storage.from('creatives').download(cr.image_path);
    if (img.error) throw img.error;
    ids.meta = await publishCampaign({ name: c.name, dailyBudgetInr: Number(c.budget_daily), days: c.plan.days || 7, link: siteUrl, message: cr.body || '', headline: cr.headline || c.name, image: Buffer.from(await img.data.arrayBuffer()) });
    await emit(db, c.run_id, 'live', 'metaSpec', `${c.name} is live on Meta. Budget Guard is tracking it daily.`, 'perfLead');
  }
  if (c.channels.includes('google')) {
    // Creating Google Ads campaigns needs Basic access on the Google Cloud project; until then the plan is handed over to run by hand.
    await emit(db, c.run_id, 'say', 'googleSpec', `${c.name}: Google Ads plan ready (${c.plan.split}). Creating it automatically comes once the Google Cloud project has Basic access.`, 'perfLead');
    ids.google = { status: 'manual' };
  }
  await db.from('campaigns').update({ status: 'live', external_ids: ids }).eq('id', c.id);
  await db.from('approvals').update({ status: 'published' }).eq('id', approvalId);
  return ids;
}
