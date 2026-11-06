import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';

/** One thing waiting on the signed-in person. */
export type NeedItem = { id: string; href: string; kind: 'plan' | 'report' | 'design' | 'video'; title: string; sub: string; at: string; agent?: string };

type Step = { role: string; decision: string };

/** Whether a pending plan waits on this role: heads sign first, then the Super Admin. */
export function planWaitsOn(plan: { required_roles: unknown; approval_steps: unknown }, role: AppRole) {
  const signed = new Set(((plan.approval_steps || []) as Step[]).filter(s => s.decision === 'approve').map(s => s.role));
  const headsLeft = ((plan.required_roles || []) as string[]).filter(r => !signed.has(r));
  return role === 'super_admin' ? headsLeft.length === 0 : headsLeft.includes(role);
}

/**
 * What needs this person, counted one way for the bell, the sidebar, Home and the Inbox.
 * Row-level security already limits reports and plans to the person's departments; the Super Admin
 * signs plans last, signs off designs the heads send from Studio, and does not decide team reports.
 */
export async function needsFor(db: SupabaseClient, role: AppRole, limit = 5) {
  const [reports, plans, agents, designs] = await Promise.all([
    db.from('reports').select('id, title, author_agent, updated_at', { count: 'exact' }).eq('status', 'with_head').order('updated_at', { ascending: false }).limit(limit),
    db.from('approvals').select('id, created_at, required_roles, approval_steps(role, decision), campaigns(id, name)').eq('status', 'pending').order('created_at', { ascending: false }).limit(500),
    db.from('agents').select('id, name'),
    // Studio sign-off requests; until that database update is applied this errors and simply counts as none
    role === 'super_admin' ? db.from('design_approvals').select('id, title, requested_role, created_at', { count: 'exact' }).eq('status', 'pending').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], count: 0, error: null }),
  ]);
  const designCount = designs.error ? 0 : designs.count || 0;
  const name = new Map(((agents.data || []) as { id: string; name: string }[]).map(a => [a.id, a.name]));
  const myPlans = (plans.data || []).filter(p => planWaitsOn(p, role));
  const decidesReports = role !== 'super_admin';
  const reportCount = decidesReports ? reports.count || 0 : 0;
  const items: NeedItem[] = [
    ...myPlans.slice(0, limit).map(p => {
      const campaign = (Array.isArray(p.campaigns) ? p.campaigns[0] : p.campaigns) as { id: string; name: string } | null;
      return { id: `plan-${p.id}`, kind: 'plan' as const, href: campaign ? `/approvals?campaign=${campaign.id}` : '/approvals?tab=plans', title: campaign?.name || 'Campaign plan', sub: 'Campaign plan · your sign-off', at: p.created_at as string };
    }),
    ...(designs.error ? [] : (designs.data || []) as { id: string; title: string; requested_role: AppRole; created_at: string }[]).map(d => ({ id: `design-${d.id}`, kind: 'design' as const, href: `/approvals?tab=designs&design=${d.id}`, title: d.title || 'Studio design', sub: `Design · from the ${ROLE_LABEL[d.requested_role] || 'team'}`, at: d.created_at })),
    ...(decidesReports ? (reports.data || []).map(r => ({ id: `report-${r.id}`, kind: 'report' as const, href: `/approvals?report=${r.id}`, title: r.title as string, sub: 'Report', agent: name.get(r.author_agent as string), at: r.updated_at as string })) : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
  return { waiting: reportCount + myPlans.length + designCount, reports: reportCount, plans: myPlans.length, designs: designCount, withHeads: reports.count || 0, items, failed: !!(reports.error || plans.error) };
}
