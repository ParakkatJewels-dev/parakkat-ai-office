# Workflow efficiency and Jev — 27 October 2026

This release reduces repeat work and the evidence sent on each model turn. It preserves specialist execution, responsible-head review, independent QC and human approval. It changes no saved model, reasoning, budget, schedule or office pause settings.

## Behavior

- Narrow status/progress requests and supported recorded Shopify/advertising totals use code without a text-model request. Arbitrary saved response instructions, ambiguous prompts and meetings keep the existing AI path. Access checks use the requester's permissions; missing data remains unknown rather than zero.
- Head planning receives source availability and summaries. Each specialist receives evidence selected for its assignment; the head and QC retain all recorded source categories. Rows are ranked by task references before bounding, with sampling/omission notes retained. Workers can cite only supplied sources.
- Eligible single-specialist copy drafts, advertising reports and sales reports can use Jev for a bounded routing choice. Low-confidence/general decisions use the head planner. A completed choice is saved before the next provider admission, so a later ChatGPT budget refusal does not repeat Jev. Mixed/complex requests keep the original planner. A configured Jev failure does not silently fall back to another paid provider.
- Campaign stages save pending/completed substeps with current input and agent-guidance fingerprints. Completed work survives retries. Unknown provider completion requires an explicit retry. Existing artwork, creative rows and report IDs are reused; edited source facts or guidance cannot silently regenerate successful artwork. Planning and qualitative proposal generation share one call; scenario arithmetic remains code-based.
- Usage → By task separates known input/output tokens, unknown conservative estimates, provider attempts and reuse. Tracking begins with this release; images and non-AI connector calls remain in Call history. See [task metering details](TASK_USAGE_2026-10-27.md).

## Jev configuration

Admin → Connections → AI providers contains a masked Jev key field. Saving verifies model access through GET `/v1/models`, without inference. The separate Test action sends one small synthetic classification and can incur Jev charges. Keys are stored server-side in a private `jev.json` file within the existing provider-secret volume; the browser receives status only. No credits are purchased by setup.

## Release verification

Runtime regression tests cover retry reuse, pending-call recovery, scope revocation between providers, source coverage, mixed routing, current instructions, numeric validation, credential handling and task-metering privacy. Fixture results demonstrate zero model calls for supported deterministic queries, one fewer generative planning call for confident Jev templates, and no repeated completed campaign substeps. These are behavior checks, not a measured percentage reduction in production usage.

The additive `20261027000100_task_usage.sql` migration and defensive `20261027000200_task_usage_guard.sql` follow-up were applied transactionally in the authenticated AI Office Supabase SQL Editor. Both returned “Success. No rows returned.” Existing records and budget settings were not changed. Catalog checks verified RLS, read/write grants, fixed search path and the installed report body against the reviewed SQL. Anonymous table/RPC access was denied.

## Production result

Deployed `workflow-efficiency-jev-20261027-r1` at 14:37 IST on 27 October. All 771 tests, TypeScript and the production build passed. The final CSS-only compatibility adjustment (`align-items: flex-end`) was followed by clean local and remote builds. The frozen runtime contains 462 source files, manifest `d1f5fdaab2e6ed6b3fbda9c0db04640799cc76700a2a07125de1716810d03a95`; image `sha256:b1cb044c4cdfa90c10b8403cfd577f3aeab79e9bc669b9fa3c26191b9438d696`.

All 20 deployment gates passed: healthy app and scheduler, fresh heartbeat, HTTPS/auth behavior, unchanged resource limits/environment/models, preserved credentials and existing business settings, no active work at cutover, no restart/OOM/errors, and all 22 unrelated containers unchanged. The monthly billing budget changed externally from ₹500 to ₹1,000 between baseline captures; the release preserved the current ₹1,000 value without writing billing settings. The previous image remains available under `parakkat-ai-office:before-workflow-efficiency-jev-20261027-r1`.

The user's Jev key authenticated against `jev-latest`, was saved privately as UID/GID 1000 with mode 0600, and passed one budgeted synthetic classification through the live admin UI at 14:38 IST. The card displayed **Verified**. Temporary local credential copies and transfer servers were removed/stopped. The supplemental 7/7 audit confirmed only Jev health metadata changed during testing; its key/configuration and all existing credentials/settings stayed intact.

The authenticated **Usage → By task** screen loaded successfully. Tracking starts at this release, so an initially empty table is expected. The existing ChatGPT account still displayed **Usage paused** because of its plan allowance; no reset or resume was attempted. The efficiency changes do not reset the provider's usage quota.

Local proof artifacts: `/tmp/parakkat-workflow-efficiency-jev-r1-final-verification.json`, `/tmp/parakkat-workflow-efficiency-jev-r1-post-test-verification.json`, `/tmp/parakkat-jev-live-verified.png`, `/tmp/parakkat-task-usage-live.png`. This result section was added to the local documentation after the runtime snapshot was frozen.
