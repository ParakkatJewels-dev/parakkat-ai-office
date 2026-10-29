#!/usr/bin/env node
// The bearer secret stays in process memory, never a shell argument or response log.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const jobs = { tick: ['/api/agents/tick', 'POST'], sync: ['/api/sync', 'GET'], seo: ['/api/seo', 'GET'] };
export async function runJob(job) {
  if (!Object.hasOwn(jobs, job)) throw new Error('Choose tick, sync, or seo.');
  try {
    if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET is missing.');
    const origin = process.env.PARAKKAT_JOB_ORIGIN || 'http://127.0.0.1:3210';
    if (!['http://127.0.0.1:3210', 'http://parakkat-ai-office:3000'].includes(origin)) throw new Error('Invalid internal job origin.');
    const [path, method] = jobs[job];
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(10 * 60_000),
      redirect: 'error',
    });
    // Do not journal business data or upstream errors returned by the app.
    await response.body?.cancel();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`${job}: request completed.`);
    return true;
  } catch (error) {
    console.error(`${job}: ${error.message === 'CRON_SECRET is missing.' ? error.message : 'request failed; check the Admin page and service health.'}`);
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runJob(process.argv[2]).then(ok => { if (!ok) process.exitCode = 1; }).catch(() => {
    console.error('Choose tick, sync, or seo.'); process.exitCode = 1;
  });
}
