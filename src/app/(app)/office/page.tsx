import { requireUser } from '@/lib/auth/session';
import { ROLE_TO_PERSON } from '@/lib/roles';
import OfficeClient, { type AgentEvent } from './OfficeClient';

export default async function OfficePage() {
  const { db, role } = await requireUser();
  // Only events this person may see come back (row-level security).
  const { data } = await db.from('agent_events').select('id, at, kind, from_agent, to_agent, from_dept, to_dept, text, payload').order('at', { ascending: false }).limit(80);
  const me = role === 'viewer' ? 'superAdmin' : ROLE_TO_PERSON[role];
  return <OfficeClient me={me} role={role} initial={(data || []) as AgentEvent[]} />;
}
