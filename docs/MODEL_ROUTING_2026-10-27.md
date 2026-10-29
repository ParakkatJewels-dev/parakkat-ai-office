# Model usage and quality gates — 27 October 2026

## Observed starting point

A read-only audit of `api_usage` for the preceding seven days found 67 ChatGPT attempts with 485,436 reported input tokens. Agent conversations accounted for 35 attempts and 370,619 input tokens (about 76% of the ChatGPT input in that period). Gemini recorded 326 calls, chiefly visual and library work; Jev recorded 12 classification calls. NIM had only connection tests, no business work. These provider figures are not interchangeable prices. ChatGPT plan usage is separate from AI Office's local text budget, and NIM pricing has not been entered.

## Workload policy

- ChatGPT retains planning, complex analysis, direct final answers, head review and independent QC. These calls do not silently downgrade when ChatGPT plan usage is exhausted.
- Verified NVIDIA NIM can prepare selected internal reports, revisions and head-task specialist outputs. Each selected path already has a ChatGPT head or QC stage. Direct agent conversations remain on ChatGPT. If ChatGPT is already usage-blocked, the draft does not start.
- Jev handles its existing bounded classification and head-task routing. It does not approve a deliverable.
- Gemini handles the existing image, visual-review and supporting source work. Its image allowance remains separate.
- A missing NIM verification uses ChatGPT for the draft. A failed NIM inference disables new NIM routing until a fresh explicit test; the failed call is not automatically retried with another paid model.
- When ChatGPT plan usage is blocked, these quality-gated workflows wait instead of substituting NIM for a required decision or review. This narrows the earlier general usage-limit fallback in response to the requirement that output quality take priority.

The policy is explicit in `model-routing.mjs` and named `useCase` values at call sites. Unnamed tasks stay on the previous ChatGPT path. Business approvals and the existing daily/weekly allowance still apply.

## How to evaluate savings without losing quality

Track input and output tokens by provider and task in Usage & billing. Compare completed tasks of the same type before and after routing, including revision count, QC rejects, time to human handoff and total provider calls. A draft plus review saves ChatGPT plan tokens only when the reviewer receives a concise draft and the source facts needed to check it. If both calls reread the full source package, total tokens can increase. Keep the workload on ChatGPT if QC rework rises or if the combined cost and latency are worse.

The first release is a bounded pilot. It does not claim a measured saving or quality parity before comparable production tasks have completed.
