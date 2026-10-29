# AI Office: lower-usage, quality-gated model workflow

## Starting point

The seven-day `api_usage` audit recorded 67 ChatGPT attempts and 485,436 input tokens. Agent conversations contributed 35 attempts and 370,619 input tokens (76% of ChatGPT input). Roughly 95% of recorded ChatGPT tokens were input context. These are historical measurements, mostly before the 26 October context-reduction release; they are a baseline, not a claim about current production savings. The current conversation flow can make a head planning call, a specialist call, and a head synthesis call for one delegated request. Those calls currently all use ChatGPT. Jev classifies bounded choices, NIM is selected only for named reviewed work when its connection is verified, and Gemini handles image/vision and selected supporting work. NIM had only connection tests in the audited period.

The ChatGPT OAuth connection draws on the account's shared Work/Codex plan allowance. An app's weekly cap is a limit on that same allowance, not a second token pool. Passing requests through a ChatGPT conversation or reconnecting does not create more allowance. See [OpenAI's app-usage guidance](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites).

## Request path

```text
Manager message / scheduled trigger
  → deterministic command and no-change checks
  → small Jev intent/urgency/owner classification, only if rules are insufficient
  → fetch only required read-only connector data; stamp source, time and coverage
  → save one task evidence snapshot and its source-version fingerprint
  → task-specific worker (NIM, Gemini, or ChatGPT)
  → deterministic fact/schema checks
  → ChatGPT head/QC review when the task is consequential or a worker draft needs approval
  → human approval for publishing, spending, sending or changing business records
  → saved result, checkpoint and usage/quality record
```

ChatGPT chat may be a user interface to this task API. It must not be used as a second background conversation loop. AI Office owns task state and source access; provider calls receive a small, explicit task packet rather than the entire thread.

## Provider policy

| Work | First choice | Quality gate |
| --- | --- | --- |
| Status, counts, known metrics, unchanged source | Database/code, no model | Source timestamp and coverage shown |
| Intent, urgency, task owner, bounded policy category | Rules; Jev for ambiguous cases | Exact allowed labels; low confidence goes to head |
| Internal draft, extraction, formatting, routine specialist work | Verified NIM | Schema, citations and numeric checks; ChatGPT reviews consequential handoffs |
| Image generation, visual reference interpretation, product-photo check | Gemini | Verify product identity, image source and visual result; human reviews publishable creative |
| New strategy, uncertain evidence, financial/product claims, head decision, final QC | ChatGPT | Independent evidence check and human approval where required |

This is **use-case routing**, not a fixed primary/fallback chain. A provider failure does not silently trigger another paid call. The saved task records the failure and can resume after an explicit retry. If ChatGPT is unavailable, work requiring its review waits; a NIM draft alone is not presented as approved.

## Conversation design

1. **One evidence packet per task.** Select connector queries before fetching. Store source IDs, observed time, scope, row count, truncation and missing-data notes. Reuse the same snapshot across specialist and head calls. Never convert missing stock or missing sales rows to zero.
2. **Compact state, not repeated prose.** A follow-up gets the current request, verified decisions, unresolved questions and at most a few relevant source excerpts. Archive the full transcript for the UI, but do not send it to every model. Replace old conversational history with a checked state memo after a bounded number of turns.
3. **Avoid a planning call when routing is clear.** A deterministic path answers simple reads. A small Jev classification selects the specialist for ambiguous requests. One-on-one delegation normally becomes one specialist draft and one ChatGPT head final review. A direct complex question remains one ChatGPT call. A real meeting is used only when explicitly requested or when two specialties must resolve a genuine conflict.
4. **Give each model only its job.** The specialist receives relevant facts and a compact assignment. The head receives the draft, claim-to-source map, exceptions and concise evidence needed to verify it. The head can request one focused missing source; it does not reread the entire original payload by default.
5. **Complete outputs in place.** Save each contribution and final answer with task ID, evidence fingerprint, instructions version and provider/model. An identical request against unchanged evidence returns the saved result. A changed source invalidates only affected stages.

## Automation and usage controls

- Trigger monitoring on connector watermarks or meaningful metric changes. On an unchanged snapshot, record "checked; no change" without an LLM call. Time-based watchdogs can verify connector health without asking agents to repeatedly reason about the same data.
- Add durable checkpoints to every report/campaign stage, not only the campaign's existing checkpoints. Use idempotency keys, leases and bounded backoff so a late failure resumes at the failed stage. Do not regenerate completed drafts or images.
- Set per-task call and token ceilings by task class. Reserve a share of the internal weekly allowance for urgent manager requests and required QC; queue nonurgent automation as the reserve is approached. Display the ChatGPT app usage cap separately because its units are not interchangeable with the app's token ledger.
- Keep full source data in storage, not in prompts. Include only ranked evidence rows and retrieve more on a specific follow-up. Budget with actual token counts when available; character caps alone are approximate.
- Track calls, input/output tokens, reused work, QC rejection, human corrections, latency and completed-task rate by task and provider. Unknown token reservations must stay separate from measured usage.

## Quality and rollout gates

First, measure a fresh seven-day baseline after the 26 October release using comparable completed tasks. Then implement evidence selection and compact task state before moving more work to other providers. Verify NIM with a real synthetic connection test before routing business work. Pilot bounded internal tasks and compare their outputs against approved examples; include cases with missing stock, overlapping sales sources, stale ads and unsupported claims. Expand only when factual error and rework rates do not rise. Do not assume a cheaper draft plus an expensive review saves tokens: the review must receive a smaller packet than the original source.

A useful first target is to halve the **average ChatGPT input per agent conversation** from the historical ~10,600 tokens toward ~5,300 while keeping QC outcomes at least as good. If the same 35 conversations occurred, that alone would save about 185,000 ChatGPT input tokens, or 38% of that historical seven-day ChatGPT input total. This is arithmetic on the old workload, not a forecast or guarantee. Measure the actual result after rollout, including extra Jev/NIM/Gemini calls and their costs.

## Implementation order

1. Instrument fresh per-stage conversation usage, quality and source fingerprints.
2. Select connector evidence before fetching; save one scoped snapshot per task.
3. Replace routine ChatGPT planning calls with deterministic routing or compact Jev classification.
4. Send verified NIM bounded specialist work; keep ChatGPT final review on consequential outputs.
5. Add conversation state memos, checkpoint reuse and change-driven automation.
6. Compare completed-task quality and total provider usage; adjust routing by measured failure modes.

No model, key, allowance, schedule or provider configuration is changed by this plan.
