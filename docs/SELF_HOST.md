# Self-hosting Parakkat AI Office with ChatGPT OAuth

> Vercel retirement update (29 October 2026): the user explicitly requested deletion of the old Vercel project, and deletion is verified in the [retirement record](VERCEL_RETIREMENT_2026-10-29.md). References below to retaining or unpausing that project for rollback are historical and superseded. The VPS remains live.

> Current artwork workflow (28 October 2026): [ChatGPT generation and Studio import](CHATGPT_ARTWORK_2026-10-28.md). The Gemini setup notes below describe the earlier deployment; native ChatGPT handoff is now the default.

This setup runs the Next.js application on your VPS and keeps the existing Supabase database, staff accounts, storage, and access rules. ChatGPT supplies agent reasoning through OAuth; Gemini supplies images through the user's private key. The [26 October production-readiness report](PRODUCTION_READINESS_2026-10-26.md) records live integration checks, limitations, release validation, schedule ownership, and rollback steps. The final VPS image is healthy, the repaired Admin sync completed, and the new isolated scheduler has completed authenticated ticks and an 18-day Odoo sales continuation. The old Vercel production application is paused and its Vercel/Supabase schedules are disabled. Older Odoo history continues filling in through the scheduler.

The latest [working-status release](WORKING_STATUS_2026-10-26.md) adds persistent overhead labels and occupancy counts based on actual current work, and records the current `working-status-20261026` image and audit. The [direct-dialogue release](DIRECT_DIALOGUE_2026-10-26.md) adds one-to-one desk visits and private dialogue boxes while preserving explicit meetings. The [design-library scan release](LIBRARY_SCAN_2026-10-26.md) records complete Drive discovery and resumable study. [Agent management](AGENT_MANAGEMENT_2026-10-26.md) adds department-scoped, versioned working instructions. The earlier [opportunity-review release](OPPORTUNITY_REVIEWS_2026-10-26.md) records hourly lead/CMO reviews and the scheduler healthcheck correction.

The intended address is **https://ai-office.parakkatjewels.in**. The VPS already runs Dokploy/Traefik and other business applications. Create a new, isolated AI Office deployment. Do not change Hermes or any other app, container, credentials, files, networks, or settings. Do not install another proxy on ports 80/443, restart the shared proxy, or bind a new service to Dokploy's port 3000.

The supplied Compose deployment publishes **no host ports**. It caps the application at one CPU and 1.5 GiB RAM and its scheduler at 0.25 CPU and 128 MiB. Keep a single active scheduler owner. Build off the VPS or use only the dedicated, capped AI Office builder described below.

## Installed deployment (26 October 2026)

**Live connector reads, the complete Gemini Studio flow, the repaired Admin sync, and its 18-day Odoo continuation passed. The VPS scheduler is running; Keyword Planner requires higher Google access, and Google publishing remains manual.** See the [readiness completion record](PRODUCTION_READINESS_2026-10-26.md#completion-record) for the final image, applied migrations, Odoo coverage, and scheduler evidence. Vercel's old production access is paused; preserve its project and environment settings for rollback rather than deleting them. The initial Vercel export returned redacted placeholders for 15 sensitive variables; the copied service-role placeholder failed with `401 Invalid API key`. The existing legacy Supabase service-role key was then recovered from the authenticated project dashboard and verified to decrypt all four saved connector credentials. That real key is now in the new AI Office runtime environment and protected local `.env.vps.local`; all masked placeholder values were removed. The Google OAuth client credentials, Meta app credentials, and an existing Gemini key have also been applied to AI Office's isolated runtime environment. Only the new AI Office container was recreated for these updates, preserving its ChatGPT credential volume.

Live checks from the VPS established the following limited results:

| Connection | Verified result and remaining work |
| --- | --- |
| Supabase | Authenticated server-side select succeeded; all four saved credentials decrypt. |
| Shopify | Product and order sample reads returned HTTP 200. The original app credentials configure the token-refresh path; a refresh or full reconnect was not forced. The VPS callback version is published and active. |
| Meta / Instagram | The single selected ad account returned HTTP 200 with five sample ad rows. Instagram returned two posts and three insight metrics. App credentials and the validated VPS callback are configured. No paid live ad launch was tested; no Meta Pixel is configured. |
| Odoo | Odoo 14 authentication, stock, and sales-order model reads returned HTTP 200. Admin's repaired sync completed at 15:37 IST; its sales-only continuation committed all 18 queued days by 15:39:29 IST, reaching 9 October without rereading stock. Older history continues in bounded passes. This instance lacks POS models, so coverage is sales orders only. |
| Google | Refresh exchange, selected Ads account, GA4, and both Drive library roots returned HTTP 200. The new callback is saved and the old one retained. Keyword Planner returned 403 because Explorer access is insufficient; Basic/Standard access is required. Google campaign publishing remains manual. |
| Trends / SEO | Public Trends returned 93 points; a live SEO run saved 14 terms and reports while Keyword Planner was unavailable. SerpApi is absent. |
| Gemini | The user saved a working key through Admin → Connections. A complete ChatGPT → Gemini → AI review → private storage → frontend Studio test produced a 1024 × 1024 image; the public object URL was rejected. The override is in AI Office’s private volume (directory 0700, file 0600). The older environment key remains a fallback but had zero free-tier image quota. |
| JEV / TypeSafe | `JEV_API_KEY` is missing. The signed-in TypeSafe dashboard for `digitalparakkat` / Parakkat Org showed no API keys, and no new key was created. With this key absent, the existing scoring/classification code uses the configured ChatGPT worker fallback. |

These checks do not establish that every connector operation or scheduled task works. The user chose **Gemini for images** and supplied a working key through the Super Admin form. ChatGPT OAuth remains the reasoning provider; no OpenAI API key is required. Gemini API charges follow the supplied key’s project billing. Triple Whale is unconfigured and unimplemented. Follow the readiness report's completion record before changing schedule ownership or restoring old Vercel access.

OpenAI's current [ChatGPT plan OAuth preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) explicitly exclude image generation, so AI Office cannot switch its automated image generation to the existing OAuth connection. The current Studio UI also has no finished-artwork upload/import action; using manually created ChatGPT artwork inside its gallery would require adding that workflow. Drive folder import currently supplies style references, not finished campaign or Studio artwork.

Shopify version `ai-office-vps-callback` is published and active (`1181471703041`). It adds `https://ai-office.parakkatjewels.in/api/connect/shopify/callback` while retaining the old Vercel callback, app URL, and scopes. Google uses a second secret created for its existing OAuth client with explicit user approval; the original secret remains enabled and was never disabled or deleted. The new Google callback was saved with the old one retained. The Meta callback addition was saved with approval and passed its validator. The old Vercel project's crons are now disabled, and Supabase cron job 1 (`parakkat-agents`) is inactive. Vercel production is paused; both its old alias and unique production URL return 503 `DEPLOYMENT_PAUSED`. Its project and environment settings remain available for controlled rollback.

- HTTPS: `https://ai-office.parakkatjewels.in`
- Project files: `/opt/parakkat-ai-office/source`; protected environment: `/opt/parakkat-ai-office/runtime.env`.
- Compose project: `parakkat-ai-office`; service: `parakkat-ai-office`; container: `parakkat-ai-office-parakkat-ai-office-1`.
- Runtime volume: `parakkat-ai-office_chatgpt-auth`, owned by the container's `node` user. Keep it across redeploys.
- The updated Compose definition adds the separate `parakkat-ai-office_provider-secrets` volume at `/var/lib/parakkat-ai-office/provider-secrets`, selected by `GEMINI_CONFIG_DIR`. The directory is mode `700`, owned by `node` (UID 1000); the key file is mode `600`. Keep this volume across redeploys too.
- Routing uses the additional `deploy/compose.traefik.yml` file and the existing proxy's Docker provider; no shared proxy files or services were changed.
- `LLM_PROVIDER=chatgpt`, OAuth enabled, no OpenAI API key in this deployment. Manager and worker models: `gpt-6.1-sol`, verified with a completed live request. The ChatGPT connection remains healthy after the connector environment updates.
- The new scheduler profile is **enabled**. It started at 15:37:27 IST and completed two authenticated ticks by the 15:38:15 IST audit. It uses only AI Office's private network, with 0.25 CPU/128 MiB/64 PID limits and no host ports. Old AI Office Vercel/Supabase schedules are disabled.
- The VPS has a newly generated, dedicated `CRON_SECRET`. The old Vercel environment and Supabase cron authentication remain unchanged.
- The existing Supabase staff-auth callback remains allowed; the exact new callback was added with approval.
- All 22 pre-existing containers, including Hermes, retained their IDs and start times in the latest read-only audit at 17:11:24 IST. The application is healthy on `working-status-20261026`; the exact immutable manifest is recorded in the working-status report. The scheduler completed two authenticated ticks after this release, and the dedicated builder is stopped.

Only a new builder named `parakkat-ai-office-builder` was used for this deployment, capped at one CPU and 2 GiB RAM, with Next.js build workers limited to one. The builder was stopped after the image loaded. No broad Docker prune, restart, or cleanup was performed.

To manage this deployment, run from `/opt/parakkat-ai-office/source` and always include both Compose files:

```bash
docker compose --env-file /opt/parakkat-ai-office/runtime.env \
  -f deploy/compose.dokploy.yml -f deploy/compose.traefik.yml ps
docker compose --env-file /opt/parakkat-ai-office/runtime.env \
  -f deploy/compose.dokploy.yml -f deploy/compose.traefik.yml \
  exec parakkat-ai-office node scripts/chatgpt.mjs status
```

`PARAKKAT_ENV_FILE` is cleared inside the app container because its runtime environment is already injected; the host's environment-file path is not mounted inside it. Source-machine tokens were cleared after successful transfer without revoking the VPS session, so only the VPS refreshes it.

## 1. Prepare an isolated deployment

Use a tested revision containing these files. Node.js 22+ is required when running the CLI outside Docker. The container includes Node.js 22.

Create a new Dokploy Compose application named `parakkat-ai-office`, using `deploy/compose.dokploy.yml`. Its app service is `parakkat-ai-office`, listening on **container port 3000**. Attach only that new service to the existing Dokploy proxy network. The network defaults to `dokploy-network`; set `DOKPLOY_NETWORK` if the existing network has another name. Do not create, rename, or replace an existing proxy network.

For a terminal-managed deployment, use a new directory, for example `/srv/parakkat-ai-office`, and the fixed Compose project name in the supplied file. Do not run commands from another app's directory or reuse its Compose project name. The template reads a dedicated `/etc/parakkat-ai-office.env` file; it must not point at another app's environment file.

Create that new file with owner-only permissions and fill it from this project's `.env.example`. Do not copy `.env.local` into the image. Set at least:

```dotenv
APP_URL=https://ai-office.parakkatjewels.in
NEXT_PUBLIC_SUPABASE_URL=your-existing-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-existing-public-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-existing-service-role-key
CRON_SECRET=a-new-long-random-secret-for-ai-office
CHATGPT_AUTH_ENABLED=true
CHATGPT_AUTH_DIR=/var/lib/parakkat-ai-office/chatgpt
LLM_PROVIDER=chatgpt
```

Keep `OPENAI_API_KEY` empty for this OAuth deployment. Retain the other platform credentials this app already needs. `CHATGPT_AUTH_DIR` is overridden to the protected volume path in the Compose template. Do not set `VERCEL`; OAuth deliberately stays disabled in Vercel runtimes. The app's staff sign-in remains Supabase; connecting ChatGPT authorizes the agents' AI requests.

Obtain the original private values from their provider settings or a protected original copy. A successful Vercel environment export, a matching variable name, or a nonempty value is not proof that a secret was exported: this project's sensitive values were redacted. Do not paste credentials into chat, logs, or source control. Copy them securely into only AI Office's protected runtime file, preserving the existing Supabase project and the exact credential-encryption key. The saved connector tokens use `CREDENTIALS_KEY` when set, otherwise `SUPABASE_SERVICE_ROLE_KEY`; changing that key prevents the existing encrypted tokens from being read. Do not rotate shared credentials or change other VPS applications as part of this migration.

Protect the environment file:

```bash
sudo chmod 600 /etc/parakkat-ai-office.env
```

Use the same public Supabase URL and anon key at **image build time** and runtime; Next.js embeds `NEXT_PUBLIC_*` values in its browser bundle. The service-role key and provider secrets are runtime-only.

## 2. Build and start the new app

Build on a separate computer or build runner with Docker. Set the two public build variables in that shell first. The example targets an x86-64 Linux VPS; match the VPS architecture if it differs.

```bash
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY \
  -f deploy/Dockerfile -t parakkat-ai-office:local .
docker save -o parakkat-ai-office-image.tar parakkat-ai-office:local
scp parakkat-ai-office-image.tar admin@YOUR_VPS:/path/to/your/private-upload-directory/
```

Load only this image on the VPS, then start the new app from its own checkout. Substitute your actual private upload path. Do not use broad Docker cleanup, pruning, or restart commands.

```bash
sudo docker load -i /path/to/your/private-upload-directory/parakkat-ai-office-image.tar
cd /srv/parakkat-ai-office
sudo docker compose --env-file /etc/parakkat-ai-office.env -f deploy/compose.dokploy.yml up -d --no-build
```

When using Dokploy to manage this Compose application, apply equivalent environment-file and build configuration there and let Dokploy own that deployment's lifecycle; do not have Dokploy and a separate terminal deployment create two copies. The `scheduled` profile is absent by default, so this step starts only the app. Do not enable automatic jobs yet.

Add **ai-office.parakkatjewels.in** as a new domain for this new service in Dokploy, routed to container port 3000 with HTTPS. Point only that domain's DNS record at the VPS. Use Dokploy's normal dynamic routing; do not edit another application's routing or restart Traefik. Port 3000 here is internal to the new container, so it does not conflict with Dokploy's host listener.

If the same Supabase project is already initialized, apply only missing migrations from `supabase/migrations` in timestamp order. Do not recreate the database or reseed existing production data. Configure Supabase Auth:

- Site URL: `https://ai-office.parakkatjewels.in`
- Allowed redirect URL: `https://ai-office.parakkatjewels.in/auth/callback`
- Retain the existing Vercel callback temporarily if it is still used during migration.

Register the new domain's existing connector callbacks with Meta, Google, and Shopify as needed: `/api/connect/meta/callback`, `/api/connect/google/callback`, and `/api/connect/shopify/callback`. Preserve the old callback URLs during migration. Existing valid saved credentials can continue using the same Supabase database and encryption key once the real server-side environment values have been restored. The new callbacks are required for connecting or reconnecting through the VPS domain; their registration alone does not validate existing connector access.

## 3. Initialize the VPS's ChatGPT storage

All commands below assume the terminal-managed Compose deployment. In Dokploy, use the equivalent terminal for this app's container, whose working directory is `/app` and user is `node` (UID 1000).

```bash
sudo docker compose --env-file /etc/parakkat-ai-office.env -f deploy/compose.dokploy.yml exec parakkat-ai-office npm run chatgpt -- init
```

The named `chatgpt-auth` volume belongs only to this Compose project. It stores the VPS's stable host identifier separately from account registrations, with a private directory and owner-only credential files. The image initializes the directory for the `node` user. Keep this volume through image updates. Never use `docker compose down -v`, because that removes the saved connection.

## 4. Sign in locally, then transfer the connection

OpenAI's public flow returns to `http://127.0.0.1:<port>/auth/callback`. That is the computer running your browser. It is not the VPS's public URL, so sign in on your computer and securely transfer the protected connection to the VPS. This follows OpenAI's [self-hosted VM procedure](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).

From this project's checkout on your computer, install dependencies and create a dedicated temporary credential directory for this transfer:

```bash
npm ci
transfer_dir=$(mktemp -d)
CHATGPT_AUTH_ENABLED=true CHATGPT_AUTH_DIR="$transfer_dir/auth" npm run chatgpt -- login
CHATGPT_AUTH_ENABLED=true CHATGPT_AUTH_DIR="$transfer_dir/auth" npm run chatgpt -- export "$transfer_dir/credentials.json"
```

The command opens **Continue with ChatGPT** in your browser. Authorize ChatGPT plan usage for Parakkat AI Office. No API key or client secret is needed for this local public-client flow. If port 1455 is occupied, use `login --port 1456`. The exported file contains credentials: transfer it promptly, before the initial ID token expires, without opening it, pasting it, or adding it to source control.

Create a private upload directory for your SSH account and transfer over SSH:

```bash
ssh admin@YOUR_VPS 'install -d -m 700 "$HOME/.parakkat-ai-office-transfer"'
scp "$transfer_dir/credentials.json" admin@YOUR_VPS:.parakkat-ai-office-transfer/credentials.json
```

On the VPS, copy it into **only the new AI Office container**, set ownership, and import it:

```bash
cd /srv/parakkat-ai-office
office_container=$(sudo docker compose --env-file /etc/parakkat-ai-office.env -f deploy/compose.dokploy.yml ps -q parakkat-ai-office)
test -n "$office_container"
sudo docker cp "$HOME/.parakkat-ai-office-transfer/credentials.json" "$office_container:/var/lib/parakkat-ai-office/chatgpt/import.json"
sudo docker compose --env-file /etc/parakkat-ai-office.env -f deploy/compose.dokploy.yml exec --user root parakkat-ai-office chown node:node /var/lib/parakkat-ai-office/chatgpt/import.json
sudo docker compose --env-file /etc/parakkat-ai-office.env -f deploy/compose.dokploy.yml exec --user root parakkat-ai-office chmod 600 /var/lib/parakkat-ai-office/chatgpt/import.json
sudo docker compose --env-file /etc/parakkat-ai-office.env -f deploy/compose.dokploy.yml exec parakkat-ai-office npm run chatgpt -- import /var/lib/parakkat-ai-office/chatgpt/import.json
sudo docker compose --env-file /etc/parakkat-ai-office.env -f deploy/compose.dokploy.yml exec parakkat-ai-office rm /var/lib/parakkat-ai-office/chatgpt/import.json
rm "$HOME/.parakkat-ai-office-transfer/credentials.json"
```

Import preserves the VPS's host identifier. After successful import, remove the temporary directory on your computer:

```bash
rm -r "$transfer_dir"
```

The VPS now owns token refresh. Do not run another copy using the transferred session: refresh tokens rotate, so two machines using the same session can invalidate each other. **Do not run logout on the local copy after transfer**; it would revoke the shared renewable session. The dedicated temporary directory above avoids retaining that copy.

## 5. Select models and verify

Run inside the new app container, using Dokploy's terminal or `docker compose exec` as above:

```bash
npm run chatgpt -- status
npm run chatgpt -- models
npm run chatgpt -- set-models --manager YOUR_MANAGER_SLUG --worker YOUR_WORKER_SLUG
npm run chatgpt -- verify
```

Use slugs returned for your account; do not copy the API-key models blindly. `verify` sends one small request using your ChatGPT plan and succeeds only after a completed Responses stream. Model catalog visibility alone does not prove inference access.

After restoring the private environment values, verify a minimal authenticated server-side Supabase read and confirm the app can decrypt its existing saved connector credentials. For each configured connector, make a minimal read-only request to its actual provider from the new deployment and check the returned result. Record success or the specific failure without logging tokens or returned private business data. Environment-variable presence and a saved “connected” status are not sufficient evidence. Validate any separately configured generation provider with a small permitted request when needed.

In the browser, sign in as Super Admin and open **Admin → Connections**. Confirm the selected ChatGPT account and model settings, then perform one small agent task. Confirm staff permissions, the verified platform connections, and the Usage page before enabling scheduled work. Retain the old Vercel project and environment for controlled rollback; its production runtime remains paused after cutover.

For images, open **Gemini images** in the same Connections tab, press **Edit**, enter the key in the password field, and **Save key**. The server checks access to the configured image and visual-review models using metadata requests only. Saving does not generate an image or prove image quota is available. The saved key takes priority over `GEMINI_API_KEY`; **Use installed server key** removes that override. Keys are never returned in page data or error messages.

Press **Generate test** only when ready to make one billable Gemini image request. The button explains the usage charge; there is no automatic test or retry on save. Successful metadata checks show **Key configured**; a successful image request shows **Images verified**, while quota or permission failures show an actionable error. This test validates the provider, not the gallery/storage workflow: after it passes, order one Studio image and verify the finished image loads. The VPS generates artwork, stores it in the private Supabase `creatives` bucket, and the frontend uses signed URLs; the gallery refreshes while the image is queued or being made.

Plan limits and availability are managed in [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage). OAuth requests are tracked separately from API-key charges. An expired, revoked, or unavailable session needs reconnection or restored plan access; do not silently route it to a paid API key.

If ChatGPT explicitly reports that the shared plan allowance is exhausted, this app pauses that account's inference to avoid repeatedly retrying scheduled work. After confirming access is available again in ChatGPT Settings → Usage, clear the local pause with `npm run chatgpt -- resume` (or use the corresponding Admin action). This does not increase or reset OpenAI's allowance.

## 6. Cut over scheduled work

**Completed on 26 October 2026:** this application's Vercel crons are disabled, Supabase job 1 (`parakkat-agents`) is inactive, and old Vercel production URLs return 503 `DEPLOYMENT_PAUSED`. The isolated VPS scheduler started at **15:37:27 IST** and completed two authenticated ticks by **15:38:15 IST**. See the [readiness report](PRODUCTION_READINESS_2026-10-26.md#scheduler-ownership-and-cutover) for resource/network checks, Odoo continuation progress, and rollback.

The VPS scheduler is the active schedule owner. Keep the old sources disabled and do not alter other applications' schedules. If moving scheduling again, pause new AI Office work, stop its current scheduler, and verify that in-flight work has settled before enabling a replacement. Preserve the VPS-only cron credential without displaying or reusing it for other applications.

For a reviewed restart of the installed scheduler, run from `/opt/parakkat-ai-office/source`:

```bash
docker compose --env-file /opt/parakkat-ai-office/runtime.env \
  -f deploy/compose.dokploy.yml -f deploy/compose.traefik.yml \
  --profile scheduled up -d --no-build --no-deps scheduler
```

The scheduler calls the new app over its private Docker network. It sends the cron secret in an HTTP header from memory, never as a command argument, and does not log returned business data. It advances agents every minute, syncs daily at **06:00 Asia/Kolkata**, and runs SEO on Mondays at **07:00 Asia/Kolkata**. Each job avoids overlapping itself. Keep only one scheduler container.

Inspect Admin for job outcomes and the scoped scheduler logs for service failures. Scheduler HTTP success does not guarantee every individual agent succeeded; per-agent results remain visible in the app. The first future daily sync and Monday SEO run must be verified at their scheduled times.

## Account maintenance

```bash
npm run chatgpt -- accounts
npm run chatgpt -- login --new-account
npm run chatgpt -- use SAVED_ACCOUNT_ID
npm run chatgpt -- logout SAVED_ACCOUNT_ID
```

Log out attempts remote revocation, clears local tokens, and retains the account registration for later sign-in. If revocation cannot be confirmed, disconnect the app in ChatGPT Settings. Plain `login` reuses the active registration; use `--account SAVED_ACCOUNT_ID` to reauthorize a particular saved account, or `--new-account` to add an account or workspace. The loopback callback must reach that runtime. A fresh local-to-VPS transfer can also add a new registration when required.

ChatGPT credentials stay in their private volume. The Gemini override is stored separately as `GEMINI_CONFIG_DIR/gemini.json`, in an atomic owner-only file; it is not saved in Supabase or browser storage. Shopify, Meta, Google, and Odoo credentials remain encrypted in Supabase. Back up both private volumes and the environment file only to protected storage. Do not include them in image layers, logs, support transcripts, or public backups. Restore only one active owner of a renewable ChatGPT session.

Gemini key updates use `.gemini.lock` in the same private directory. The app does not steal an existing lock by age, which protects an active writer. If the process crashes during a write and future saves report an update still in progress, stop **only** the AI Office app and verify no other process uses its provider-secrets volume. Then remove exactly that lock, without reading or removing `gemini.json`:

```bash
docker compose --env-file /opt/parakkat-ai-office/runtime.env \
  -f deploy/compose.dokploy.yml -f deploy/compose.traefik.yml stop parakkat-ai-office
docker run --rm --network none --user 1000:1000 \
  --mount type=volume,source=parakkat-ai-office_provider-secrets,target=/secrets \
  --entrypoint node parakkat-ai-office:local --input-type=module \
  -e "import { unlink } from 'node:fs/promises'; await unlink('/secrets/.gemini.lock').catch(e => { if (e.code !== 'ENOENT') throw e; });"
docker compose --env-file /opt/parakkat-ai-office/runtime.env \
  -f deploy/compose.dokploy.yml -f deploy/compose.traefik.yml up -d --no-build --no-deps parakkat-ai-office
```

Do not remove this lock while AI Office or any other writer is running. These commands operate only on the new app and its own secret volume.

## Standalone systemd alternative

The supplied `parakkat-ai-office.service`, `parakkat-job@.service`, and timers are for a separate machine that does not use the Docker deployment. Do not install them alongside the Dokploy deployment of this app. They use a dedicated `parakkat` user, `/srv/parakkat-ai-office`, `/var/lib/parakkat-ai-office`, and `/etc/parakkat-ai-office.env`. The HTTP listener binds to **127.0.0.1:3210**, with the same app/job resource caps.

Install Node.js 22 at `/usr/bin/node`, create the dedicated user and directories, make the environment file readable only by that user, and build with the same public Supabase settings. Initialize/import OAuth under that service user with `CHATGPT_AUTH_DIR=/var/lib/parakkat-ai-office/chatgpt`. Connect the existing proxy to port 3210 using a new route for AI Office. Enable only the app service first; enable `parakkat-tick.timer`, `parakkat-sync.timer`, and `parakkat-seo.timer` after the same verification and schedule cutover steps. The timers use explicit UTC schedules, so the VPS's system timezone does not change the India-time schedule.

## Official integration references

- [OAuth registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts, refresh, and revocation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and streamed inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Current preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
# Agent conversations and meetings

Apply `supabase/migrations/20261026000200_agent_conversations.sql` before deploying the conversation UI. This additive migration creates private threads, tasks, messages and meeting transcripts. It does not change existing campaigns, approvals, schedules or connector credentials.

Also apply `supabase/migrations/20261026000300_conversation_product_sales.sql` for product-level forecast evidence. Conversations read bounded seven-day and thirty-day Shopify quantities through the signed-in user's permissions, with full-window totals and up to 25 leading products per window. Stock uses the recorded Odoo value when matched, otherwise Shopify; unknown stock stays null and recorded zero stays zero. Active catalogue queries accept Shopify's `ACTIVE` status. Evidence identifies limited samples, observed date ranges, partial days and sync freshness; Shopify order dates are UTC buckets, so these are not exact IST-day totals or a guarantee of complete history.

Click an AI staff member on the office map, or open their page under **Agents**, to ask about their latest recorded activity or assign a task. Conversations retain follow-ups. A head can assign only enabled agents in their departments; the Super Admin can assign any enabled agent. Viewers cannot assign work. Threads and meeting transcripts are private to the requester and remain subject to their current department access.

The host chooses up to two relevant, permitted colleagues. Each colleague makes a separate model call and sees the actual earlier discussion; the host returns the combined answer. **Hold a meeting** explicitly asks for this collaboration. The Boardroom meeting table shows the participants while they work, and opens their discussion and summary. New tasks start immediately through Next.js `after()` on this server, so they do not require the scheduler.

Tasks support status questions, recorded-data analysis, copy, scripts and draft plans. They do not publish campaigns, change ad spend, send external messages, approve work, or generate image files. Those actions continue through their existing Studio and approval flows. Public office activity contains generic progress only; the private task text stays in the conversation.

The coordinator allows at most four model calls, sixty seconds per call and 270 seconds per task. Enqueueing is atomic and idempotent, with one active task per conversation, three per requester and thirty starts per hour. A server interruption is marked failed after ten minutes on the next conversation/meeting read; completed contributions remain, and the requester can send a follow-up. There is no automatic replay of an interrupted task. The old Vercel scheduler does not consume this separate task queue.

