import { campaignApprovalCurrent } from '../../../lib/agents/quality-core.mjs';

/** Display eligibility only; the authenticated RPC rechecks scope, leases and lifecycle. */
export function campaignReviewState(approval,campaign,role) {
  const current=campaignApprovalCurrent(approval?.quality_snapshot,campaign?.plan,campaign?.creatives||[]);
  const authorized=role==='super_admin'||Array.isArray(approval?.required_roles)&&approval.required_roles.includes(role);
  const noPublication=!campaign?.external_ids||typeof campaign.external_ids==='object'&&Object.keys(campaign.external_ids).length===0;
  return {current,canRequest:!current&&authorized&&approval?.status==='pending'&&campaign?.status==='in_approval'&&noPublication};
}
