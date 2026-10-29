# Multi-provider workflow release — 27 October 2026

## Shipped

- Conversations read only the business sources selected for the request, then share one scoped evidence snapshot across their model stages. Missing or sampled data stays labelled as such.
- Clear requests skip the head planning call. Ambiguous head requests use verified Jev to select from permitted agents; uncertain classifications stay with the head. A failed Jev call does not trigger a second paid planning call.
- A bounded one-to-one specialist contribution can use verified NVIDIA NIM when a ChatGPT head review is available. The final answer and consequential decisions remain with ChatGPT. Meetings retain their existing quality path.
- Consecutive identical direct questions reuse the saved answer for five minutes only when instructions and scoped evidence have the same fingerprint. Refresh requests always run again.
- Conversation usage records now distinguish route, plan, specialist, final and reused-answer stages. The AI provider and usage pages explain the routing.
- Existing campaign checkpoints, opportunity no-change checks, text budgets and approval controls remain active. No database migration, credential change, model change or schedule change was needed for this release.

## Verification and deployment

- Local suite: 790 tests passed; type check and production build passed.
- Release source: 503 files, SHA-256 manifest `e773bdfbf7e2c47ef64e5dd0346f3d6b55a382b59268f622bea34bc14d26d38b`.
- VPS image: `sha256:2e7e82a19d27a6ed24c918fec04861fbb2b83d2de909f8cc044f2a5167453101`, built with the capped AI Office builder and deployed only to the AI Office app and scheduler.
- Post-deploy: app healthy, scheduler running and ticking, HTTPS `/login` returned 200, AI providers page displayed the new routing, runtime environment unchanged, and the other VPS containers unchanged.
- Rollback image tag: `parakkat-ai-office:before-multi-provider-20261027-r1`. The previous AI Office source is backed up at `/opt/parakkat-ai-office/source-before-multi-provider-r1`.

## Measuring the result

The seven-day historical audit counted 35 conversation attempts and 370,619 ChatGPT input tokens. It includes work before the previous context reduction and cannot be used as a post-release result. Compare a fresh period of completed conversations in Usage & billing → Tasks, especially ChatGPT input per completed conversation, total calls by provider, quality rework, and failures. The release avoids predictable extra calls, but the actual savings and quality must be measured on comparable tasks; no new billable production prompt was sent during deployment.
