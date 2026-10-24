import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FORMATS } from './design';

export type Ev = { id: number; at: string; kind: string; text: string; run_id: string | null; from_agent: string | null; to_agent: string | null };
export type Card = {
  id: string; last: Ev | null; state: 'now' | 'today' | 'quiet';
  actions: number; reports: number; forwarded: number; accepted: number; pushedBack: number;
  runs: number; live: number; spend: number; revenue: number; designs: number;
};
type Camp = { id: string; run_id: string | null; name: string; status: string; external_ids: any };

/**
 * What each agent has been doing over the last 30 days and what it led to, read with the signed-in person's own
 * access, so a head only ever sees their departments' work. Revenue is what the live campaigns an agent worked on
 * earned on Meta and Google: shared credit, not a split.
 */
export async function scorecards(db: SupabaseClient, ids: string[]) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: evs }, { data: reps }, { data: camps }, { data: designs }] = await Promise.all([
    db.from('agent_events').select('id, at, kind, text, run_id, from_agent, to_agent').gte('at', since).order('at', { ascending: false }).limit(4000),
    db.from('reports').select('author_agent, status').in('author_agent', ids).gte('created_at', since).limit(2000),
    db.from('campaigns').select('id, run_id, name, status, external_ids'),
    db.from('designs').select('format, status').gte('created_at', since),
  ]);
  const metaIds = (camps || []).map(c => c.external_ids?.meta?.campaign_id).filter(Boolean).map(String);
  const { data: ads } = metaIds.length ? await db.from('ad_insights_daily').select('campaign_id, spend, revenue').in('campaign_id', metaIds).limit(10000) : { data: [] as { campaign_id: string; spend: number; revenue: number }[] };
  const byCampaign = new Map<string, { spend: number; revenue: number }>();
  (ads || []).forEach(a => { if (!a.campaign_id) return; const m = byCampaign.get(a.campaign_id) || { spend: 0, revenue: 0 }; m.spend += Number(a.spend); m.revenue += Number(a.revenue); byCampaign.set(a.campaign_id, m); });
  const result = (c: Camp) => { const id = c.external_ids?.meta?.campaign_id; return (id && byCampaign.get(String(id))) || { spend: 0, revenue: 0 }; };
  const campOfRun = new Map<string, Camp>(); (camps || []).forEach(c => c.run_id && campOfRun.set(c.run_id, c as Camp));
  const now = Date.now();
  const cards: Record<string, Card> = {}, liveAll = new Map<string, Camp>();
  for (const id of ids) {
    const mine = (evs || []).filter(e => e.from_agent === id) as Ev[];
    const runs = [...new Set(mine.map(e => e.run_id).filter(Boolean))] as string[];
    const cs = runs.map(r => campOfRun.get(r)).filter(Boolean) as Camp[], live = cs.filter(c => c.status === 'live');
    live.forEach(c => liveAll.set(c.id, c));
    const r = (reps || []).filter(x => x.author_agent === id);
    const last = mine[0] || null, age = last ? now - new Date(last.at).getTime() : Infinity;
    const maker = Object.entries(FORMATS).filter(([, f]) => f.maker === id).map(([k]) => k);
    cards[id] = {
      id, last, state: age < 10 * 6e4 ? 'now' : age < 864e5 ? 'today' : 'quiet', actions: mine.length,
      reports: r.length, forwarded: r.filter(x => ['with_head', 'accepted', 'sent_back', 'rejected'].includes(x.status)).length,
      accepted: r.filter(x => x.status === 'accepted').length, pushedBack: r.filter(x => ['sent_back', 'rejected', 'revise', 'rejected_by_lead'].includes(x.status)).length,
      runs: cs.length, live: live.length, spend: live.reduce((s, c) => s + result(c).spend, 0), revenue: live.reduce((s, c) => s + result(c).revenue, 0),
      designs: (designs || []).filter(d => maker.includes(d.format) && d.status !== 'failed').length,
    };
  }
  const totals = { live: liveAll.size, spend: [...liveAll.values()].reduce((x, c) => x + result(c).spend, 0), revenue: [...liveAll.values()].reduce((x, c) => x + result(c).revenue, 0) };
  return { cards, totals, events: (evs || []) as Ev[], campaigns: (camps || []) as Camp[], campOfRun, result };
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
