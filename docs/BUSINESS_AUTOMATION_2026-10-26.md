# Business automation release — 26 October 2026

**Deployed; the office remains manually paused.** The business workflows and text-usage controls are running on AI Office's VPS image `business-efficiency-20261026-r2`. Migrations 007–010, the production build, service cutover and isolation audit passed. Authenticated workflow verification and the provider permission/setup gaps below remain separate pending checks. All 22 unrelated containers, including Hermes, retained their IDs and start times.

## Intended workflows

The shared task system provides durable ownership, due dates, dependencies, saved outputs, human review, action receipts, and follow-ups. The workflow templates cover a daily management briefing, data quality checks, campaign production through the existing campaign/Studio pipeline, inventory planning, customer-enquiry drafting, catalogue maintenance, and advertising improvement proposals. Internal drafts, reviewed provider actions, and completed provider operations are separate states.

Inventory outputs are proposals based on the available recorded stock/sales and configured location rules; this release does not imply an Odoo transfer or purchase-order write capability. Existing Odoo coverage is sales orders, not the absent POS models. Campaign publication remains under the existing approval flow. Catalogue writes require Shopify product-write access and a reviewed, saved change. Instagram replies require a saved inbound recipient, a reviewed reply, an unexpired provider-time reply window, and a unique execution claim; ambiguous outcomes require inspection instead of automatic resend.

## Persistence and access

These additive migrations were applied in order, inside one transaction after approval:

1. `20261026000700_business_automation.sql`: task/event/action/schedule/settings/inquiry tables, department-scoped reads, service-only writes, atomic task leasing, campaign-to-task idempotency, frozen action payloads.
2. `20261026000800_instagram_inbox.sql`: provider message metadata and a service-only atomic inquiry/task ingest function. Retries preserve one inquiry/task. Older-than-24-hour imports are blocked for manual handling. Sender deletion notifications redact source/draft/task content, cancel pending work, and preserve a tombstone so polling cannot restore the source. Frozen action receipts remain a restricted audit; do not describe those as erased history.
3. `20261026000900_automation_action_claim.sql`: atomically locks a reviewed task and inserts its unique action claim, preventing competing browser requests from leaving orphaned execution claims.
4. `20261026001000_ai_usage_budget.sql`: service-only atomic text reservations/settlement and a restricted response cache, with administrator-visible rolling limits. Defaults are 40 calls/200,000 tokens per 24 hours, 200 calls/1,000,000 tokens per seven days, 30,000 input characters and a 2,400-token output cap. Unknown outcomes retain their reservation; these app limits are not the ChatGPT account's own allowance meter.

The new recurring schedules are **seeded disabled**. Enable the intended bounded schedules only after the deployment and workflow verification. No customer message is sent merely by importing an enquiry or generating its draft. Viewers cannot read the task/inbox data. Department head changes immediately affect access; customer enquiries belong to the CRM head and Super Admin.

The established production migration method is the authenticated Supabase SQL Editor. Migrations 007–010 were committed there after approval. The independent read-only verification at **18:04:18 IST** found all nine new tables and the budget-status RPC, confirmed the intended defaults and disabled schedules, and verified anonymous requests to tasks, budget settings and the budget-status RPC were rejected. Artifact: `/tmp/parakkat-efficiency-schema-audit.json`. The current environment inspection found no direct database URL/password or Supabase management token, no installed Supabase CLI, and no local project-link configuration. Do not treat the service-role REST key as a database password or attempt SQL through arbitrary RPCs.

## Instagram connector contract and required setup

The connector uses the selected Facebook Page and linked Instagram professional account already stored by the Meta connection. It derives a Page access token in memory from the saved user token, without replacing the advertising token in the vault.

Required permissions are `instagram_basic`, `instagram_manage_messages`, and `pages_manage_metadata`. Meta documents Advanced Access for conversations involving people without an app/account/business role, appropriate Page messaging tasks, business verification, and the Instagram **Allow Access to Messages** setting. See [Meta getting started](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/get-started) and [Conversations API](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations).

The actual read-only permission probe on **26 October 2026** returned HTTP 200 and found these missing permissions: **`instagram_manage_messages`, `pages_manage_metadata`**. The current selected Page and Instagram account were present. Therefore live inbox read/send readiness is not yet established. Reconnect through the app's messaging-enabled Meta authorization flow and verify access; if using a Facebook Login for Business configuration, its permitted scopes also need the messaging additions. App Review/access-level configuration and the Instagram message-control toggle still require verification in their provider dashboards.

The callback is `https://ai-office.parakkatjewels.in/api/webhooks/instagram`. Verification uses `META_WEBHOOK_VERIFY_TOKEN` when configured, otherwise an HMAC-derived token from `META_APP_SECRET`; obtain it only through an appropriate secure setup path. POST deliveries require the raw-body `X-Hub-Signature-256`, have a 1 MiB bound, reject foreign selected-account identifiers, ignore echoes/self messages, and commit enquiry/task records before returning success. AI drafting happens later on the scheduler. No provider-supplied attachment URL or paging URL is fetched.

Polling is resumable through the existing `sync_cursors` table, bounded to five conversations per pass and the latest twenty readable messages per conversation. Meta limits message-detail reads to that recent set; this is not a claim of complete historical inbox coverage. Status checks are deduplicated in flight and cached for sixty seconds, with a nine-second aggregate Graph deadline. Sending uses one Page-token POST and does not retry an uncertain result. This implementation conservatively uses a 24-hour response window and a 1,000 UTF-8-byte text limit; it does not use special extended-window or Human Agent tags. See [Meta send-message contract](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/send-message), [messaging overview](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/overview), and [webhook setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup).

## Shopify setup gap

The actual read-only access-scope check returned HTTP 200 and confirmed that the saved Shopify token is missing **`write_products`**. Its three currently granted scopes permit the existing read integration; that does not authorize product edits. Publish/install the reviewed app-scope addition and reconnect as required, preserving the existing callback and reads. Verify access again before a catalogue update. No store content was changed during the scope check.

Sanitized scope evidence: `/tmp/parakkat-business-automation-scopes.jsonl`. Tokens remained in memory, provider responses containing private data were not printed, and the probe made only GET requests.

## Pre-release VPS audit

Fresh baseline captured at **17:39:48 IST, 26 October 2026**: `/tmp/parakkat-before-business-automation.json`.

- All **22 unrelated containers, including Hermes**, retained their IDs and start times against both `/tmp/parakkat-before-working-status.json` and `/tmp/parakkat-before-agent-update.json`.
- AI Office is healthy on the existing working-status image, manifest `sha256:2fba1896c48d81920e96a7bb0fbd5e8ba0ec4b54d2e656957ae454fe39119774`.
- The scheduler is running on that same image. Its previous fifteen minutes contained **15 completed ticks**, zero error-keyword matches, zero restarts, and no OOM kill. The most recent counted tick was **17:39:44 IST**.
- Application limits remain **1 CPU / 1.5 GiB / 192 PIDs**. Scheduler limits remain **0.25 CPU / 128 MiB / 64 PIDs**, private AI Office network only, and its inherited HTTP healthcheck is disabled. Neither service publishes host ports.
- The dedicated builder is stopped and retains **1 CPU / 2 GiB** limits. The root filesystem was **85.1% used**, with approximately **61.8 GB free**. No broad cleanup was performed.
- ChatGPT/provider-secret directories are mode `0700`, UID/GID 1000; the Gemini file is mode `0600`. The runtime environment is mode `0600`, owned by root. Required Supabase/Meta/Shopify credentials were checked for presence only.
- A separate read-only account-status check confirmed ChatGPT enabled and connected, but **usage-blocked**, with manager and worker both set to `gpt-6.1-sol`. This blocks new reasoning work until the account's usage allowance/state is resolved. The check did not invoke inference, refresh tokens, or clear the block.

The auditor made no changes to VPS files, containers, settings, schedules, database schema, provider accounts, or customer messages.

## Validation and rollout checklist

| Check | Result |
| --- | --- |
| Task/action storage focused tests | **14/14 passed.** Includes current-role RLS, denied client writes, leases, dependencies, stale-worker predicates, unique claims, frozen payloads, duplicate prevention, and disabled schedule seed. PGlite uses one connection; distinct queued claim calls are tested, not independent PostgreSQL sessions. |
| Instagram focused tests | **22/22 passed.** Includes exact HMAC/body bounds, selected-account checks, echo/attachment handling, safe fixed-host requests, provider-error sanitization, one-send/no-retry behavior, reply window/UTF-8 limits, atomic storage, duplicate/tombstone behavior, and transaction rollback. No live messages sent. |
| Final full tests/typecheck/review | **Passed.** Deployment owner confirmed 432/432 tests, typecheck and diff checks at the source-freeze gate. Evidence: `/tmp/parakkat-efficiency-final-tests.log`. Production Next.js compilation/type checks and all twenty static pages passed. |
| Live ChatGPT reasoning | **Not run for this release.** A later read-only check at 17:57:55 IST confirmed connected and `usageBlocked=false`; manager and worker are both currently `gpt-5.6-sol`. The office remains manually paused. This status check is not proof of a completed model workflow. |
| Apply migrations 007/008/009/010 in production | **Passed.** Applied through the approved SQL Editor transaction, then independently verified through read-only service-role and anonymous checks. |
| Production build / immutable image digest | **Passed.** Current r2 image is `parakkat-ai-office:business-efficiency-20261026-r2`, immutable manifest **`sha256:5c6ff4cb8fdaadffa6ff9957e9b191d40fc1c136b8551376b449d0b96ab30e3b`**. Archive: `/opt/parakkat-ai-office/efficiency-r2-image.tar`. All 251 frozen code/migration/deploy/config files matched VPS checksums. Builder is stopped. Initial release digest was `d397c604335a511711b7c2b9c79842485fe03d3b5d946bbd4c86bb6a86ce9808`. |
| Retain pre-release rollback image tag | **Passed.** `parakkat-ai-office:before-business-efficiency-20261026` preserves **`sha256:2fba1896c48d81920e96a7bb0fbd5e8ba0ec4b54d2e656957ae454fe39119774`**. |
| Drain existing work and switch only app/scheduler | **Passed.** Manual pause and zero active leases/study claims/conversations/meetings/agent runs/automation tasks were checked immediately before cutover. Only AI Office app/scheduler were recreated, at 18:07:21/18:07:27 IST. Private volumes and schedule ownership were preserved. |
| Authenticated UI, task, draft, review and action verification | **UI/settings/task persistence passed; model drafts and provider actions not run.** The live UI saved the daily call limit as 39 and restored 40, with confirmation, correct counters and no console errors. A data-quality verification task was created queued and cancelled while the office remained paused. Independent read-only verification at 18:15:28 IST confirmed the cancelled task, two durable events, all default limits restored, zero model reservations and zero API-usage rows since r2. Screenshots: `/tmp/parakkat-text-usage-live.png`, `/tmp/parakkat-workflow-cancelled.png`; audit: `/tmp/parakkat-efficiency-r2-final-ui-audit.json`. These checks do not establish provider-write capability. |
| Shopify product-write permission | **Missing in the verified token.** Provider setup/reconnect and a fresh permission check are pending. |
| Instagram messaging permission and webhook | **Two required permissions missing.** Provider setup/reconnect, advanced access/toggle checks, and real delivery verification are pending. |
| New recurring schedules | **Verified disabled.** All five seed schedules are disabled; customer channel remains `unconfigured`. Enable intended bounded schedules only after verification. |
| Final unrelated-container/runtime audit | **Passed after r2 at 18:13:17 IST.** All 22 unrelated containers are unchanged. App healthy; one completed scheduler tick, no error-keyword matches, no restarts/OOM; builder stopped; caps/networks/private modes unchanged. Global pause and both `gpt-5.6-sol` selections preserved. Public login returned 200; unauthenticated automations 401; wrong-origin POST 403; correct public-origin unauthenticated POST 401. |

## Rollback

Stop only AI Office's scheduler, let in-flight work settle, and preserve any provider action receipts or uncertain-action review state. Restore the verified previous AI Office image and recreate only this Compose project's application and scheduler with `--no-build --no-deps`. Keep the additive automation migrations and saved data; older code does not use the new tables. Do not delete action claims to retry a provider mutation, reset credentials, remove volumes, restart the shared proxy, or touch Hermes. Keep exactly one scheduler owner and verify health/isolation before resuming work.

See [self-hosting](SELF_HOST.md) and the [working-status release](WORKING_STATUS_2026-10-26.md) for the established service commands and current baseline.

## Proxy-origin correction (r2)

Authenticated UI verification found that the new automation POST route compared the browser's public origin only with the internal proxy request URL, rejecting legitimate requests with 403. The route now permits the trusted server `APP_URL` origin, matching the established conversation-route approach. Untrusted forwarded headers cannot add an allowed origin. The VPS `APP_URL` was verified as `https://ai-office.parakkatjewels.in` without exposing credentials.

Seven focused tests, including the proxy-origin regression, plus typecheck/diff checks and the capped production build passed. Only three code files changed; no full-suite rerun was required for this correction. The app/scheduler were recreated at **18:12:56 / 18:13:01 IST** after another pause/zero-active-work check. The original rollback tag remains retained, with the first efficiency release additionally preserved as `before-business-efficiency-20261026-r2`.

Unauthenticated production checks independently confirm wrong-origin POST → 403 and correct public-origin POST → 401 (origin accepted, authentication still required). Artifacts: `/tmp/parakkat-efficiency-r2-http-checks.json`, `/tmp/parakkat-efficiency-r2-final-runtime.json`, `/tmp/parakkat-efficiency-r2-final-active-work.json`, `/tmp/parakkat-efficiency-r2-loaded-image.json`, and `/tmp/parakkat-efficiency-r2-source-verified.json`. Authenticated save/create/cancel checks are recorded separately by the deployment owner; no model call or provider mutation was used for the origin checks.

## Text-usage efficiency update — deployed, office paused

A read-only aggregate of production `api_usage` covered **25 October 12:17:07 UTC through 26 October 12:17:07 UTC**. All 334 matching rows were paged; only provider, feature, success flags and numeric token counts were selected. No prompts, customer content or credential values were read into the audit output. Sanitized artifact: `/tmp/parakkat-text-usage-audit.json`.

| ChatGPT feature | Calls | Recorded input tokens | Recorded output tokens | Total |
| --- | ---: | ---: | ---: | ---: |
| Agent conversations | 34 | 370,619 | 11,688 | 382,307 |
| Opportunities | 6 | 77,904 | 4,005 | 81,909 |
| Campaigns | 14 | 23,203 | 6,548 | 29,751 |
| Design text | 5 | 6,802 | 1,455 | 8,257 |
| SEO | 6 | 4,345 | 1,340 | 5,685 |
| **Total** | **65** | **482,873** | **25,036** | **507,909** |

One of the ChatGPT calls failed. Existing usage rows record zero when token metadata was unavailable, so the total is recorded usage, not proof of complete account consumption. The separate Gemini library used 178 successful calls and 430,480 recorded tokens; those calls do not consume the app's ChatGPT connection. Library discovery already uses Drive metadata only, studies only new/changed files, and preserves completed studies. Its cadence is unchanged. A separate Gemini study allowance would be a distinct feature, not a ChatGPT quota fix.

Deployed controls:

- The exported ChatGPT wrapper now forwards cancellation, timeout and output options. Requests set `max_output_tokens` to 2,400 by default, bounded to 256–8,000. The result includes `usageKnown` and nullable `reasoningTokens`, so missing provider metadata cannot masquerade as confirmed zero usage.
- Documented GPT-6 and GPT-5.6 model families request `reasoning.effort: low`. The selected model stays unchanged. Previous requests did not specify an effort; this is not evidence that they used high reasoning. GPT-6.1 Sol documents `medium` as its default and supports `low`. The output ceiling includes reasoning as well as visible output; it may produce an incomplete answer if too small. See [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [reasoning controls](https://developers.openai.com/api/docs/guides/reasoning), and [token counting and limits](https://developers.openai.com/api/docs/guides/token-counting).
- Model catalogs are cached for five minutes per account and token revision, with concurrent requests deduplicated. Explicit Admin model-list calls refresh the catalog. Failed lookups are not cached, and cancellation of one caller does not cancel another caller's shared lookup.
- Recalled lesson context is limited to six selected excerpts of 600 Unicode code points each, with explicit excerpt labeling. Current saved agent instructions retain their full supported 6,000 Unicode code points and are freshly read on every call. Source-data sync and deterministic sales/stock checks retain their schedules.
- Opportunity reviews run every four hours during existing Indian working hours. A durable source fingerprint skips model work when substantive evidence, human feedback and agent guidance are unchanged. Observation timestamps, source-row order and newly generated opportunity reports do not count as new evidence. Only completed, persisted reviews mark a fingerprint complete. Failed/interrupted attempts retain a four-hour retry delay, including for repeated manual clicks; changed inputs can proceed.

Validation: **52 focused tests passed** across ChatGPT protocol, agent instructions, scheduling, opportunity logic and the real opportunity runner with mocked providers/database. The runtime tests verify zero extra model calls for unchanged inputs, fresh stock/instruction changes, failed-attempt backoff and office-pause preservation. Protocol checks also reject a changed account/model before inference so the budget/cache context cannot be silently switched. Separate campaign-budget tests verify the exact rolling retry time, prevention of early manual retries, and terminal correction requests for oversized inputs or unavailable retry times. Conversation errors expose safe budget explanations and preserve completed contributions.

No live inference was run for this update, no app settings were changed by the efficiency implementation/audit, and no before/after production savings are claimed. The combined production build passed, and the office's manual pause remains in place. App limits cannot guarantee the remaining allowance of a ChatGPT plan shared with other activity.

Fresh pre-efficiency baseline at **17:57:55 IST**: `/tmp/parakkat-before-efficiency.json`. The subsequent active-work checks confirmed manual pause and zero active work before the scoped cutover. The initial missing tables were resolved by the approved migrations. Final artifacts are `/tmp/parakkat-efficiency-final-runtime.json`, `/tmp/parakkat-efficiency-final-active-work.json`, `/tmp/parakkat-efficiency-loaded-image.json`, `/tmp/parakkat-efficiency-cutover-result.json` and `/tmp/parakkat-efficiency-source-verified.json`. The prepared build and scoped cutover helpers were executed only after source freeze, the migration confirmation and the final test gate. Library discovery remains queued, with no studies in flight.
