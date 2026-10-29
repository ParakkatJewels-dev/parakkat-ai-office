# Token efficiency — 27 October 2026

## Evidence

A read-only, paginated audit of usage and job metadata found that roughly 95% of recorded ChatGPT tokens were input context. Most of that usage preceded the 26 October efficiency release. The new reservation ledger had only two requests at audit time: one completed request with 2,695 measured tokens, and one failed request with unknown actual usage and an 11,808-token conservative reservation. The combined reservation amount is not a measurement of actual provider usage.

Both selected models were `gpt-5.6-sol`, already using low reasoning. Existing limits remain 40 calls / 200,000 tokens per rolling day and 200 calls / 1,000,000 tokens per rolling week, with 30,000 input characters and 2,400 output tokens per call. No model, credentials, budget settings or database schema changed.

## Changes

- Opportunity leads receive relevant facts plus explicit coverage and missing-data notes. Candidate citations must match the facts shown to that lead. The CMO still sees all facts when candidates need review; an empty validated candidate set completes without a CMO call. Candidate bodies are sent once, not repeated in turn metadata.
- Conversation prompts include brand guidance and saved lessons once. Personal work history is loaded only for questions about the agent's work. A specialist's final handoff is omitted from discussion only when it exactly duplicates the separately supplied assignment. Meetings and final synthesis retain their discussion.
- Missing sales, advertising or social data produces explicit unknown-data notes without writer/reviewer calls. Missing evidence never means zero activity or zero stock.
- Competitor extraction and impact assessment share one 1,200-output-token call per nonempty feed, replacing two calls. Empty feeds do not invoke a model. Findings are validated before saving.
- Ordinary report review allows one correction and a second review, reducing its maximum from five to three calls. A second revision request is rejected, never silently approved. Review verdicts use an 800-output-token ceiling. Campaign QA, artifact checks and human approval gates remain intact.
- Per-call output caps cannot exceed the saved or freshly reserved app limit and are part of cache identity. Reservations remain conservative until provider usage is known.
- Known token usage from failed, incomplete, invalid-JSON and invalid terminal responses is recorded and reconciled. Unknown usage retains conservative accounting; no automatic provider retries were added.

Existing exact-request caching, in-flight deduplication, campaign leases/backoff, bounded conversation delegation and four-hour opportunity cadence remain enabled. The campaign stage still lacks per-report durable checkpoints; a late stage failure can repeat earlier work, subject to existing cache and retry limits.

## Validation

Synthetic opportunity fixtures reduced combined serialized inputs by 22.6–24.2%; the two-lead example's coordinator input shrank 40.5%. These are fixture bytes, not measured production token savings. An empty-candidate example used two calls instead of three. Regression coverage exercises cap clamping/cache separation, failed-response accounting, preserved conversation context, missing-source skips, competitor call counts, and rejection after one correction.

The full local suite passed **682/682 tests**, with none skipped. Type checking, the optimized production build and whitespace checks passed. A delayed-writer regression verifies that no reviews start until all source writers finish successfully.

No live inference, customer message, campaign launch or product write is used for validation. Production savings need subsequent real workload observation. App budgets cannot guarantee an account allowance shared with other ChatGPT applications.

## Production verification

Release `token-efficiency-20261027-r1` became healthy on 27 October at 12:02:50 IST. All 19 final deployment gates passed; the scheduler completed a fresh tick with no application/scheduler errors, restarts or OOMs. The office stayed running. Hermes and all 22 unrelated containers, credentials, models, budgets, schedules and resource limits were unchanged. The dedicated builder was stopped after use.

- Image: `sha256:376c8d1f0685fb91e9608c604ba5535d2018745cee41a56c312df24d2bdf6202`
- Deployed source: 428 files; manifest `bdbcd0bf817d0a437d3e5431a342bb1ffd773c0bd19c0665c04c362b39b4a979`
- Rollback image: `parakkat-ai-office:before-token-efficiency-20261027-r1`
- Authenticated usage page reloaded successfully, with app guards enabled and no browser errors. The two-request ledger remained unchanged. Screenshot: `/tmp/parakkat-token-efficiency-live.png`.

This verification section was added to the local documentation after the deployed source was frozen.
