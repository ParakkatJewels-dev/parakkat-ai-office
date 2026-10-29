# Task usage reporting — 27 October 2026

The Super Admin Usage page adds **By task**, with task-type, current-status and period filters, plus server-side pagination. Campaigns use their actual run UUID; conversations use the individual `agent_tasks.id`, not the thread; head tasks use `automation_tasks.id`. Campaign identity persists through nested design/review scopes. SEO and opportunity run IDs are not mislabeled as campaigns.

## Metering

- Recorded text-model attempts include successful and failed requests. Known provider input/output counts remain measurable even when a request fails validation.
- Unknown usage is separate from measured tokens and retains the reservation's conservative estimate. It is not presented as actual provider consumption.
- Cache hits, successful shared in-flight results, deterministic answers and saved checkpoints are separate reuse events. They do not create another provider reservation or inflate the existing paid-call report.
- The original request owner receives the provider attempt; another task sharing that request receives only an in-flight reuse event. Existing cache identity and admission behavior are unchanged.
- The report uses reservation actuals when available, including when event settlement was interrupted. Task status comes from the current underlying task, while metering totals are limited to the selected period.

Tracking starts with this release; historical conversation and head-task usage is not guessed or backfilled. Text usage is covered; image requests and non-AI connector calls remain in Call history. Event writes are best effort and bounded to 1.5 seconds per write, so an unavailable telemetry service does not fail work or cause an AI retry. Consequently, these are recorded task totals, not a replacement for provider billing or the app's authoritative budget ledger.

## Privacy and schema

Apply `supabase/migrations/20261027000100_task_usage.sql` and the defensive `20261027000200_task_usage_guard.sql` follow-up before deploying the new application. They add `task_usage_events` and `task_usage_report(...)`, with an explicit fail-closed check for a NULL administrator result. The existing role helper already defaults missing profiles to Viewer. Existing budget tables, limits, usage totals and business records remain unchanged.

The event table contains IDs, static feature/agent labels and metering fields only. It has no prompt, task title, response, user identity or error-message field. Browser access is read-only for signed-in Super Admins; anonymous users and other roles cannot read task metering or call its report RPC. Only the service role can insert/update events. The report's narrowly scoped definer function reads only task status and never returns underlying private task content. Existing conversation access policies remain unchanged.

`withUsage({task:{kind:'campaign'|'conversation'|'head_task',id}})` establishes task identity. `recordTaskUsageEvent({event:'deterministic_reuse'|'checkpoint_reuse',agent?,feature?})` records reuse within that scope. There are no new automatic provider calls or usage-setting mutations.

## Validation

Regression tests cover concurrent scope isolation, cache/shared ownership, known and unknown failed usage, failure-safe telemetry, protected metadata, server-side filters, pagination, missing-schema/error feedback, and SQL grants/RLS. Deployment and live verification are recorded in the release report after installation.

## Production installation

Released with `workflow-efficiency-jev-20261027-r1` on 27 October 2026, with the AI Office app/scheduler cutover at **14:37:13–14:37:20 IST**. Both additive migrations were applied before cutover. A database catalog audit verified the reviewed RPC body, fixed search path, RLS and grants; the deployed API then confirmed all event columns exist and anonymous table access is denied.

- Full application suite: **771/771 passed**, with no failures or skips. Typecheck and production builds passed. A final CSS-only alignment compatibility correction was followed by clean local and remote builds.
- Frozen deployment: **462 files**, source manifest `d1f5fdaab2e6ed6b3fbda9c0db04640799cc76700a2a07125de1716810d03a95`.
- Image: `sha256:b1cb044c4cdfa90c10b8403cfd577f3aeab79e9bc669b9fa3c26191b9438d696`; all 18 exported blobs were digest-verified before loading.
- Final deployment checks: **20/20 passed**. App healthy, scheduler heartbeat after cutover, HTTPS and container-local login successful, auth redirects intact, no runtime errors/restarts/OOM. Existing settings, model environment, credentials, volume permissions and resource limits preserved. Hermes and all **22 unrelated containers** retained their identities and start times. The isolated builder was stopped after its capped 1 CPU / 2 GiB build.
- A separate external change to the monthly billing budget, ₹500 → ₹1,000, was detected before cutover. Deployment initially stopped at its guard; a fresh baseline preserved the current ₹1,000 value. No budget or pause-state database write was made by deployment, and all other settings matched the original baseline.
- Rollback retained as `parakkat-ai-office:before-workflow-efficiency-jev-20261027-r1`, pointing to the preceding token-efficiency release.
- The authorized Jev synthetic connection test succeeded after the deployment gates. A subsequent read-only audit passed **7/7 checks**, proving only the new Jev file's health metadata changed; its key/configuration and all pre-existing credentials remained unchanged.

Local proof artifacts are `/tmp/parakkat-workflow-efficiency-jev-r1-final-verification.json`, `-post-test-verification.json`, `-external-state-delta.json` and `/tmp/parakkat-task-usage-grants.txt`. This installation record was appended after cutover; it does not alter the frozen deployed application snapshot.
