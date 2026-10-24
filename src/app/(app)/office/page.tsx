import { requireUser } from '@/lib/auth/session';
import { ROLE_TO_PERSON } from '@/lib/roles';
import { PEOPLE } from '@/office/roster.mjs';
import OfficeClient, { type AgentEvent } from './OfficeClient';

export default async function OfficePage() {
  const { db, role } = await requireUser();
  // Only events this person may see come back (row-level security).
  const { data } = await db.from('agent_events').select('id, at, kind, from_agent, to_agent, from_dept, to_dept, text, payload').order('at', { ascending: false }).limit(80);
  // when each AI staff member last did something: the same numbers Agent reports counts from
  const { data: act } = await db.rpc('agent_activity', { p_ids: PEOPLE.filter(p => !p.human).map(p => p.id), p_since: new Date(Date.now() - 864e5).toISOString() });
  const seen = Object.fromEntries(((act || []) as { agent_id: string; last_at: string | null }[]).filter(a => a.last_at).map(a => [a.agent_id, Date.parse(a.last_at!)]));
  const me = role === 'viewer' ? 'superAdmin' : ROLE_TO_PERSON[role];
  return <OfficeClient me={me} role={role} initial={(data || []) as AgentEvent[]} seen={seen} />;
}
