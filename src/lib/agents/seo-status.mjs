/** Safe summaries for the scheduler and Admin. Provider bodies and credentials never become job labels. */
export function seoSuccessSummary(result) {
  const keywords = Number.isSafeInteger(result?.keywords) && result.keywords >= 0 ? result.keywords : 0;
  const problems = Array.isArray(result?.problems) ? result.problems.length : 0;
  return `${keywords} search terms${problems ? `; ${problems} source(s) unavailable` : ''}`;
}

export function seoFailureSummary(error) {
  if (error?.name === 'Paused') return 'paused';
  const code = error?.code, message = typeof error === 'string' ? error : String(error?.message || '');
  if (/No SEO data came back/i.test(message)) return 'failed: No SEO source data was available. Check the search connections in Admin.';
  if (/Google Trends|SerpApi/i.test(message)) return 'failed: The search data provider is unavailable or rate limited.';
  if (/Keyword Planner/i.test(message)) return 'failed: Keyword Planner access is unavailable. Check Google Ads API access in Admin.';
  if (code === 'usage_limit' || code === 'usage_paused' || /429|quota|credits|rate.limit/i.test(message)) return 'failed: The AI provider has reached a usage limit or has no available credits.';
  if (/Timeout|Abort/.test(error?.name || '') || /timed out|timeout/i.test(message)) return 'failed: The SEO check timed out. Completed reports remain saved.';
  if (/401|403|permission|authentication|not connected|not set/i.test(message)) return 'failed: A required provider connection is unavailable. Check Admin → Connections.';
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return 'failed: SEO data could not be read or saved.';
  return 'failed: The SEO check could not finish. Any completed reports remain saved.';
}

/** Start ownership only after the existing SEO-run guard succeeds. Completion cannot replace a newer run. */
export async function trackSeoJob({ run, readPrevious, writeStarted, writeFinished }) {
  let startedAt = null, previous = null;
  const started = async at => {
    previous = await readPrevious();
    await writeStarted({ name: 'seo', last_run_at: at, last_result: 'running' });
    startedAt = at;
  };
  try {
    const result = await run(started);
    if (startedAt) {
      // Actual agent_runs remains the source of truth if this display-only update is unavailable.
      try { await writeFinished(startedAt, { last_run_at: startedAt, last_result: seoSuccessSummary(result) }); } catch { /* retain successful work */ }
    }
    return result;
  } catch (error) {
    if (startedAt) {
      const paused = error?.name === 'Paused';
      try { await writeFinished(startedAt, { last_run_at: paused ? previous?.last_run_at || null : startedAt, last_result: seoFailureSummary(error) }); } catch { /* preserve the original failure */ }
    }
    throw error;
  }
}

/** Read-only fallback for historic stale scheduler rows; it never launches a new check. */
export function latestSeoJob(job, run) {
  const runAt = Date.parse(run?.started_at || ''), jobAt = Date.parse(job?.last_run_at || '');
  if (!run || !Number.isFinite(runAt) || (Number.isFinite(jobAt) && runAt < jobAt)) return job || null;
  if (runAt === jobAt && job?.last_result && job.last_result !== 'running') return job;
  const last_result = run.stage === 'paused' || run.status === 'waiting' ? 'paused'
    : run.status === 'done' ? seoSuccessSummary(run.state)
    : run.status === 'failed' ? seoFailureSummary(run.error)
    : run.status === 'running' ? 'running' : null;
  return last_result ? { name: 'seo', last_run_at: run.started_at, last_result } : job || null;
}
