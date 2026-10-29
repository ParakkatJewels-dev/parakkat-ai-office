import { campaignDelivery, campaignMonitoring, metricReadiness, metricValue } from './outcomes-ui.mjs';

/** A short, deterministic explanation from saved states. It never guesses a result. */
export function outcomeBrief(row) {
  const approval = row?.approval_state;
  const execution = row?.execution_state;
  const outcome = row?.outcome_state;
  const external = row?.source_kind === 'provider_campaign';
  const monitoring = external ? campaignMonitoring(row?.observation) : null;
  const delivery = external ? campaignDelivery(row?.observation) : null;
  const goalReady = metricReadiness(row?.metric_config).ready;

  if (external && monitoring?.mode === 'inventory_only') return {
    headline: 'No recent ad activity was recorded.',
    explanation: 'This campaign remains in your ad account history. The checked period has no recorded delivery.',
    next: 'Open it only if you plan to run or monitor it again.', tone: '',
  };
  if (external && monitoring?.mode === 'scope_unknown') return {
    headline: 'We cannot tell whether this ad is active.',
    explanation: 'Recent account data is incomplete, so its current activity and results are unknown.',
    next: 'Refresh the ad account data before judging this campaign.', tone: 'warn',
  };
  if (approval === 'needs_correction') return {
    headline: 'This work needs changes before approval.',
    explanation: 'The draft has feedback. No launch or business result is confirmed.',
    next: 'Open the original work, review the feedback, and ask the team to correct it.', tone: 'warn',
  };
  if (approval === 'awaiting_human') return {
    headline: 'A person needs to review this work.',
    explanation: 'The draft is waiting for a human decision. Approval does not mean it is live.',
    next: 'Open the original approval and decide whether to accept or return it.', tone: 'warn',
  };
  if (approval === 'rejected' || execution === 'cancelled' || outcome === 'closed') return {
    headline: 'This work is closed.', explanation: 'No further result is being claimed for it.',
    next: 'Open the original record if you need to revisit the decision.', tone: '',
  };
  if (execution === 'failed') return {
    headline: 'The planned change did not go through.',
    explanation: 'A launch or update failed; business results cannot be credited to this change.',
    next: 'Check the original workflow for the error before retrying.', tone: 'bad',
  };
  if (!external && approval === 'approved' && execution !== 'provider_confirmed') return {
    headline: 'Approved, but we have not confirmed it went live.',
    explanation: 'The decision is saved. The ad platform or source workflow has not confirmed the change.',
    next: 'Check the original workflow before judging results.', tone: 'warn',
  };
  if (outcome === 'underperforming') return {
    headline: 'The latest measured result is below the chosen goal.',
    explanation: 'This is a signal to investigate, not proof of why performance changed.',
    next: 'Review the dates, data quality and costs before changing or scaling the campaign.', tone: 'warn',
  };
  if (outcome === 'healthy' || outcome === 'improving' || outcome === 'ready_for_scaling_review') return {
    headline: outcome === 'improving' ? 'The latest measured result is improving.' : 'The latest measured result meets the chosen goal.',
    explanation: 'The recorded measure looks positive. It does not by itself prove profit or the cause.',
    next: 'Review costs and a longer result window before deciding on a bigger spend.', tone: 'good',
  };
  if (external && !goalReady) return {
    headline: delivery?.impressions!==null&&delivery?.impressions!==undefined?`${metricValue(delivery.impressions,'impressions')} impressions in the last 7 complete days.`:delivery?.recordedDays===0?'No ad delivery was recorded in the last 7 complete days.':'Recent ad results are not available yet.',
    explanation: delivery?`From ${delivery.from} to ${delivery.to}: ${metricValue(delivery.clicks,'clicks')} clicks and ${metricValue(delivery.spend,'spend',delivery.currency||undefined)} spent. These are saved platform results, not live figures. A success verdict needs a chosen goal.`:'The account status alone does not show impressions, spend or sales. Refresh the ad data to see the latest completed reporting days.',
    next: delivery?'Review the recorded activity, then choose a result to track, a target, and a review date.':'Refresh the ad account data and check its coverage.', tone: delivery?'':'warn',
  };
  if (outcome === 'inconclusive' || outcome === 'awaiting_data') return {
    headline: 'There is not enough reliable data to judge the result yet.',
    explanation: 'Missing or early results cannot be treated as zero or as proof of success.',
    next: goalReady ? 'Check again after the agreed review period and enough results.' : 'Set a clear goal and review date, then check again when enough results arrive.', tone: '',
  };
  return {
    headline: 'Work is being prepared.',
    explanation: 'A business result has not been confirmed.',
    next: 'Check the owner and the next review date.', tone: '',
  };
}

export function campaignStatusLabel(value) {
  const status = String(value || '').toUpperCase();
  return ({ACTIVE:'On',ENABLED:'On',LIMITED:'Limited delivery',PAUSED:'Paused',REMOVED:'Removed'})[status] || 'Status unknown';
}
