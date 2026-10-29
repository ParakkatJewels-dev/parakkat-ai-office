# Outcomes and quality review — 26 October 2026

**Deployed:** `outcomes-20261026-r3` at `https://ai-office.parakkatjewels.in`. This delivers the initial quality, records and read-only monitoring scope from the [team-expansion proposal](TEAM_EXPANSION_PROPOSAL_2026-10-26.md). The office is running again after maintenance.

## Delivered

- Three enabled agents: Output QC Reviewer (`outputQc`, QA), Funnel/CRO Specialist (`funnelCro`, Performance), and Experiment & Outcomes Analyst (`outcomesAnalyst`, Insights). Agent management shows all 70 enabled/manageable agents, including their saved instructions.
- Head tasks now pass from specialists through the responsible head and independent QC before human review. QC binds the exact deliverable, criteria, contributions and evidence; changes invalidate the check. One shared automatic correction round remains bounded, with at most eight calls for a two-specialist round including a QC-requested correction. QC-originated instructions identify QC as their author.
- The Outcomes board separates approval, implementation evidence and business outcome. It records owners, deadlines, review dates, measurement plans, evidence, experiment hypotheses and evaluations. Source approvals remain authoritative. Saving a plan or accepting a report does not execute an external action.
- External campaigns display **External campaign / Provider observation**, with explicit current-monitoring, inactive-inventory or unknown-coverage status. Recorded delivery is not a claim of delivery right now, profit or an internal approval.
- Recent-data benchmarks offer an explicit **Review suggested benchmark** draft. They never overwrite manual settings or save automatically. Matching recent attributed ROAS is descriptive, not a profitable target, promised lift or scaling authorization; sample and delivery-day thresholds are operational safeguards, not statistical confidence.
- Legacy pending approvals can explicitly request fresh quality review of existing assets. The authenticated RPC queues work without immediately advancing it, preserves earlier votes with their version, and requires new sign-off. Missing/stale checks block approval; negative decisions remain available. Verified human requests use the human-work allowance while retaining every global cap.

Attention now means **distinct visible initiatives with open incidents**. The tile and filter share one helper, ignore resolved/snoozed/unknown statuses and exclude IDs outside the bounded snapshot. All historical records remain available. The regression reproduces 201 historical + 15 current campaigns, 18 open incidents and an out-of-snapshot incident; both views return **15**.

## Controls and evidence limits

Recorded-data monitoring uses deterministic checks and zero model calls. A persisted five-minute cooldown applies during normal operation; saved changes and fresh imports can trigger an earlier check. Browser polling is read-only. The office pause still governs scheduled work.

Current text limits and model selections were preserved: **40 calls / 200,000 tokens per rolling day; 200 calls / 1,000,000 tokens per rolling week; 30,000 input characters and 2,400 output tokens per request**, with both ChatGPT tiers still `gpt-5.6-sol`. Text and vision providers share admission/accounting controls. When app limits are enabled, scheduled analysis can use at most half of each rolling allowance. Image limits are separately **6/day and 20/week**. These controls do not guarantee remaining quota on a ChatGPT account used elsewhere. All five optional recurring automation schedules remain disabled.

Unknown metrics, stock rows or incomplete imports remain unknown, not zero. Platform ROAS is not profit; Meta and Google attributed purchases are not combined as unique store orders. No ad budget, provider configuration or customer message was changed by this release’s verification.

## Validation and deployment

The final full suite passed **633/633 tests**, followed by successful typecheck, diff checks and the capped production build. The final attention correction also passed 20 focused API/client/helper tests. User-approved migrations [012](../supabase/migrations/20261026001200_outcome_monitoring.sql), [013](../supabase/migrations/20261026001300_provider_usage_guards.sql), [014](../supabase/migrations/20261026001400_quality_review.sql) and [015](../supabase/migrations/20261026001500_campaign_rereview.sql) succeeded in Supabase. Independent audits verified storage, roles, limits, version guards and denial of anonymous outcome reads/review requests.

| Release proof | Value |
| --- | --- |
| Live image | `sha256:41e1eab86c124f8923f0a3c2ef64d9f08e3df92bfe500f14abf467b2ede0e0eb` |
| OCI image config | `sha256:fb5c7d361aa9a84fc33b55f3b4ed3d1a3b726206bac5b4e454bbe20ace246615` |
| Source manifest | `29d5ba834666113929c403462c0b05bcba258250f7b914d1ead9b397f47e0430` — all 391 files matched |
| Archive | `/opt/parakkat-ai-office/outcomes-r3-image.tar` — 285,679,104 bytes; all 18 blobs verified |
| Immediate rollback | `parakkat-ai-office:before-outcomes-20261026-r3` — previous r2 image |
| Earlier rollback | r1 and r4 images remain retained under their existing tags |
| Deployment / resume proof | `/tmp/parakkat-outcomes-r3-final-verification.json`; `/tmp/parakkat-outcomes-r3-post-resume-verification.json` |

Only AI Office’s app and scheduler were replaced. Final checks confirmed healthy services, a completed scheduler tick after Resume, unchanged model/budget/schedule settings, protected credentials and reused volumes, unchanged resource caps/networks, and **all 22 other containers unchanged, including Hermes**. The dedicated one-CPU/2-GiB builder is stopped. No proxy or unrelated service was restarted. Resume was confirmed in the authenticated Admin UI at approximately **22:12 IST**; the final read-only audit passed all 16 checks at **22:13:34 IST**, including the completed **22:13:07 IST** scheduler tick.

## Live results

Read-only provider smoke checks passed for **26 September–25 October 2026**: one Meta account returned **1,342 ad-day rows / 177 campaigns**; one Google Ads account returned **60 ad-day rows / 39 campaigns**. The registry retains **216 campaigns**, and monitoring processed **236 records** without hitting a limit. No provider writes or model calls were made during these checks. Proof: `/tmp/ai-office-outcomes-provider-smoke.json`.

Lifecycle monitoring classifies **201 campaigns as inventory-only and 15 as current**. It resolved 201 obsolete measurement reminders while retaining their history. The remaining **18 open incidents affect 15 initiatives**. Proof: `/tmp/ai-office-outcomes-recorded-r2-smoke.json` and the final r3 browser check.

**No current campaign qualifies for a benchmark yet.** All 15 lack sufficient verified purchases across both windows; 13 also have unknown sales values/coverage, four lack enough delivery days and one has unsupported measurement coverage. Reasons overlap. Both providers still report purchase tracking as unverified; Google’s primary purchase-action definition is verified, but event delivery and deduplicated orders are not. Performance Max inventory is included while its metrics are outside the current ad-level path. Proof: `/tmp/ai-office-outcomes-benchmark-audit.json`.

Authenticated browser checks confirmed the new roles/instructions, campaign inventory and scope labels, benchmark blockers with their two windows, QA inbox and legacy fresh-review controls with stale positive approvals disabled. A note saved on the existing cancelled verification outcome advanced revision 2→3 while preserving Rejected / Cancelled / Closed states. No fresh campaign review was queued during the browser test. The final r3 browser check showed **Initiatives needing attention: 15** and **15 shown** under the Needs attention filter, with no historical rows in the filtered list. The production screenshot is saved as [outcomes-production-2026-10-26.png](outcomes-production-2026-10-26.png).

## Remaining business work

Agree targets, baselines, maturity/freshness windows and review dates; verify purchase-event delivery, transaction deduplication, costs and stock/fulfilment capacity. Complete compatible product-view/cart/checkout/purchase/return instrumentation before diagnosing funnel losses. Continue the read-only pilot across enough refreshes and conversion delay to evaluate its evidence. Live ad optimization, automatic budget changes and scaling remain outside this initial release and require their own concrete approved scope.
