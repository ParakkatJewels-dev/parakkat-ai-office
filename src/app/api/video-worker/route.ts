import { timingSafeEqual } from 'node:crypto';
import { isPaused } from '@/lib/pause';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { UUID, safeWorkerText } from '@/lib/video-edit/core.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

function authorized(request: Request) {
  const expected = process.env.VIDEO_WORKER_TOKEN;
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || expected.length < 32 || !given) return false;
  const givenBytes = Buffer.from(given), expectedBytes = Buffer.from(expected);
  return givenBytes.length === expectedBytes.length && timingSafeEqual(givenBytes, expectedBytes);
}

export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: 'Worker authentication failed.' }, 401);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send JSON.' }, 415);
  let body: any;
  try { const raw = await request.text(); if (raw.length > 32_000) throw new Error(); body = JSON.parse(raw); }
  catch { return json({ error: 'Invalid worker request.' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid worker request.' }, 400);
  const db = supabaseAdmin();
  if (body.action === 'peek') {
    if (await isPaused()) return json({ job: null, paused: true });
    // A Claude Code channel can announce a job before claiming it. If its
    // notification is dropped during startup, the job stays safely queued.
    const next = await db.from('video_edit_jobs').select('id').eq('status', 'queued')
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle();
    return next.error ? json({ error: 'Could not check the edit queue.' }, 503) : json({ job: next.data });
  }
  if (body.action === 'claim') {
    const workerId = safeWorkerText(body.workerId, 80);
    if (!workerId) return json({ error: 'Invalid worker ID.' }, 400);
    // A lost worker may have left an export behind. Require inspection before retrying.
    const now = new Date().toISOString();
    const stale = await db.from('video_edit_jobs').update({ status: 'failed', error: 'Editing computer disconnected. Check the project and export there before retrying.', lease_until: null, claim_token: null, updated_at: now, finished_at: now }).eq('status', 'running').lt('lease_until', now);
    if (stale.error) return json({ error: 'Could not check the worker queue.' }, 503);
    if (await isPaused()) return json({ job: null, paused: true });
    const claimed = await db.rpc('claim_video_edit_job', { p_worker_id: workerId });
    if (claimed.error) return json({ error: 'Could not claim an edit.' }, 503);
    const job = claimed.data?.[0];
    return json({ job: job ? { id: job.id, brief: job.brief, sourceFolder: job.source_folder, outputName: job.output_name, claimToken: job.claim_token } : null });
  }
  if (!UUID.test(body.id || '') || !UUID.test(body.claimToken || '')) return json({ error: 'Invalid job claim.' }, 400);
  const base = db.from('video_edit_jobs');
  const now = new Date();
  if (body.action === 'heartbeat') {
    const progress = safeWorkerText(body.progress, 300);
    if (!progress) return json({ error: 'Enter progress text.' }, 400);
    const changed = await base.update({ progress, lease_until: new Date(now.getTime() + 180_000).toISOString(), updated_at: now.toISOString() })
      .eq('id', body.id).eq('claim_token', body.claimToken).eq('status', 'running').gt('lease_until', now.toISOString()).select('id').maybeSingle();
    return changed.error ? json({ error: 'Could not update progress.' }, 503) : changed.data ? json({ ok: true }) : json({ error: 'The worker lease expired.' }, 409);
  }
  if (body.action === 'report') {
    const report = typeof body.report === 'string' ? body.report.trim() : '';
    if (!report || report.length > 12_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(report)) return json({ error: 'Enter a report of at most 12,000 characters.' }, 400);
    const changed = await base.update({ worker_report: report, lease_until: new Date(now.getTime() + 180_000).toISOString(), updated_at: now.toISOString() })
      .eq('id', body.id).eq('claim_token', body.claimToken).eq('status', 'running').gt('lease_until', now.toISOString()).select('id').maybeSingle();
    return changed.error ? json({ error: 'Could not save the editor report.' }, 503) : changed.data ? json({ ok: true }) : json({ error: 'The worker lease expired.' }, 409);
  }
  if (body.action === 'complete') {
    const projectPath = safeWorkerText(body.projectPath, 1000), exportPath = safeWorkerText(body.exportPath, 1000);
    if (!projectPath || !exportPath) return json({ error: 'Project and export paths are required.' }, 400);
    const changed = await base.update({ status: 'review', progress: 'Export ready for review', project_path: projectPath, export_path: exportPath, claim_token: null, lease_until: null, updated_at: now.toISOString(), finished_at: now.toISOString() })
      .eq('id', body.id).eq('claim_token', body.claimToken).eq('status', 'running').gt('lease_until', now.toISOString()).select('id').maybeSingle();
    return changed.error ? json({ error: 'Could not save the export result.' }, 503) : changed.data ? json({ ok: true }) : json({ error: 'The worker lease expired.' }, 409);
  }
  if (body.action === 'fail') {
    const error = safeWorkerText(body.error, 1000);
    if (!error) return json({ error: 'Enter an error summary.' }, 400);
    const changed = await base.update({ status: 'failed', error, claim_token: null, lease_until: null, updated_at: now.toISOString(), finished_at: now.toISOString() })
      .eq('id', body.id).eq('claim_token', body.claimToken).eq('status', 'running').gt('lease_until', now.toISOString()).select('id').maybeSingle();
    return changed.error ? json({ error: 'Could not save the worker failure.' }, 503) : changed.data ? json({ ok: true }) : json({ error: 'The worker lease expired.' }, 409);
  }
  return json({ error: 'Unknown worker action.' }, 400);
}
