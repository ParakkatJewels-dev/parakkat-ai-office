# AI Office production readiness — 26 October 2026

> Vercel retirement update (29 October 2026): the old Vercel project was deleted at the user's explicit request; see the [verified retirement record](VERCEL_RETIREMENT_2026-10-29.md). This report's pause/unpause rollback instructions are historical and superseded. The VPS remains live.

The later same-day [working-status release](WORKING_STATUS_2026-10-26.md) records the newest image and audit. [Direct dialogue](DIRECT_DIALOGUE_2026-10-26.md) records private desk conversations, [design-library scanning](LIBRARY_SCAN_2026-10-26.md) records complete Drive discovery, [Agent management](AGENT_MANAGEMENT_2026-10-26.md) records scoped working instructions, and the [opportunity-review release](OPPORTUNITY_REVIEWS_2026-10-26.md) records the earlier lead-review rollout. This report preserves the initial VPS cutover evidence and integration limitations.

Evidence collected on **26 October 2026**; the pre-cutover VPS/schedule audit was at approximately 15:10–15:12 IST, the final app audit at **15:36:08 IST**, and scheduler isolation verification at **15:38:15 IST**. Integration checks and cutover updates were also supplied by the deployment owner. The new image is healthy, old schedules and production access are retired, the repaired Admin sync completed, and the VPS scheduler has completed authenticated ticks. Odoo's automatic continuation committed all 18 queued sales days by **15:39:29 IST**. Older history continues in bounded passes; future daily/weekly schedules await their natural run times. This report contains no credentials.

The application is available at **https://ai-office.parakkatjewels.in** and uses the existing Supabase project. Agent reasoning uses **ChatGPT OAuth**; image generation uses the user's separately configured **Gemini** key. Successful connector reads do not establish that every write, reconnect, historical sync, or scheduled operation works.

## Completion record

| Release check | Recorded result |
| --- | --- |
| Local validation reported by deployment owner | Latest `npm test`: **168/168 passed**; `npm run typecheck`: passed; dependency audit: **0 vulnerabilities**. The superseded 169-test total included the removed stock-cache test. |
| Independent publishing/artwork review | 17 focused tests passed; real PostgreSQL concurrency tests verified approval/redraw ordering and the `FOR SHARE` lock correction described below. |
| Final source revision | Deployed workspace snapshot, including pre-existing uncommitted work; identified by the immutable image below. No Git commit was created. A later removal of a blank line at the end of `odoo-core.mjs` made no semantic change; final diff check passed. |
| Final production build, tag, and immutable image digest | Build and production dependency pruning passed; audit found 0 vulnerabilities. Deployed tag `production-20261026` / `local`, OCI manifest **`sha256:7a797293e31f65e84c9efd9b73374f404457ea4febe9ff278ffbb787c684343d`**. Exported OCI config digest `2062fd5c83b94fa04caad83af1d201bdf0401a0d76ca082a19286c20a48c069b` is distinct from the deployed manifest. |
| Migration 004 — resumable Odoo sales | Applied successfully in the production migration transaction, confirmed by deployment owner. |
| Migration 005 — approved artwork freeze | Applied successfully in the same transaction; final file uses `FOR SHARE`. |
| Odoo sync with the deployed fix | Admin full-sync run completed; Odoo showed Connected with last sync **15:37 IST**, alongside connected Shopify, Meta, Instagram, and Google Ads. Stock result: 112,269 products, 4,487,274 pieces, 55 warehouses, and 26 Shopify stock updates. The initial pass committed no sales days and queued 18 days because its time budget was used by stock; the subsequent continuation completed that batch below. |
| Odoo automatic continuation saved results | **Passed.** Started **15:39:12.761 IST**, committed all **18 queued days** by **15:39:29.218 IST**, and released its lease. Oldest saved date advanced from 24 October to **9 October**; branch-day rows increased 14 → 72, product-day rows 679 → 6,860. Stock rows and timestamp were unchanged. `needs_continuation=true` retains older-history work; this 18-day batch is complete. |
| Old Vercel crons disabled | Confirmed: this project's cron setting is Disabled. |
| Supabase cron job 1 disabled | Confirmed: `parakkat-agents` job 1 has `active=false`. |
| Old Vercel production application paused and old URLs checked | Confirmed: project pause succeeded; both old alias and unique production URL return **503 `DEPLOYMENT_PAUSED`**. VPS `/login` returns 200. |
| VPS scheduler started; first successful authenticated tick | Started **15:37:27 IST**. At **15:38:15 IST**, read-only log counts showed two completed ticks, zero failed requests, and zero error-keyword matches. Deployment owner also verified the first completed tick. |
| Final app health, private volumes, stopped builder, and all 22 unrelated containers | Read-only audit passed: app healthy on the recorded image, resource limits intact, builder stopped, and all 22 unrelated container IDs/start times unchanged. Private volume permissions rechecked after deployment; details below. |
| First scheduled daily sync / weekly SEO after cutover | Awaiting their natural future run times; a manual test or successful minute tick is not evidence of those later scheduled runs. |

## Verified integrations and limits

All checks below concern this AI Office application and its existing connected accounts. No paid live advertising launch was performed.

| Integration | Verified evidence | Limits and remaining work |
| --- | --- | --- |
| Supabase | Authenticated server-side reads succeeded; all four saved connector credentials decrypted. Existing staff sign-in, database, and storage were retained. | The correct existing credential-encryption key must remain stable. Do not replace it with a redacted Vercel export value. |
| ChatGPT OAuth | Enabled and connected after AI Office redeploys; live reasoning completed with manager and worker both set to `gpt-6.1-sol`. No OpenAI API key is required for this deployment. | OAuth availability and account limits still apply. Preserve the private auth volume; do not run concurrent token refreshers from a source-machine copy. |
| Gemini / Studio | A full Studio request completed ChatGPT reasoning → Gemini image → AI review → private Supabase storage → frontend display. The resulting image was 1024 × 1024. The private bucket rejected the public object URL with HTTP 400. | Gemini uses its own key and project billing. This proves one complete image flow, not every image size/model or future quota availability. |
| Shopify | Read-only GraphQL returned HTTP 200 with two sample products and two sample orders. App credentials are present; the VPS callback version is published and active. | Token refresh and a full OAuth reconnect were not forced. No store writes were tested. |
| Meta Ads | The single selected ad account returned HTTP 200, with five sample ad rows and further pages available. App credentials and the approved VPS callback are configured. | No ad creation, activation, spend, or provider-side duplicate test was performed. No Meta Pixel is configured; the existing publisher uses a traffic objective. |
| Instagram | Media query returned HTTP 200 with two posts; insights returned HTTP 200 with three metrics. | These are sample read checks, not exhaustive account history. |
| Google OAuth / Ads | Existing refresh-token exchange returned HTTP 200. The single selected Ads account returned HTTP 200 with five sample ad rows. The new callback is configured and the old callback retained. | A full consent/reconnect flow was not forced. Google campaign publication remains manual. |
| GA4 | Selected property report returned HTTP 200 with 14 channel rows. | No GA4 configuration changes were made. |
| Google Drive | Folder list returned HTTP 200 with 20 folders; both configured library roots were readable, returning 37 children combined. | Drive import provides design references, not a finished-artwork import workflow. |
| Google Trends / SEO | Public Trends returned HTTP 200 with 93 data points. A live SEO run saved 14 terms and reports despite Keyword Planner being unavailable. | SerpApi is absent. Public Trends can rate-limit or change its responses. |
| Keyword Planner | The endpoint returned HTTP 403, `DEVELOPER_TOKEN_NOT_APPROVED`, explicitly stating that the method is unavailable with Explorer access. | **Not working at the current access level.** Request Basic or Standard access for the OAuth client's Google Cloud project; Basic access requires brand verification. SEO currently continues with Trends. See [Google's access-level instructions](https://developers.google.com/google-ads/api/docs/api-policy/access-levels#how-to-apply-for-basic-access). |
| Odoo 14 | Version/authentication and warehouse, product, stock, `sale.order`, and `sale.order.line` reads returned HTTP 200. The repaired Admin sync completed at 15:37 IST; its automatic continuation committed all 18 queued sales days by 15:39:29 IST without rereading stock. | `pos.config` and `report.pos.order` are absent on this instance, so coverage is **sales orders only, not POS**. Saved history now reaches 9 October; older history continues in bounded passes. |
| JEV / TypeSafe | No key exists in the inspected account dashboard; none was created. | Optional scoring/classification uses the configured ChatGPT worker fallback. JEV itself is not connected or tested. |
| Triple Whale | No configured integration was found. | Unconfigured and unimplemented; do not present it as a working connector. |

The first Admin full-sync check passed the other four sync providers but timed out in Odoo sales after reading 244,887 stock rows. The repaired production run subsequently completed its stock work and showed Odoo Connected at 15:37 IST. It queued 18 sales days because the stock pass consumed the available time budget; the automatic sales-only continuation then committed that entire batch. Keep the distinction between a completed batch and complete historical backfill: older history remains queued, as recorded above.

Studio evidence: draft `b3853c73-0c19-47bf-a71b-3e809a95b6a2`; local screenshot `/tmp/ai-office-production-studio-test.png`. The screenshot is a temporary local artifact, not a durable backup.

After deployment, a live meeting completed at **15:36 IST** with CMO, Forecaster, and Product Picker handoffs, discussion, and final summary. It used actual 20–26 October sales quantities (sample products 6/3/3; 179 units across 144 products), distinguished unknown values from zero, and stated UTC/partial-day limits. Reopening the meeting preserved the summary table correctly. Evidence: `/tmp/ai-office-production-meeting-live.png` and `/tmp/ai-office-production-meeting-summary.png`. The post-deployment access smoke check returned login 200, protected-page redirects 307, and unauthenticated API responses 401.

## Publishing and artwork protections

The reviewed publisher atomically claims an approved campaign before contacting Meta. Concurrent publication requests have one claim winner. It records complete provider campaign, ad-set, and ad IDs before marking a campaign live, and can finish a failed local status update from the saved IDs without creating another ad. A legacy `published`/`live` flag without those IDs is not treated as proof of publication.

An ambiguous provider failure or failed provider-ID checkpoint requires review; it does not automatically retry the external launch. Google-only, mixed Google/Meta, and unsupported-channel plans are blocked before any Meta side effect. Google plans can be approved for manual launch, but this app does not publish them automatically. These behaviors were tested with local fakes, **not a paid live launch**.

Migration `20261026000500_campaign_artwork_freeze.sql` freezes creative content for `approved`, `publishing`, `publish_review`, and `live` campaigns. It blocks final approval while artwork is queued or being made, and requires an image for a Meta-only approval. Cancellation/error housekeeping remains possible; normal publishing/review completion updates remain compatible. It creates guards without rewriting existing rows.

Independent real PostgreSQL tests reproduced a bulk-creative-delete/concurrent-draw deadlock with the initial `FOR UPDATE` parent lock. The final migration uses `FOR SHARE`, which removed that reproduced deadlock while still conflicting with campaign status updates. Both ordering tests passed: a redraw committed first prevents final approval; approval committed first prevents a new redraw. The UI and server action also prevent redesign after approval.

The old Vercel publisher predates these protections. Disabling its schedules alone would not retire its reachable publishing actions. Its project-specific production pause is now confirmed, and both the old alias and unique production URL return 503 `DEPLOYMENT_PAUSED`.

## Odoo repair behavior

The deployed repair divides sales reads into bounded days and resumes from saved pending days. Migration `20261026000400_odoo_resumable_sync.sql` adds a service-role-only function that replaces a fully read day's rows and advances its checkpoint in one transaction. Failed reads and failed commits preserve the last good totals and cursor; a legitimately completed zero-sales day can replace old totals.

Only a genuinely absent optional model is skipped. Authentication, permission, and transport errors remain errors. The code reports sales-order/POS coverage explicitly and schedules sales-only continuations at least two minutes apart under the common sync lease. A continuation does not read stock. The proposed stock-cache shortcut was removed after review because matching timestamps do not prove that an initial stock copy is complete. The connector reviewer's final focused suite passed **15/15**, and typecheck passed. Live verification confirmed both the repaired Admin sync and its complete 18-day automatic continuation; unchanged stock rows/timestamp and the released lease verified sales-only progress.

## VPS isolation and access evidence

The pre-cutover read-only audit at approximately **15:10–15:12 IST** found:

- All **22 pre-existing containers**, including Hermes, retained their baseline container IDs and start times. Baseline: `/tmp/parakkat-before-agent-update.json` on the audit machine. The AI Office service was the only business application allowed to be recreated.
- AI Office healthy on its dedicated Compose project, with no published host ports, one CPU, 1.5 GiB RAM, and a 192-process limit. Routing uses only new AI Office labels on the existing Traefik Docker provider.
- The dedicated builder was stopped when not building. Its limit is one CPU (`CpuPeriod=100000`, `CpuQuota=100000`) and 2 GiB RAM. `NanoCpus=0` alone does not mean this builder is uncapped.
- ChatGPT and provider-secret directories were mode `0700`, UID/GID 1000; the Gemini key file was mode `0600`. `/opt/parakkat-ai-office/runtime.env` was mode `0600`. No secret values were printed in the audit.
- Valid TLS 1.3 for the new domain; certificate expiry observed as 24 January 2027. `/login` returned 200, unauthenticated `/admin` redirected to sign-in, and an unauthenticated agent-tick request returned 401.
- The prior 60 minutes of application logs contained six lines and no detected errors. The root filesystem was 85% used, with approximately 60 GB free. This is a point-in-time capacity observation; no broad Docker cleanup was performed.

Deployment paths: `/opt/parakkat-ai-office/source` and `/opt/parakkat-ai-office/runtime.env`. App container: `parakkat-ai-office-parakkat-ai-office-1`. Persistent volumes: `parakkat-ai-office_chatgpt-auth` and `parakkat-ai-office_provider-secrets`.

The final read-only audit at **15:36:08 IST** verified the healthy app's image against the OCI descriptor and both `production-20261026` and `local` tags. It retained one CPU, 1.5 GiB RAM, 192 PIDs, and no host ports. The dedicated builder was exited with one CPU/2 GiB limits. All 22 unrelated containers, including Hermes, exactly matched their baseline IDs and start times. The new app's available logs in a 30-minute query contained five nonempty lines, with zero error/fatal/exception/panic/unhandled or warning keyword matches; this covers only the new container's short lifetime. The ChatGPT/provider-secret directories remain `0700`, UID/GID 1000, and `gemini.json` remains `0600`. Sanitized local audit evidence: `/tmp/parakkat-production-final-readonly-audit.json`.

The previous image is preserved under `before-production-20261026` and `forecast-20261026`, resolving to `sha256:994fe5feddb56a83fbb38179169b174583416c7d3dbd787a47fe8bd1ba22910e`. This retained rollback artifact is **not approval to restore its older publishing behavior**; keep work paused and apply the rollback safeguards below before using it.

## Scheduler ownership and cutover

Before cutover, the VPS scheduler was disabled. The existing schedules were actually running against Vercel; a running app on the VPS did not move those jobs automatically.

| Owner at the pre-cutover audit | Schedule and observed target |
| --- | --- |
| Vercel project `parakkat-ai-office` | `/api/sync` at `30 0 * * *` UTC (06:00 IST daily); `/api/seo` at `30 1 * * 1` UTC (07:00 IST Monday). Cron configuration was enabled. |
| Supabase cron job 1, `parakkat-agents` | `* * * * *`, active, targeting `https://parakkat-ai-office.vercel.app`. Recent runs succeeded each minute; Vercel request logs showed tick HTTP 200 responses through approximately 15:12 IST. |
| New VPS scheduler | Not started at that audit. Its configuration calls only `http://parakkat-ai-office:3000`, with fixed tick/sync/SEO routes and redirects rejected. It has no proxy labels or host ports and joins only the AI Office internal network. |

The VPS schedule is a minute tick, daily sync at 06:00 IST, and Monday SEO at 07:00 IST. One scheduler instance suppresses overlapping invocations of the same job. Keep a single active schedule owner.

**Cutover verified:** old Vercel crons are disabled, Supabase job 1 is inactive, and old production URLs are paused. The new scheduler started at **15:37:27 IST** on the same production image as the app. At **15:38:15 IST**, it was running with **0.25 CPU, 128 MiB RAM, 64 PIDs**, `unless-stopped`, and `no-new-privileges`. It had no host ports or mounted volumes and joined only `parakkat-ai-office_office`. Its verified non-secret job origin was `http://parakkat-ai-office:3000`; the cron credential was present without revealing its value. Logs showed two successful ticks and no failed requests/errors. The next daily sync and Monday SEO still require observations at their scheduled times.

Cutover order: validate the final image and migrations; disable only this Vercel project's crons and Supabase job 1; drain existing AI Office work; pause the old production application and verify its URLs; start only the new scheduler; verify a successful authenticated tick, saved job results, app health, and unrelated-container continuity. Record actual timestamps/results above rather than assuming these steps occurred.

From `/opt/parakkat-ai-office/source`, the prepared start command is:

```bash
docker compose --env-file /opt/parakkat-ai-office/runtime.env \
  -f deploy/compose.dokploy.yml -f deploy/compose.traefik.yml \
  --profile scheduled up -d --no-build --no-deps scheduler
```

Status is visible in Admin's job results and the scoped service commands:

```bash
docker compose --env-file /opt/parakkat-ai-office/runtime.env \
  -f deploy/compose.dokploy.yml -f deploy/compose.traefik.yml \
  --profile scheduled ps scheduler
docker compose --env-file /opt/parakkat-ai-office/runtime.env \
  -f deploy/compose.dokploy.yml -f deploy/compose.traefik.yml \
  --profile scheduled logs --tail 30 scheduler
```

## Safe rollback

1. **Stop only the AI Office scheduler first.** Keep the old Vercel and Supabase schedules disabled while investigating. Do not start both scheduler owners.

   ```bash
   docker compose --env-file /opt/parakkat-ai-office/runtime.env \
     -f deploy/compose.dokploy.yml -f deploy/compose.traefik.yml \
     --profile scheduled stop scheduler
   ```

2. Pause new AI Office work through its own controls and let in-flight work settle. Preserve publication checkpoints and `publish_review` records. An uncertain provider result requires reconciliation against Meta; never clear its state merely to make a retry button work.
3. Redeploy only `parakkat-ai-office`, using a recorded compatible image and `--no-build --no-deps`. Preserve both named volumes and the current runtime environment. Do not use `down -v`, remove volumes, rotate the credential-encryption key, restart the shared proxy, or touch Hermes or other applications.
4. Keep migrations 004/005 in place during an app rollback unless a separately reviewed migration rollback is necessary. The artwork guard protects against older callers too. Do not delete business data or reset Odoo cursors to hide an error.
5. If access must temporarily return to Vercel, restore only this project's access after reviewing its older publishing behavior. Keep automation disabled until exactly one compatible schedule owner has been chosen. A project unpause does not itself justify reenabling the old jobs.
6. Recheck sign-in, data access, ChatGPT/Gemini connection status, container health, and provider-safe reads before resuming work. Recompare the 22 unrelated containers to the baseline.

Vercel project scope: `prj_kn6NZnww92DNxApOqYwDoLyL57gm`, team `team_S8OrkT9Yk97mKBe70rcNID0f`. Its reversible pause/unpause preserves the project, deployments, and environment settings; do not delete the project. The prepared rollback API command, if the deployment owner chooses it, is:

```bash
vercel api '/v1/projects/prj_kn6NZnww92DNxApOqYwDoLyL57gm/unpause?teamId=team_S8OrkT9Yk97mKBe70rcNID0f' --method POST
```

The documented pause applies to the active production deployment. Verify both the old production alias and unique production URL; do not assume it blocks every historical preview. Keep other deployments protected and do not re-enable a reachable old publisher as part of a routine rollback. Vercel cron rollback is the **Enable Cron Jobs** control for this project only; Supabase rollback is reactivating only job 1 after verifying its target. Neither should run while the VPS scheduler is active.

See [SELF_HOST.md](SELF_HOST.md) for setup, credential persistence, and callback details. No production mutation was performed to write this report.
