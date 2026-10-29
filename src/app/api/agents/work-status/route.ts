import { conversationUser, json } from '@/lib/agents/conversation-api';
import { readAgentWork } from '@/lib/agents/agent-work';
import { permittedWorkAgents } from '@/lib/agents/work-status-access.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await conversationUser();
  if (!session) return json({ error: 'Sign in to see current agent work.' }, 401);
  const signal = AbortSignal.timeout(5000);
  try {
    const [departments, agents] = await Promise.all([
      session.db.from('departments').select('id,human_head_role').abortSignal(signal),
      session.db.from('agents').select('id,department_id,enabled').abortSignal(signal),
    ]);
    if (departments.error || agents.error) return json({ error: 'Current work status is unavailable.' }, 503);
    const now = Date.now(), permitted = permittedWorkAgents(session.role, departments.data || [], agents.data || []);
    return json({ statuses: readAgentWork(permitted, now), observedAt: new Date(now).toISOString() });
  } catch { return json({ error: 'Current work status is unavailable.' }, 503); }
}
