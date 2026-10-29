import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishCampaign, metaConfig } from '@/lib/connectors/meta';
import { campaignQualityCurrent } from './quality-core.mjs';
import { emit } from './events';
import { checkPause } from '@/lib/pause';
import { publishApprovedPlan, type PublicationStore } from './publish-core.mjs';

/** Called only after the database's department-head and Super Admin approval gates. */
export async function publishApproved(db: SupabaseClient, approvalId: string, siteUrl = 'https://parakkatjewels.com') {
  const saveAttempt = async (id: string, attempt: string, status: string, ids: Record<string, unknown>) => {
    const { data, error } = await db.from('campaigns').update({ status, external_ids: ids }).eq('id', id).eq('status', 'publishing')
      .contains('external_ids', { _publish: { attempt_id: attempt } }).select('id').maybeSingle();
    if (error || !data) throw new Error('Could not save this campaign publication attempt.');
  };
  const store: PublicationStore = {
    async read(id) {
      const a = await db.from('approvals').select('id,status,campaign_id').eq('id', id).maybeSingle();
      if (a.error) throw new Error('Could not read campaign approval.');
      if (!a.data) return { approval: null, campaign: null };
      const c = await db.from('campaigns').select('*').eq('id', a.data.campaign_id).maybeSingle();
      if (c.error) throw new Error('Could not read the approved campaign.');
      return { approval: a.data, campaign: c.data };
    },
    async claim(id, ids) {
      const { data, error } = await db.from('campaigns').update({ status: 'publishing', external_ids: ids }).eq('id', id).eq('status', 'approved').select('id').maybeSingle();
      if (error) throw new Error('Could not reserve this campaign for publishing.');
      return !!data;
    },
    checkpoint: (id, attempt, ids) => saveAttempt(id, attempt, 'publishing', ids),
    release: (id, attempt, ids) => saveAttempt(id, attempt, 'approved', ids),
    review: (id, attempt, ids) => saveAttempt(id, attempt, 'publish_review', ids),
    async finish(id, approval, ids) {
      const c = await db.from('campaigns').update({ status: 'live', external_ids: ids }).eq('id', id).in('status', ['publishing', 'live'])
        .contains('external_ids', { _publish: { approval_id: approval, status: 'provider_completed' } }).select('id').maybeSingle();
      if (c.error || !c.data) throw new Error('Could not save the live campaign.');
      const a = await db.from('approvals').update({ status: 'published' }).eq('id', approval).eq('campaign_id', id).in('status', ['approved', 'published']).select('id').maybeSingle();
      if (a.error || !a.data) throw new Error('Could not save publication approval.');
    },
  };
  return publishApprovedPlan({
    approvalId, store, checkPause,
    async prepare(c) {
      const meta = await metaConfig();
      if (!meta?.account || !meta.page) throw new Error('Choose both a Meta ad account and Facebook page in Admin → Connections before publishing. Nothing was launched.');
      const busy = await db.from('creatives').select('id', { head: true, count: 'exact' }).eq('campaign_id', c.id).in('art_status', ['queued', 'making']);
      if (busy.error) throw new Error('Could not check the banner redesign status. Nothing was launched.');
      if (busy.count) throw new Error('A banner redesign is still unfinished. Review the approved artwork before publishing. Nothing was launched.');
      const all = await db.from('creatives').select('id,headline,body,image_path,art_status').eq('campaign_id',c.id).order('id');
      if (all.error || !campaignQualityCurrent(c.plan,all.data || [])) throw new Error('This exact campaign and artwork need a passing quality review before publication. Nothing was launched.');
      const cr = await db.from('creatives').select('image_path,body,headline').eq('campaign_id', c.id).eq('art_status', 'ready').not('image_path', 'is', null).order('id').limit(1).maybeSingle();
      if (cr.error) throw new Error('Could not read the approved banner. Nothing was launched.');
      if (!cr.data) throw new Error('This plan has no banner image to publish on Meta. Nothing was launched.');
      const img = await db.storage.from('creatives').download(cr.data.image_path);
      if (img.error || !img.data) throw new Error('Could not load the approved banner. Nothing was launched.');
      return { ...cr.data, image: Buffer.from(await img.data.arrayBuffer()) };
    },
    launch: (c, cr) => publishCampaign({ name: c.name, dailyBudgetInr: Number(c.budget_daily), days: Number(c.plan?.days ?? 7), link: siteUrl, message: cr.body || '', headline: cr.headline || c.name, image: cr.image }),
    notify: c => emit(db, c.run_id, 'live', 'metaSpec', `${c.name} was published to Meta. Delivery is subject to Meta's review and account status.`, 'perfLead'),
  });
}
