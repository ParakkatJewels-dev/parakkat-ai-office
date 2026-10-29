# Lead opportunity reviews — 26 October 2026

This update gives the AI department leads a separate opportunity-review schedule while existing campaigns await human decisions. The new image passed the isolated service audit at **16:00:41 IST**. Its first automatic review completed at **16:01:19 IST** and forwarded two supported reports to the human heads.

## Diagnosis

The read-only audit at approximately **15:46 IST** found a healthy app, successful minute ticks, no resource pressure or stale job locks, and a connected ChatGPT account with neither the office nor inference paused. Two campaigns had finished their pipelines and were waiting for human approval. The daily planner last ran at **11:48 IST**, returned “nothing new,” and was not due again until the next working-day window. A working scheduler therefore did not mean a new campaign or opportunity would appear each minute.

The scheduler container also showed a misleading unhealthy status because it inherited the application's HTTP healthcheck despite having no HTTP server. Its ticks were succeeding. The Compose update disables that inherited check for the scheduler; process exits remain covered by its restart policy.

## New behavior

- Scheduled opportunity reviews become eligible **hourly from 09:00 inclusive to 20:00 exclusive, Asia/Kolkata**. The minute scheduler selects due work, so this is an eligibility interval, not a promise to start exactly on the hour.
- Each review selects **two relevant, enabled department leads**, rotating through recent participation. Their actual contributions are saved sequentially, then the CMO reviews the candidates. Fewer than two eligible leads produces an explicit skipped review.
- At most **two supported recommendations** are forwarded to the relevant human heads. Finding no defensible new opportunity is a valid result; the agents do not invent reports to appear busy.
- Super Admin can request the same review from **Admin → Overview → Find opportunities now**. This manual request bypasses the hourly waiting period, but respects the shared lock and pause switch. The page shows progress, completed findings, and links to the proposals.
- The campaign tile distinguishes work in progress from campaigns awaiting approval. The existing daily campaign planner and campaign approval process remain separate.

## Evidence, concurrency, and pause rules

Reviews use recorded product sales/stock, performance, ads, social posts, searches, competitor observations, alerts, and planning-calendar evidence. Every candidate must cite a recognized source ID and an exact excerpt from that source. The CMO can forward only candidates actually proposed by a lead. Date windows exclude the current partial UTC day; missing values remain unknown, and incomplete samples or overlapping attribution are labeled.

Recent matching titles, fingerprints, and evidence are checked to suppress repeated reports. The bounded lookup checks up to 80 opportunity reports from seven days; the CMO receives a shorter recent-summary sample. This is not a claim of exhaustive semantic deduplication across all history.

Manual and scheduled reviews share a **200-second lease**. The winning runner alone records job start and outcome. It rechecks scheduled eligibility after acquiring that lease, and its final job update matches its own start timestamp so an old completion cannot overwrite a newer attempt. Busy or no-longer-due callers leave the winner's state unchanged.

Review work is bounded to **165 seconds**, with at most three model calls capped at **45 seconds each** and short bounded cleanup. Checks around model calls and report forwarding verify pause state, lease ownership, and enabled participants. Pausing preserves completed findings and restores the earlier schedule timestamp so the work can become due after resume. Errors are shown as failures, not successful reviews. The UI uses fast polling during the initial request and active work, and identifies interrupted runs after 210 seconds.

## What heads should do

Open **Approvals** to read the forwarded report's evidence, proposed next step, success check, and CMO review. Accept, request changes, or reject through the existing report controls. A recommendation is not an executed action: this review does not launch ads, change budgets, message customers, create campaigns, generate images, or modify provider accounts.

The two existing campaigns remain intact and await their existing approvals. This update does not publish, delete, restart, or automatically approve them. Approved-artwork freezing and the guarded Meta publishing flow remain in place; Google publication remains manual.

## Validation and release record

| Check | Result |
| --- | --- |
| Final full source validation reported by deployment owner | **190/190 tests passed**, typecheck and diff check passed. No database migration is required for this update. |
| Independent final schedule/opportunity check | **15/15 passed**, including the shared-lease due-time recheck, rotation, source validation, duplicate handling, partial failure, and valid no-op outcome. |
| Live read-only schema/query-shape checks | **14 queries passed**, as reported by deployment owner. These verify reader compatibility, not model recommendation quality. |
| Independent integration review | No remaining blocker found after shared job ownership, conditional final writes, pause restoration, and initial progress polling fixes. |
| Final production image / build result | Build passed. App and scheduler use `opportunities-20261026` / `local`, immutable OCI manifest **`sha256:53b6dc994f4e18a69d061828a60ecf681e8231ea7c2e26137349a6b242d01253`**, independently verified against the image descriptor. Only AI Office's app and scheduler were recreated. |
| Live automatic review, saved reports, and Admin UI | **Passed.** Scheduled run `91b93f3f-3dd4-4d25-9845-2542a9323b24` completed at **16:01:19 IST** in about 71 seconds. Analytics Lead, Performance Lead, and CMO each completed a ChatGPT call. Two reports were saved as `with_head`; Admin automatically changed to Reviewed and showed two Awaiting your review cards. |
| Approvals rendering | **Passed.** Both new reports appeared at `/approvals#reports` with their author, CMO note, full body, evidence, next step, success check, and Accept / Send back / Reject controls. No approval action was performed during verification. |
| Scheduler status after redeploy and isolation audit | At **16:00:41 IST**: app healthy; scheduler running since **16:00:07 IST**, inherited HTTP healthcheck disabled (`Test=["NONE"]`), zero restarts/OOM/error-log matches. At **16:02:49 IST**, a follow-up read-only log check found **3 completed ticks**, zero failed requests, and zero error-keyword matches. |
| Resources and existing services | App: 1 CPU / 1.5 GiB / 192 PIDs; scheduler: 0.25 CPU / 128 MiB / 64 PIDs, only AI Office's internal network. Neither publishes host ports. Dedicated builder stopped with 1 CPU / 2 GiB caps. **All 22 pre-existing containers, including Hermes, retain baseline IDs/start times.** |
| Preserved rollback image | `before-opportunities-20261026` resolves to the prior production manifest **`sha256:7a797293e31f65e84c9efd9b73374f404457ea4febe9ff278ffbb787c684343d`**. Stop only AI Office's scheduler before a reviewed rollback; preserve its environment/private volumes and keep old Vercel/Supabase schedules disabled. |

The live reports proposed investigating a recorded INR 105,136 revenue decline and reviewing Google Shopping profitability. An independent connector review validated the three cited source excerpts against the saved evidence. No new campaign was created, no provider action was executed, and pause/budget settings remained unchanged. Existing campaign approvals were preserved. Screenshot: `/tmp/ai-office-opportunities-live.png` (temporary local evidence).

Sanitized audit evidence: `/tmp/parakkat-opportunities-final-readonly-audit.json`. No production changes were made for the audit or preparation of this document. See [production readiness](PRODUCTION_READINESS_2026-10-26.md) and [self-hosting](SELF_HOST.md) for connector limitations, preserved credentials, deployment isolation, and rollback safeguards.
