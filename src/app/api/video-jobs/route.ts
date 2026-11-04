import { checkPause } from '@/lib/pause';
import { conversationUser } from '@/lib/agents/conversation-api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { workflowOriginAllowed } from '@/lib/automation/core.mjs';
import { UUID, sourceFolder, outputName } from '@/lib/video-edit/core.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function allowed(session: NonNullable<Awaited<ReturnType<typeof conversationUser>>>) {
  if (session.role === 'viewer') return false;
  const { data, error } = await session.db.from('departments').select('human_head_role').eq('id', 'reels').single();
  return !error && (session.role === 'super_admin' || data?.human_head_role === session.role);
}

export async function GET() {
  const session = await conversationUser();
  if (!session) return json({ error: 'Please sign in.' }, 401);
  if (!await allowed(session)) return json({ error: 'The video editor is not available to your account.' }, 403);
  const now = new Date().toISOString();
  await supabaseAdmin().from('video_edit_jobs').update({ status: 'failed', error: 'Editing computer disconnected. Check the project and export there before retrying.', lease_until: null, claim_token: null, updated_at: now, finished_at: now }).eq('status', 'running').lt('lease_until', now);
  const { data, error } = await session.db.from('video_edit_jobs')
    .select('id,brief,source_folder,output_name,status,progress,worker_id,project_path,export_path,worker_report,error,created_at,updated_at,finished_at')
    .order('created_at', { ascending: false }).limit(40);
  return error ? json({ error: 'Could not load video jobs.' }, 503) : json({ jobs: data || [] });
}

export async function POST(request: Request) {
  if (!workflowOriginAllowed(request.headers.get('origin'), request.url, process.env.APP_URL)) return json({ error: 'Invalid request origin.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send JSON.' }, 415);
  const session = await conversationUser();
  if (!session) return json({ error: 'Please sign in.' }, 401);
  if (!await allowed(session)) return json({ error: 'You cannot assign the video editor.' }, 403);
  let body: any;
  try { const raw = await request.text(); if (raw.length > 10_000) throw new Error(); body = JSON.parse(raw); }
  catch { return json({ error: 'Invalid video job.' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid video job.' }, 400);
  const admin = supabaseAdmin();
  if (body.action === 'create') {
    const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
    const folder = sourceFolder(body.sourceFolder), name = outputName(body.outputName);
    if (!UUID.test(body.clientId || '') || !folder || !name || !brief || brief.length > 6000) return json({ error: 'Enter a brief, a folder under the editing computer media root, and an export name.' }, 400);
    try { await checkPause(); } catch { return json({ error: 'Agents are paused. Resume them before assigning work.' }, 409); }
    const { data: agent } = await session.db.from('agents').select('enabled').eq('id', 'videoEditor').maybeSingle();
    if (!agent?.enabled) return json({ error: 'The Video Editor is disabled.' }, 409);
    const { count, error: countError } = await admin.from('video_edit_jobs').select('id', { count: 'exact', head: true }).in('status', ['queued','running']);
    if (countError) return json({ error: 'Could not check the edit queue.' }, 503);
    if ((count || 0) >= 20) return json({ error: 'The edit queue is full.' }, 429);
    const row = { created_by: session.user.id, client_id: body.clientId, brief, source_folder: folder, output_name: name };
    const inserted = await admin.from('video_edit_jobs').upsert(row, { onConflict: 'created_by,client_id', ignoreDuplicates: true });
    if (inserted.error) return json({ error: 'Could not queue the edit.' }, 503);
    const saved = await session.db.from('video_edit_jobs').select('id,brief,source_folder,output_name,status').eq('created_by', session.user.id).eq('client_id', body.clientId).single();
    if (saved.error || !saved.data) return json({ error: 'The edit was queued, but could not be read. Refresh the page.' }, 503);
    if (saved.data.brief !== brief || saved.data.source_folder !== folder || saved.data.output_name !== name) return json({ error: 'This request ID was already used for a different edit.' }, 409);
    return json({ job: saved.data }, 202);
  }
  if (!UUID.test(body.id || '')) return json({ error: 'Choose a valid video job.' }, 400);
  const existing = await session.db.from('video_edit_jobs').select('id,status,created_by').eq('id', body.id).maybeSingle();
  if (existing.error || !existing.data) return json({ error: 'Video job not found.' }, 404);
  if (body.action === 'cancel' && existing.data.status === 'queued') {
    const changed = await admin.from('video_edit_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString(), finished_at: new Date().toISOString() }).eq('id', body.id).eq('status', 'queued').select('id').maybeSingle();
    return changed.data ? json({ ok: true }) : json({ error: 'This job has already started. Refresh its status.' }, 409);
  }
  if (body.action === 'retry' && existing.data.status === 'failed') {
    const changed = await admin.from('video_edit_jobs').update({ status: 'queued', progress: null, worker_id: null, claim_token: null, lease_until: null, error: null, project_path: null, export_path: null, worker_report: null, updated_at: new Date().toISOString(), finished_at: null }).eq('id', body.id).eq('status', 'failed').select('id').maybeSingle();
    return changed.data ? json({ ok: true }) : json({ error: 'This job changed. Refresh its status.' }, 409);
  }
  return json({ error: 'This action is not available for the current job status.' }, 409);
}
