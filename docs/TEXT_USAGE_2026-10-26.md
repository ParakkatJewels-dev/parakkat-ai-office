# Text usage controls — 26 October 2026

## Cause and scope

A read-only audit of the preceding 24 hours found 65 ChatGPT requests and 507,909 recorded tokens. Agent conversations accounted for 382,307 tokens (75%), mainly repeated input context. This is application telemetry, not a complete measure of the shared ChatGPT account allowance. Gemini library study is separate.

## Changes

- ChatGPT requests explicitly use low reasoning effort on the supported GPT-6 and GPT-5.6 families, retaining the account's selected model. The wrapper now forwards timeouts, cancellation and output caps.
- Conversations include relevant evidence, bounded history and relevant colleagues only. The current user message is not repeated in history. Saved agent instructions remain intact; recalled lessons are bounded. Stock unknowns, explicit zero, date coverage and truncated samples remain distinct.
- A representative serialized conversation fixture shrank from 78,266 to 13,944 bytes (82.2%). This excludes shared system instructions and is not measured production token savings.
- Ordinary conversations can delegate to one specialist (at most three calls); explicit meetings can use two (at most four calls). A direct answer can complete in one call.
- Opportunity reviews run every four hours during the existing working hours and skip unchanged evidence and guidance. A failed attempt retains a four-hour delay. Eligible exact automatic requests share in-flight work and a private 24-hour result cache. Customer conversations and manual chats are not cached.
- Campaign stages share a durable per-run lease, respect saved retry deadlines, and stop after three failed attempts. Budget waits do not consume or erase failure attempts. Explicit retries require the manager's action. Cancelled linked workflow tasks cannot start a later campaign stage.
- Automatic catalogue/ad schedules do not create a new batch while an earlier batch is unfinished or awaiting review.

## App budgets

| Control | Initial value |
| --- | ---: |
| Rolling 24-hour calls | 40 |
| Rolling 7-day calls | 200 |
| Rolling 24-hour tokens | 200,000 |
| Rolling 7-day tokens | 1,000,000 |
| Maximum input characters | 30,000 |
| Maximum output tokens | 2,400 |

Limits are enabled and can be edited under **Usage and billing → Text usage limits**, also available under **Automations → Recurring**. Limits start with the new reservation ledger, not historical telemetry. Atomic reservations protect concurrent requests. Known provider usage reconciles reservations; failed and unknown requests retain a conservative estimate. Queued workflows wait until their actual rolling-budget release time. Oversized inputs stop before inference. No paid API fallback was added to ChatGPT mode.

These controls apply to the common agent text path. Gemini images and library study have separate usage. App budgets cannot guarantee the remaining allowance of a ChatGPT account shared with other apps and chats. A low output cap can leave a response incomplete. The campaign lease expires after 15 minutes and has no renewal; stages exceeding that duration require a longer-lived execution design before relying on the same concurrency bound.

## Validation and deployment

- Final full suite: **432/432 passed**, with no skipped tests.
- TypeScript and whitespace checks passed.
- Production build, type validation and static generation passed on the dedicated 1 CPU / 2 GiB builder.
- Migrations 007–010 were applied as one approved transaction. The live budget RPC returns the values above; anonymous reads and execution are denied.
- New image manifest: `sha256:5c6ff4cb8fdaadffa6ff9957e9b191d40fc1c136b8551376b449d0b96ab30e3b`.
- The manual office pause is preserved. No live inference, customer message or Shopify product write was used for validation.
- Authenticated production UI: saved a temporary 39-call daily limit, restored 40, and verified the persisted values and success message. Created one clearly labelled test task while paused and cancelled it before execution. The task recorded both assignment and cancellation; no model reservation was consumed. Browser error logs were empty.
- Live verification caught a proxy-origin mismatch on the new POST endpoint. The final image accepts the trusted configured `APP_URL`, rejects missing/foreign origins and does not trust forwarded host headers. Its focused regression and typecheck passed; public checks distinguish wrong-origin 403 from correct-origin unauthenticated 401.
- Final runtime audit: app healthy, scheduler tick successful, builder stopped, no restarts/OOM, global pause preserved, and all 22 unrelated containers including Hermes retain their identities and start times. Both model selections remain `gpt-5.6-sol`.
- Original rollback retained as `parakkat-ai-office:before-business-efficiency-20261026`; the first release is additionally retained as `before-business-efficiency-20261026-r2`. No unrelated container, shared proxy, old Vercel deployment or credential volume was changed.
- Live proof: `/tmp/parakkat-text-usage-live.png` and `/tmp/parakkat-workflow-cancelled.png`.

The accompanying workflow release is described in [Business automation](BUSINESS_AUTOMATION_2026-10-26.md). Instagram messaging access and Shopify `write_products` remain provider setup requirements; the release does not claim either write capability is ready merely because its code is deployed.
