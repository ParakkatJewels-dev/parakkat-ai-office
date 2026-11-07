import { conversationAgent, conversationUser, json } from '@/lib/agents/conversation-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** A bounded, permission-scoped summary for the office agent drawer. */
export async function GET(_request: Request, context: Context) {
  const session = await conversationUser();
  if (!session) return json({ error: 'Sign in to see agent work.' }, 401);
  const agent = await conversationAgent(session, (await context.params).id);
  if (!agent) return json({ error: 'Agent not available to your account.' }, 404);

  try {
    const db = session.db;
    const [workflows, conversations, reports, events, contributions] = await Promise.all([
      db.from('automation_tasks').select('id,title,status,result,error,created_at,updated_at').eq('owner_agent', agent.id).order('updated_at', { ascending: false }).limit(20),
      db.from('agent_tasks').select('id,thread_id,prompt,status,error,created_at,finished_at').eq('agent_id', agent.id).order('created_at', { ascending: false }).limit(12),
      db.from('reports').select('id,title,body,status,updated_at').eq('author_agent', agent.id).order('updated_at', { ascending: false }).limit(8),
      db.from('agent_events').select('id,kind,text,at').eq('from_agent', agent.id).order('at', { ascending: false }).limit(12),
      db.from('automation_events').select('task_id,text,created_at').eq('agent_id', agent.id).order('created_at', { ascending: false }).limit(20),
    ]);
    if ([workflows, conversations, reports, events, contributions].some(result => result.error)) throw new Error('work read failed');
    const contributedIds = [...new Set((contributions.data || []).map(row => row.task_id))].filter(id => !(workflows.data || []).some(workflow => workflow.id === id));
    const related = contributedIds.length
      ? await db.from('automation_tasks').select('id,title,status,updated_at').in('id', contributedIds).limit(20)
      : { data: [], error: null };
    if (related.error) throw new Error('team work read failed');
    const lastContribution = new Map([...(contributions.data || [])].reverse().map(row => [row.task_id, row]));
    return json({
      observedAt: new Date().toISOString(),
      workflows: (workflows.data || []).map(row => ({
        id: row.id, title: row.title, status: row.status, updatedAt: row.updated_at,
        summary: typeof row.result?.summary === 'string' ? row.result.summary.slice(0, 240) : null,
        error: typeof row.error === 'string' ? row.error.slice(0, 180) : null,
      })),
      teamTasks: (related.data || []).map(row => ({
        id: row.id, title: row.title, status: row.status, updatedAt: row.updated_at,
        summary: lastContribution.get(row.id)?.text.slice(0, 220) || null,
      })),
      conversations: (conversations.data || []).map(row => ({
        id: row.id, threadId: row.thread_id, title: row.prompt.split('\n')[0].slice(0, 160),
        status: row.status, updatedAt: row.finished_at || row.created_at,
        error: typeof row.error === 'string' ? row.error.slice(0, 180) : null,
      })),
      reports: (reports.data || []).map(row => ({
        id: row.id, title: row.title, status: row.status, updatedAt: row.updated_at,
        summary: row.body?.slice(0, 180) || null,
      })),
      events: (events.data || []).map(row => ({ id: row.id, kind: row.kind, text: row.text.slice(0, 220), at: row.at })),
    });
  } catch {
    return json({ error: 'Agent work is temporarily unavailable. Try refreshing.' }, 503);
  }
}
