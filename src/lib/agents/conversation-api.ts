import 'server-only';
import { supabaseServer } from '@/lib/supabase/server';
import { byId } from './people';

export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function conversationUser() {
  const db = await supabaseServer();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return null;
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return { db, user, role: profile?.role || 'viewer' };
}

export async function conversationAgent(session: NonNullable<Awaited<ReturnType<typeof conversationUser>>>, id: string) {
  if (!byId[id] || byId[id].human) return null;
  const { data: agent } = await session.db.from('agents').select('id,name,role_desc,department_id,enabled').eq('id', id).maybeSingle();
  if (!agent) return null;
  const { data: dept } = await session.db.from('departments').select('id,name,human_head_role').eq('id', agent.department_id).maybeSingle();
  if (!dept || (session.role !== 'super_admin' && dept.human_head_role !== session.role)) return null;
  return { ...agent, department: dept.name };
}

export function meetingView(row: any) {
  return {
    id: row.id, title: row.title, status: row.status, threadId: row.thread_id,
    agentId: row.agent_threads?.agent_id || null,
    participants: (row.participants || []).map((id: string) => ({ id, name: byId[id]?.name || id })),
    summary: row.summary || null, started_at: row.started_at, finished_at: row.finished_at, created_at: row.created_at,
  };
}

/** Only application-owned validation messages are exposed, never provider bodies or database details. */
export function conversationError(message = '') {
  const allowed = [
    'You cannot assign work to this agent', 'Enter a task of 1 to 6000 characters',
    'This request identifier was already used', 'Three tasks are already running. Wait for one to finish',
    'Please wait before starting more tasks', 'Conversation not found',
    'This agent is still working on your previous message',
  ];
  return allowed.find(value => message.includes(value)) || 'Could not start this task. Please try again.';
}
