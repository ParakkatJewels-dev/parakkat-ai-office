import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { confined, createChannel } from './office-video.mjs';

const jobId = '11111111-1111-4111-8111-111111111111';
const claimToken = '22222222-2222-4222-8222-222222222222';

test('source folders stay inside the configured media root', () => {
  assert.equal(confined('/tmp/media', 'Test'), path.resolve('/tmp/media/Test'));
  for (const value of ['../secret', '/absolute', 'C:\\Windows', '\\\\server\\share']) {
    assert.throws(() => confined('/tmp/media', value));
  }
});

test('queue notification leaves the job queued until Claude claims and completes it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'office-video-'));
  const mediaRoot = path.join(root, 'media');
  const exportRoot = path.join(root, 'exports');
  await mkdir(path.join(mediaRoot, 'Test'), { recursive: true });
  await mkdir(exportRoot);
  const calls = [];
  const notices = [];
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push(body);
    const data = body.action === 'peek' ? { job: { id: jobId } }
      : body.action === 'claim' ? { job: { id: jobId, claimToken, sourceFolder: 'Test', outputName: 'test', brief: 'Make a cut' } }
      : { ok: true };
    return { ok: true, json: async () => data };
  };
  const channel = createChannel({ officeUrl: 'https://office.example', token: 'x'.repeat(64), mediaRoot, exportRoot, fetchImpl });
  channel.mcp.notification = async message => notices.push(message);
  await channel.poll();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'peek');
  assert.equal(notices[0].params.meta.event, 'queued');
  assert.equal(channel.active, null);

  const claimed = JSON.parse((await channel.claim()).content[0].text);
  assert.equal(claimed.job_id, jobId);
  assert.equal(claimed.source_folder, path.join(mediaRoot, 'Test'));
  assert.equal(channel.active.claimToken, claimToken);

  const report = JSON.parse((await channel.reportJob({ job_id: jobId, report: 'Style notes saved on the editing PC.' })).content[0].text);
  assert.equal(report.ok, true);
  assert.equal(calls.at(-1).action, 'report');
  assert.equal(calls.at(-1).claimToken, claimToken);

  const project = path.join(exportRoot, 'test.drp');
  const video = path.join(exportRoot, 'test.mp4');
  await writeFile(project, Buffer.alloc(2048));
  await writeFile(video, Buffer.alloc(2048));
  const completed = JSON.parse((await channel.completion({ job_id: jobId, project_path: project, export_path: video })).content[0].text);
  assert.equal(completed.ok, true);
  assert.equal(calls.at(-1).action, 'complete');
  assert.equal(calls.at(-1).claimToken, claimToken);
  assert.equal(channel.active, null);
});
