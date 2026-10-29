import { after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkPause } from '@/lib/pause';
import { canWrite } from '@/lib/llm/openai';
import { byId } from '@/lib/agents/people';
import { runConversationTask } from '@/lib/agents/conversation';
import { conversationUser, conversationAgent, conversationError, json, uuid, meetingView } from '@/lib/agents/conversation-api';
import { carouselIntent, salesPosterIntent, carouselRedesignIntent } from '@/lib/agents/carousel-core.mjs';
import { artworkRevisionIntent, readConversationArtworks } from '@/lib/agents/conversation-artwork.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const session = await conversationUser();
  if (!session) return json({ error: 'Sign in to talk with an agent.' }, 401);
  const agent = await conversationAgent(session, (await context.params).id);
  if (!agent) return json({ error: 'Agent not available to your account.' }, 404);
  const threadId = new URL(request.url).searchParams.get('thread');
  if (threadId && !uuid(threadId)) return json({ error: 'Conversation not found.' }, 400);
  const { db } = session;
  const recovery = await db.rpc('recover_agent_conversations');
  if (recovery.error) return json({ error: 'Agent conversations are temporarily unavailable.' }, 503);
  const [{ data: threads, error }, { data: activity }] = await Promise.all([
    db.from('agent_threads').select('id,title,status,updated_at,error').eq('agent_id', agent.id).order('updated_at', { ascending: false }).limit(30),
    db.from('agent_events').select('text,at,kind').eq('from_agent', agent.id).order('at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) return json({ error: 'Could not load conversations.' }, 503);
  let thread = threadId ? threads?.find(t => t.id === threadId) : threads?.[0];
  if (threadId && !thread) {
    const { data } = await db.from('agent_threads').select('id,title,status,updated_at,error').eq('agent_id', agent.id).eq('id', threadId).maybeSingle();
    if (!data) return json({ error: 'Conversation not found.' }, 404);
    thread = data;
  }
  const [messageResult, meetingResult] = thread ? await Promise.all([
    db.from('agent_messages').select('id,task_id,role,agent_id,recipient_agent_id,content,metadata,created_at').eq('thread_id', thread.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200),
    db.from('agent_meetings').select('*').eq('thread_id', thread.id).order('created_at', { ascending: false }).limit(20),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (messageResult.error || meetingResult.error) return json({ error: 'Could not load this conversation.' }, 503);
  const messages = (messageResult.data || []).reverse();
  // Both metadata and image rows are read under this requester's access. Never
  // use the service client to resolve an arbitrary design ID from chat text.
  const artworks = await readConversationArtworks(db, messages);
  return json({
    agent, threads: threads || [], thread: thread || null,
    messages: messages.map((m: any) => ({ ...m, agent_name: byId[m.agent_id]?.name || null, recipient_agent_name: byId[m.recipient_agent_id]?.name || null })),
    artworks,
    meetings: (meetingResult.data || []).map(meetingView), activity: activity || null,
    canSend: agent.enabled && session.role !== 'viewer',
  });
}

export async function POST(request: Request, context: Context) {
  const origin = request.headers.get('origin');
  const origins = [new URL(request.url).origin];
  if (process.env.APP_URL) { try { origins.push(new URL(process.env.APP_URL).origin); } catch { /* invalid deployment URL */ } }
  if (!origin || !origins.includes(origin) || !request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Invalid request origin.' }, 403);
  const session = await conversationUser();
  if (!session) return json({ error: 'Sign in to give an agent a task.' }, 401);
  const agent = await conversationAgent(session, (await context.params).id);
  if (!agent || !agent.enabled || session.role === 'viewer') return json({ error: 'You cannot assign work to this agent.' }, 403);
  let body: any;
  try {
    const text = await request.text();
    if (text.length > 32_000) throw new Error('large');
    body = JSON.parse(text);
  } catch { return json({ error: 'Enter a task of 1 to 6000 characters.' }, 400); }
  if (!body || typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 6000 || !uuid(body.clientId) || (body.threadId != null && !uuid(body.threadId)) || (body.meeting != null && typeof body.meeting !== 'boolean')) return json({ error: 'Enter a task of 1 to 6000 characters.' }, 400);
  try { await checkPause(); } catch { return json({ error: 'Agents are paused. Resume them in Admin before assigning work.' }, 409); }
  const imageJob = body.meeting !== true && byId[agent.id]?.head && (
    !!salesPosterIntent(body.message) || !!carouselRedesignIntent(body.message) || !!carouselIntent(body.message) || artworkRevisionIntent(body.message));
  if (!imageJob && !await canWrite()) return json({ error: 'ChatGPT needs available plan usage for this conversation’s final answer. Check Settings → AI providers.' }, 503);
  const { data, error } = await session.db.rpc('enqueue_agent_task', {
    p_agent: agent.id, p_prompt: body.message.trim(), p_client: body.clientId,
    p_thread: body.threadId || null, p_meeting: body.meeting === true,
  });
  if (error || !data?.taskId) return json({ error: conversationError(error?.message) }, 409);
  if (data.created) {
    // The authenticated client keeps every context query under the requester's RLS policies.
    after(async () => { await runConversationTask(supabaseAdmin(), session.db, data.taskId).catch(() => {}); });
  }
  return json({ threadId: data.threadId, taskId: data.taskId }, 202);
}
