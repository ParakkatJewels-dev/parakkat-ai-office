import { runJob } from './run-job.mjs';

// One instance per app. An in-flight job never overlaps itself, even when it takes several minutes.
const busy = new Set(), last = new Map();
function launch(job, key) {
  if (busy.has(job) || last.get(job) === key) return;
  busy.add(job); last.set(job, key);
  runJob(job).finally(() => busy.delete(job));
}
function schedule() {
  const now = new Date(), minute = now.toISOString().slice(0, 16), day = now.toISOString().slice(0, 10);
  launch('tick', minute);
  if (now.getUTCHours() === 0 && now.getUTCMinutes() === 30) launch('sync', day);
  if (now.getUTCDay() === 1 && now.getUTCHours() === 1 && now.getUTCMinutes() === 30) launch('seo', day);
}
schedule();
setInterval(schedule, 15_000);
console.log('Parakkat scheduler started: minute ticks, daily sync, Monday SEO (India time).');
