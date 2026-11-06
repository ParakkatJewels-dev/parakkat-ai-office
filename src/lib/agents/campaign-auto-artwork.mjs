const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only requests created after the configured rollout may start without a Studio click. */
export function automaticCampaignArtworkUser(creative, env = process.env) {
  if (env.CHATGPT_IMAGE_WORKER_ENABLED !== 'true') return null;
  const userId = String(env.CHATGPT_IMAGE_AUTOMATION_USER_ID || '');
  const startAt = Date.parse(String(env.CHATGPT_IMAGE_AUTO_CAMPAIGN_AFTER || ''));
  const createdAt = Date.parse(String(creative?.created_at || ''));
  if (!UUID.test(userId) || !Number.isFinite(startAt) || !Number.isFinite(createdAt) || createdAt < startAt) return null;
  if (creative?.art_status !== 'awaiting_import' || creative?.image_path || !UUID.test(String(creative?.artwork_request_id || ''))) return null;
  return userId;
}
