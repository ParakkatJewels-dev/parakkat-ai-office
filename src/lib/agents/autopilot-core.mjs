export const OPPORTUNITY_SCHEDULE = { every: 4 * 60 * 60_000, hours: [9, 20] };

/** Choose from current persisted job times, after the caller holds the scheduler lease. */
export function chooseDueJob(jobs, last, now = new Date()) {
  const time = now.getTime(), hour = (now.getUTCHours() + now.getUTCMinutes() / 60 + 5.5) % 24;
  return jobs.filter(job => (!job.hours || (hour >= job.hours[0] && hour < job.hours[1]))
    && time - (last[job.name] || 0) >= job.every)
    .sort((a, b) => (time - (last[b.name] || 0)) / b.every - (time - (last[a.name] || 0)) / a.every)[0] || null;
}
