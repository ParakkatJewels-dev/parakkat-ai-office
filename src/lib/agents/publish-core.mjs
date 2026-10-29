import { randomUUID } from 'node:crypto';

export const MANUAL_CHANNEL_MESSAGE = 'Google Ads publishing is manual. Nothing was launched. Use a Meta-only plan for automatic publishing, or launch this plan manually in Ads Manager.';
export const REVIEW_MESSAGE = 'A previous Meta launch may have created ads. Check Meta Ads Manager and reconcile this campaign before trying again; automatic retry is blocked to prevent duplicate spending.';

export function publicationBlock(campaign) {
  if (campaign?.status === 'publish_review') return REVIEW_MESSAGE;
  if (campaign?.status === 'publishing') return 'Publishing has started. Wait for it to finish. If it stays here, check Meta Ads Manager before any retry.';
  if (!Array.isArray(campaign?.channels) || !campaign.channels.length) return 'This plan has no publishing channel.';
  if (campaign.channels.includes('google')) return MANUAL_CHANNEL_MESSAGE;
  if (campaign.channels.some(channel => channel !== 'meta')) return 'This plan includes a channel that does not support automatic publishing.';
  return null;
}

const completeIds = ids => ['campaign_id', 'adset_id', 'ad_id'].every(key => typeof ids?.[key] === 'string' && ids[key].length > 0);
export const hasConfirmedPublication = (campaign, approvalId) => campaign?.external_ids?._publish?.approval_id === approvalId
  && campaign.external_ids?._publish?.status === 'provider_completed' && completeIds(campaign.external_ids?.meta);

/** One durable claim per approved campaign. An ambiguous external result is never retried automatically. */
export async function publishApprovedPlan({ approvalId, store, prepare, launch, checkPause, notify = async () => {}, now = () => new Date().toISOString() }) {
  await checkPause();
  const { approval, campaign } = await store.read(approvalId);
  if (!approval || !campaign || !['approved', 'published'].includes(approval.status)) throw new Error('Only a plan the Super Admin approved can be published.');
  if (approval.status === 'published') {
    if (campaign.status !== 'live' || !campaign.channels?.includes('meta') || !completeIds(campaign.external_ids?.meta)) throw new Error('The publication records do not confirm a Meta launch. Review them in Ads Manager before another launch.');
    return campaign.external_ids || {};
  }
  // A completed provider result is durable: finishing local state must never create more ads.
  if (hasConfirmedPublication(campaign, approvalId) && ['publishing', 'live'].includes(campaign.status)) {
    await store.finish(campaign.id, approvalId, campaign.external_ids);
    return campaign.external_ids;
  }
  const block = publicationBlock(campaign);
  if (block) throw new Error(block);
  if (campaign.status !== 'approved' || campaign.external_ids?.meta) throw new Error('This campaign already has publication history. Review its existing Meta ads before launching anything else.');
  if (!Number.isFinite(Number(campaign.budget_daily)) || Number(campaign.budget_daily) <= 0) throw new Error('This plan needs a positive approved daily budget.');
  const days = Number(campaign.plan?.days ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('This plan needs a valid approved campaign duration.');
  // Configuration and the image are checked before the durable claim or any platform write.
  const prepared = await prepare(campaign);
  const attempt = { attempt_id: randomUUID(), approval_id: approvalId, status: 'started', started_at: now() };
  let ids = { ...(campaign.external_ids || {}), _publish: attempt };
  if (!await store.claim(campaign.id, ids)) throw new Error('Another request already started publishing this campaign.');
  let providerStarted = false;
  let providerCompleted = false;
  try {
    await checkPause();
    providerStarted = true;
    const result = await launch(campaign, prepared);
    if (!completeIds(result)) throw new Error('Incomplete provider result');
    ids = { ...ids, meta: result, _publish: { ...attempt, status: 'provider_completed', completed_at: now() } };
    await store.checkpoint(campaign.id, attempt.attempt_id, ids);
    providerCompleted = true;
    await store.finish(campaign.id, approvalId, ids);
  } catch {
    if (!providerStarted) {
      await store.release(campaign.id, attempt.attempt_id, campaign.external_ids || {}).catch(() => {});
      throw new Error('Publishing stopped before contacting Meta. Resume the agents and try again from Admin.');
    }
    if (!providerCompleted) {
      await store.review(campaign.id, attempt.attempt_id, { ...ids, _publish: { ...ids._publish, status: 'needs_review' } }).catch(() => {});
      throw new Error(REVIEW_MESSAGE);
    }
    throw new Error('Meta confirmed the launch, but saving the final publication status failed. Retry from Admin to finish saving; no new ads will be created.');
  }
  // Animation is best effort after durable success; an event outage cannot cause another launch.
  await notify(campaign).catch(() => {});
  return ids;
}
