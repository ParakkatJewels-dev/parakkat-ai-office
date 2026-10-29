import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FORMATS } from './design';
import { readAgentWork } from './agent-work';
import { activityState } from './activity-core.mjs';

export type Ev = { id: number; at: string; kind: string; text: string; run_id: string | null; from_agent: string | null; to_agent: string | null };
export type Card = {
  id: string; last: { at: string; text: string } | null; state: 'now' | 'today' | 'quiet';
  actions: number; reports: number; forwarded: number; accepted: number; pushedBack: number;
  runs: number; live: number; spend: number; revenue: number; designs: number;
};
export type AgentCampaign = { agent_id: string; campaign_id: string; name: string; status: string; spend: number; revenue: number };

/**
 * What each agent has been doing over the last 30 days and what it led to. The counting happens in the database
 * (agent_activity, agent_campaigns) with the signed-in person's own access, so a head only ever sees their
 * departments' work and the numbers stay right however many events pile up. Revenue is what the live campaigns
 * an agent worked on earned on Meta: shared credit, not a split.
 */
export async function scorecards(db: SupabaseClient, ids: string[]) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const makers = Object.entries(FORMATS).filter(([, f]) => ids.includes(f.maker));
  const [{ data: act, error }, { data: camps }, designCounts, enabled] = await Promise.all([
    db.rpc('agent_activity', { p_ids: ids, p_since: since }),
    db.rpc('agent_campaigns', { p_ids: ids, p_since: since }),
    Promise.all(makers.map(async ([fmt, f]) => {
      const { count } = await db.from('designs').select('id', { count: 'exact', head: true }).eq('format', fmt).neq('status', 'failed').gte('created_at', since);
      return [f.maker, count || 0] as const;
    })),
    // Callers already scope IDs to the signed-in head's departments. Recheck enabled
    // state before exposing process-local work; a recent event is only history.
    db.from('agents').select('id').in('id', ids).eq('enabled', true),
  ]);
  if (error) throw error;
  if (enabled.error) throw enabled.error;
  const designs = new Map<string, number>(); designCounts.forEach(([m, n]) => designs.set(m, (designs.get(m) || 0) + n));
  const campaigns = (camps || []) as AgentCampaign[], now = Date.now();
  const working = readAgentWork((enabled.data || []).map(agent => agent.id), now);
  const cards: Record<string, Card> = {};
  for (const a of act || []) {
    const mine = campaigns.filter(c => c.agent_id === a.agent_id), live = mine.filter(c => c.status === 'live');
    cards[a.agent_id] = {
      id: a.agent_id, last: a.last_at ? { at: a.last_at, text: a.last_text } : null,
      state: activityState(a.last_at, working[a.agent_id], now), actions: Number(a.actions),
      reports: Number(a.reports), forwarded: Number(a.forwarded), accepted: Number(a.accepted), pushedBack: Number(a.pushed_back),
      runs: mine.length, live: live.length, spend: live.reduce((s, c) => s + Number(c.spend), 0), revenue: live.reduce((s, c) => s + Number(c.revenue), 0),
      designs: designs.get(a.agent_id) || 0,
    };
  }
  const liveAll = new Map(campaigns.filter(c => c.status === 'live').map(c => [c.campaign_id, c]));
  const totals = { live: liveAll.size, spend: [...liveAll.values()].reduce((x, c) => x + Number(c.spend), 0), revenue: [...liveAll.values()].reduce((x, c) => x + Number(c.revenue), 0) };
  return { cards, totals, campaigns };
}

/** Departments this person heads; every department for the Super Admin. */
export async function myDepartments(db: SupabaseClient, role: string) {
  const { data } = await db.from('departments').select('id, name, building, human_head_role, ai_lead_agent').order('building');
  return (data || []).filter(d => role === 'super_admin' || d.human_head_role === role);
}

export const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
