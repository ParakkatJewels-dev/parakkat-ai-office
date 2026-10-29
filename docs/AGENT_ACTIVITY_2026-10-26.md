# Agent activity counts — 26 October 2026

The Agent Reports page used the age of the latest event to infer current work: an event less than ten minutes old meant “Working now.” Completion events therefore left finished agents marked busy. The office map used live execution leases, but also counted local speech, walking and approval animations. These definitions could disagree.

## Correction

- Both current counts use the same scoped `/api/agents/work-status` feed and the shared `isWorkingStatus` predicate. Only an unexpired server scope in `working` state counts. Local animations remain visible above agents but do not inflate the execution count.
- Reports, individual agent badges and the map refresh current activity through one lightweight hook per visible page, every four seconds. This performs no inference or external provider action.
- Completion clears the current count on the next successful poll. Leases expire locally; a stalled or failed feed shows an unavailable state rather than reporting a confirmed zero.
- Background tabs stop polling. Visibility and account changes invalidate pending responses; cleanup aborts requests and removes timers/subscriptions.
- “Active today · IST” means activity since midnight in India. Historical activity and currently running work are separate measures. An agent observed working stays recorded as active today after its job ends; future or malformed history timestamps cannot override valid observations.
- Existing department permissions and disabled-agent filtering remain enforced. No database migration or pause change is needed.

## Release isolation

The pending head-task feature requires migration 011 and has not been approved for deployment. This correction was therefore built from the exact live efficiency-r2 source recovered into `/tmp/parakkat-occupancy-hotfix`: all 251 original manifest files matched before the eleven-file activity overlay. The isolated source contains no head-task code or migration 011. Main workspace changes preserve both the pending feature and this correction.

Production source: `/opt/parakkat-ai-office/occupancy-hotfix-source`.
Candidate tag: `parakkat-ai-office:occupancy-20261026`.
OCI manifest: `sha256:f798442f0a6cd3c7c94268b1b1581d544e1f72cf134f3957692678b35b6c512c`.
Image config: `sha256:87469bb3f34f631b1d706467a18c3db7ab1c7a6f0ae029d93a008939a984b657`.

The earlier `head-task-20261026-r2` candidate predates this fix. Rebuild that feature from the current workspace before a future approved deployment; do not promote its stale archive.

## Verification

- Isolated full suite: 439/439 passed, followed by ten additional hook/UI regression tests; final focused suite: 16/16 passed.
- Independent activity/work/feed/hook suite: 41/41 passed.
- TypeScript, production compilation and image export passed. Only the dedicated builder was used, capped at one CPU and 2 GiB; it was stopped after export.
- Cases cover completed-but-recent events, live work with no event yet, IST midnight, disabled/unscoped agents, animation exclusion, lease expiry, healthy empty versus failed feeds, overlapping polling, stale account responses and cleanup.
- Production cutover completed. At **18:51:29 IST**, app health and the scheduler's completed tick were verified on the exact candidate image. No restarts, out-of-memory events or error logs were observed. All 22 unrelated containers retained their IDs and start times; the dedicated builder was stopped. Pause, model selections, budgets, recurring settings, networking/resource caps and private-file permissions were unchanged. Audit: `/tmp/parakkat-occupancy-final-verification.json`.
- Authenticated Chrome verification passed: Agent Reports shows **Active today · IST 25/67** and **0 working right now**; the office shows **Live Occupancy 0/67**, with zero for all buildings. A completed War Room Lead job shows **Active today** on its profile. Report and map browser error logs were empty.
- Screenshots: `/tmp/parakkat-agent-activity-reports-live.png` and `/tmp/parakkat-agent-activity-office-live.png`.
- Previous production image `sha256:5c6ff4cb8fdaadffa6ff9957e9b191d40fc1c136b8551376b449d0b96ab30e3b` retained as `parakkat-ai-office:before-occupancy-20261026`. Rollback must recreate only this project's app/scheduler, preserving pause and volumes.

No live model calls were made for this verification. The manual office pause must remain enabled. Preserve Hermes, the shared proxy and all other applications.
