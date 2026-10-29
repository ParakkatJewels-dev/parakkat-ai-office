import { conversationUser, json, meetingView } from '@/lib/agents/conversation-api';
export const dynamic = 'force-dynamic';
export async function GET() {
  const session = await conversationUser();
  if (!session) return json({ error: 'Sign in to see meetings.' }, 401);
  const recovery = await session.db.rpc('recover_agent_conversations');
  if (recovery.error) return json({ error: 'Meetings are temporarily unavailable.' }, 503);
  const fields = 'id,thread_id,title,status,participants,summary,started_at,finished_at,created_at,agent_threads!inner(agent_id)';
  const [active, recent] = await Promise.all([
    session.db.from('agent_meetings').select(fields).in('status', ['planned','running']).order('created_at', { ascending: false }).limit(3),
    session.db.from('agent_meetings').select(fields).in('status', ['completed','failed']).order('created_at', { ascending: false }).limit(9),
  ]);
  if (active.error || recent.error) return json({ error: 'Could not load meetings.' }, 503);
  return json({ meetings: [...(active.data || []), ...(recent.data || [])].map(meetingView) });
}
