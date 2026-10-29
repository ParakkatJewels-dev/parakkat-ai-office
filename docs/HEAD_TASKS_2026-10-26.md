# Assign tasks to AI heads — 26 October 2026

**Migration 011 and the final r4 head-task release are deployed; the office remains manually paused.** Authenticated UI checks and independent database reads verified task creation, persistence and atomic cancellation with zero recorded provider calls. The final image retains the office-occupancy correction and accurately distinguishes cancellation from human rejection.

The latest full-suite gate passed **502/502 tests**. The subsequent cancellation-label fix passed **17/17 focused UI tests**, including one new regression added after that full-suite run. Typecheck and diff checks passed at the full-suite gate. Live model delegation and human acceptance were deliberately not run while the manual pause was preserved.

The archived `head-task-20261026-r2` candidate is **obsolete**: it predates the occupancy correction and is not a deployment or rollback target. Current r4 and its verified r3/occupancy predecessors are recorded below.

## User flow

1. In **Automations**, select **Assign to an AI head**, choose an accessible enabled department head, and supply the task, brief, priority and optional deadline or prerequisites. The existing agent interface also links an eligible head to this assignment flow.
2. The AI head interprets the request, writes success criteria and assigns a concrete contribution to one specialist by default. It may choose two specialists when their different expertise is needed. An authorized colleague may be another department's AI lead; that colleague does not delegate again within this task.
3. Each selected agent performs its own bounded turn using its current saved instructions and relevant recorded business evidence. Its actual contribution, summary, limitations and missing requirements are persisted before the next stage.
4. The responsible head reviews those saved contributions. It can approve a complete deliverable, request one focused revision from one assigned specialist, or block the task for missing input. A blocked or incomplete contribution cannot be approved merely because the model says it is ready.
5. After AI approval, the database atomically forwards the final output to **Approvals** and marks the task as awaiting human review. The human sees the responsible head, final deliverable and AI review note, and can **Accept**, **Send back** with feedback, or **Reject**.

Acceptance completes the task. Sending back queues a new explicitly requested work round with the feedback and a bounded excerpt of the previous delivery. Rejection cancels the task. Cancellation from Automations also closes any outstanding linked human report. A head task cannot be accepted or force-completed through the generic Automations action; the human decision uses the Approvals report.

The task detail shows the interpretation, selected specialists, saved contributions, review state and activity. Office movement/dialogue events describe delegation, work being returned and review generically; private briefs, specialist deliverables and human feedback remain in the scoped task and report. These work exchanges do not create a meeting.

## Authorization and evidence

Only the department's currently assigned, enabled AI lead can own a head task. The department must have a human head role other than `viewer`. Viewers cannot create, read or decide these workflow records. A department head can manage their currently assigned departments; the Super Admin can manage all applicable departments.

The server derives `input.allowedDepartments` at creation. Browser-supplied state, result, owner scope or executable actions are not accepted as workflow output. Each active stage intersects that original scope with the creator's current profile role and department access. Newly acquired access does not silently expand an existing task. Loss of access, a disabled agent or a changed responsible head stops the work. The handoff transaction independently checks the current creator, responsible head, worker availability and department scope again.

Specialists must be real roster agents, enabled and within that scope. Humans, scheduled sync bots and the responsible head itself cannot be selected as a worker. A maximum of two distinct assignments is enforced both in application validation and at handoff. Current saved agent instructions are loaded for each actual model turn.

Evidence comes from selected, recorded sources relevant to the brief, with bounded samples, timestamps and coverage limits. It does not read arbitrary private conversations, customer records or other departments' restricted reports. Missing product rows or stock quantities remain unknown; store-wide sales totals are not allocated to individual products. A recorded source read is not a live provider sync or proof that all business records were inspected.

## Calls, retries and usage controls

One successful model stage runs per durable queue claim. The normal successful round uses:

| Work selected | Calls without revision | Maximum with one automatic revision |
| --- | ---: | ---: |
| One specialist | 3: plan, specialist, head review | 5 |
| Two specialists | 4: plan, two specialists, head review | 6 |

The optional revision reruns only the named worker and the head's review. Completed peers stay saved. There is no recursive delegation or automatic chain of repeated revisions. Human **Send back** is a new explicit round, so repeated human requests can add further calls; the table is not a lifetime cap for the task.

A durable pending-call marker prevents an uncertain provider outcome from being repeated automatically after a crash. Explicit retry preserves completed contributions. Retrying a failed database handoff preserves the approved output and performs no new model call. Budget-denied calls clear the no-request marker because the guard established that no provider request was made, allowing the existing budget-resume behavior.

Head planning and review use the selected manager tier; specialist work uses the selected worker tier. The release preserves the account's model selections, existing low-reasoning support, office pause and shared rolling usage controls. Defaults from migration 010 remain 40 calls/200,000 tokens per rolling 24 hours, 200 calls/1,000,000 tokens per rolling seven days, a 30,000-character prompt ceiling and a 2,400-token output ceiling. These app controls do not measure or guarantee the remaining allowance of a ChatGPT plan shared with other activity.

## Deliverables and execution limits

This workflow produces internal analysis, copy, scripts, plans and text drafts. Each worker's body is bounded to 6,000 characters and the head's final deliverable to 12,000 characters. The UI can display and export the saved workflow output, but a textual description is not proof that an external operation or file-generation step occurred.

This generic task path does not send customer messages, publish campaigns, spend money, alter stock, change provider accounts, run provider syncs or generate image files. An image request can produce a creative brief and identify the required Design Studio step; it does not return a fabricated image artifact. Existing campaign, Studio, connector and explicitly reviewed provider-action workflows keep their own capabilities and approval requirements. Human acceptance of a head report does not automatically execute those operations.

Missing essential evidence or an unavailable execution step leaves the task blocked with the requirement stated. Existing drafts and contributions remain available for review.

## Migration and consistency

[20261026001100_head_task_handoff.sql](../supabase/migrations/20261026001100_head_task_handoff.sql) was applied after migrations through 010, following the user’s explicit approval. The authenticated Supabase SQL Editor returned “Success. No rows returned.” The subsequent independent schema audit passed. The migration adds `head_task` to the durable task kind constraint and a nullable, unique `reports.automation_task_id` link. It adds no recurring schedule, resumes no work and updates no existing business rows.

The service-only `handoff_head_task(uuid, uuid, jsonb)` RPC locks the task and report in a consistent order. It requires a live owned lease, the persisted `handoff` phase, the responsible head's saved approval, an exact match between the approved final text and the output being forwarded, and a completed nonblocked contribution for every assignment. It creates or updates the task's single linked report, sets the task to human review, releases the lease and records activity in one transaction. A response lost after commit can be replayed without another report or another handoff event.

The four-argument `decide_report(p_report, p_decision, p_note, p_revision)` validates the current linked task and the exact report revision displayed to the human. A stale browser page cannot approve a later rewritten delivery. The original three-argument form remains compatible with ordinary reports and refuses linked head-task decisions without a revision. Human decisions update the report and task atomically using the same task-then-report lock order.

A human send-back clears the prior plan, outputs, review, blocked markers and evidence snapshot; it increments `humanRevision`, resets the automatic revision allowance, and retains the feedback plus at most 8,000 characters of the previous delivery. The next approved delivery reuses the report ID and increments its revision. `cancel_head_task(uuid, integer, uuid)` verifies current actor access and task revision before atomically cancelling the task and rejecting an outstanding linked report. Browser roles cannot call the service handoff/cancellation RPCs or forge task writes.

Ordinary reports retain their existing decision behavior. Linked reports additionally retain the task system's non-viewer access rule after department reassignment. Report/task associations are preserved by a foreign key rather than deleted with work-history cleanup.

Frozen migration SHA-256: `43489b1d3804dc93854267f89ef533aa8681e792d11d419f3871f4f3a5214698`.

## Verification and rollout evidence

| Check | Measured result |
| --- | --- |
| Latest complete local test suite | **502/502 passed**, as reported by the release owner. Typecheck and diff checks passed. |
| Final cancellation display regression | **17/17 focused UI tests passed**, including one new test after the full-suite run. It distinguishes a cancelled unreviewed task from a human rejection. This is a display correction; the production cancellation RPC already persisted the correct decision. |
| Focused head-task DB/core/runtime verification | **25/25 core/runtime tests and 16/16 focused database tests passed.** Includes staged engine execution with mocked providers, one targeted revision, no automatic repeat after uncertain calls, budget handling, pause/cancellation, current instructions and access checks, handoff rollback/idempotency, stale human revisions and ordinary-report compatibility. |
| Independent service/runner/API review | **Passed with no further release blockers** after adding the handoff check for viewer-owned departments and the original head scope. Authorization-race regressions are included in the full-suite gate. |
| Production migration 011 | **Applied after explicit user approval.** SQL Editor success was captured; schema audit at **20:23:00 IST** confirmed the linked report column and service OpenAPI for `handoff_head_task`, `cancel_head_task` and four-argument `decide_report`, including `p_revision`. Anonymous task read and all-null service RPC probes returned 401. No claims, mutations or model calls were performed by the audit. |
| r3 build and deployment | **Passed.** Image `parakkat-ai-office:head-task-20261026-r3`, manifest **`sha256:4bd80beeea558c2069f53ad5cbc0b3ded20b24af8f9987a42f7da371a9e39a43`**, deployed to only AI Office's app and scheduler. It retains the occupancy correction. Archive: `/opt/parakkat-ai-office/head-task-r3-image.tar`. |
| r3 runtime and isolation audit | **Passed at 20:28:32 IST.** App healthy, both services on the expected image, scheduler completed two ticks, no application/scheduler errors, restarts or OOM. All 22 unrelated containers, including Hermes, were unchanged. Pause, model choices, budgets, schedules, resource/network settings and protected-file permissions remained unchanged; dedicated builder stopped. |
| Authenticated head-assignment UI | **Passed.** Creative Director's profile **Assign a task** action selected Creative Director in Automations. The live task detail showed Creative Director, Creative Studio, Creative Head as human recipient and the five workflow stages. |
| Queued task persistence | **Passed at 20:29:26 IST.** Task `5464a305-90a9-4c8c-9a67-f26c46eae25a` persisted as `head_task`, `queued`, owner `creativeDirector`, department `creative`, revision 1. Its server-derived Super Admin scope contained 21 departments. Exactly one `created` event; no report link. |
| UI cancellation and persistence | **Passed at 20:31:31 IST.** The same task persisted as `cancelled`, revision 2, with `headWorkflow.humanDecision='cancelled'`. It retained the internal terminal phase `rejected`, which the r4 display fix now distinguishes from a human report rejection. Exactly two events: one `created` and one `cancelled`; no linked report or report ID. |
| Existing human approval inbox | **Passed.** Approvals still loaded its 16 existing reports. The verification did not accept, send back, reject or modify an existing report. |
| Usage during live UI verification | **Zero recorded head-task usage rows and zero total provider-usage rows** since **14:57:17 UTC / 20:27:17 IST** in both queued and cancelled audits. The office remained paused. These are app usage records, not the external ChatGPT allowance meter. |
| Live model delegation and human approval round | **Not run because the manual office pause was preserved.** Mocked runtime/database tests and persisted UI state do not establish a completed live model delegation or human-acceptance round. No provider action was tested. |
| Final r4 image and cutover | **Passed.** Capped production build compiled, checked types and exported successfully. All 336 manifest files matched deployed source; only the UI helper and its regression test changed from r3. Image `parakkat-ai-office:head-task-20261026-r4`, manifest **`sha256:76ae94a4c5de758295d2529635f9219ff8a6306b3e0d5d97155651d96e5a19db`**, config `sha256:416390807721c75275f61c20be71e0edf579fad279b100a08a2842302aa7d96f`. Only AI Office's app/scheduler were recreated. |
| Final r4 UI/runtime/isolation audit | **Passed at 20:36:55 IST.** App healthy and scheduler completed a tick on the exact r4 image, with no errors, restarts or OOM. Pause, models, budgets, schedules, private permissions, resource/network settings and all 22 unrelated containers remained unchanged; builder stopped. Chrome verified `Cancelled` and `Task cancelled before human review.`, then reopened the blank assignment form with Creative Director selected and no browser errors. |

Measured evidence:

- Migration approval/success: `/tmp/parakkat-head-task-migration-approval.png`, `/tmp/parakkat-head-task-migration-success.png`.
- Independent schema audit: `/tmp/parakkat-head-task-r3-schema-audit.json`.
- r3 build/cutover and runtime verification: `/tmp/parakkat-head-task-r3-build-result.json`, `/tmp/parakkat-head-task-r3-cutover-result.json`, `/tmp/parakkat-head-task-r3-final-verification.json`.
- Queued and cancelled persistence/usage proofs: `/tmp/parakkat-head-task-r3-queued-proof.json`, `/tmp/parakkat-head-task-r3-cancelled-proof.json`. Sanitized reads selected only task metadata, scope, event kinds/counts, linked-report counts, usage counts and pause; they did not retrieve briefs or deliverables.
- Live queued task screenshot: `/tmp/parakkat-head-task-queued-live.png`.
- Pre-r4 readiness at **20:31:32 IST**: `/tmp/parakkat-before-head-task-r4-summary.json` confirms healthy r3, no active work, manual pause and unchanged models, budgets, schedules, permissions and all 22 unrelated containers.

## Final cutover and rollback

Final verification: `/tmp/parakkat-head-task-r4-final-verification.json`. Browser screenshots: `/tmp/parakkat-head-task-cancelled-live.png` and `/tmp/parakkat-head-task-assignment-live.png`. The live assignment form was left open for the user. The test task is cancelled, not pending execution. No shared proxy/service changes occurred, and Hermes remained untouched.

The immediate r4 rollback target is the verified r3 image **`sha256:4bd80beeea558c2069f53ad5cbc0b3ded20b24af8f9987a42f7da371a9e39a43`**, retained as `parakkat-ai-office:before-head-task-20261026-r4`. Before the r3 rollout, tag `parakkat-ai-office:before-head-task-20261026-r3` retained the occupancy release **`sha256:f798442f0a6cd3c7c94268b1b1581d544e1f72cf134f3957692678b35b6c512c`**. That predecessor does not contain head-task support. The r2 candidate is obsolete and must not replace either verified image.

Use the established deployment procedure to restore only this Compose project's app/scheduler, retaining one scheduler owner. Keep migration 011 and saved tasks/reports. If reverting to the occupancy predecessor, keep work paused because older code cannot operate the existing head-task records; do not delete them to simulate rollback. See [business automation release](BUSINESS_AUTOMATION_2026-10-26.md), [text usage controls](TEXT_USAGE_2026-10-26.md) and [self-hosting](SELF_HOST.md).
