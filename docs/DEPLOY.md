# Deploying to Supabase and Vercel

About 30 minutes. You need admin access to Supabase, Vercel, Shopify, Meta Business and Google Ads.

## 1. Supabase

1. Create a project (region: Mumbai).
2. In **SQL Editor**, run `supabase/migrations/20261024000000_init.sql`, then `supabase/seed.sql`.
   (Or with the Supabase CLI: `supabase link` then `supabase db push`, then run the seed.)
3. **Authentication > Sign In / Providers**: turn off "Allow new users to sign up". People join by invitation only.
4. **Authentication > Users > Invite** the four approvers. After the first person signs in, make them Super Admin:
   ```sql
   update profiles set role = 'super_admin' where id = (select id from auth.users where email = 'you@parakkatjewels.com');
   ```
   Everyone else gets their role on the app's Admin page.
5. **Authentication > URL Configuration**: set Site URL to your Vercel address and add `https://<your-app>/auth/callback` to redirect URLs.

## 2. Vercel

1. Import the GitHub repo `ParakkatJewels-dev/parakkat-ai-office`.
2. Add every variable from `.env.example` under **Settings > Environment Variables**. Start with Supabase, `CRON_SECRET` (any long random string), `OPENAI_API_KEY` and `GEMINI_API_KEY`; add the platform keys as you get them. Each connection lights up on the Admin page once its keys are in.
3. Deploy. `vercel.json` schedules the daily data sync. A Pro plan is recommended so agent steps can run up to 5 minutes.

## 3. Let campaigns move on their own

Each campaign advances one stage per call to `/api/agents/tick`, and the same tick runs the agents' own schedule (data sync every 6 hours, hourly watchers for stock, sales, ads and competitors, and the AI CMO's morning planner, which opens campaigns by itself; they still need the heads' approval). Schedule it every minute from Supabase (**Database > Extensions**: enable `pg_cron` and `pg_net`, then in SQL Editor). Keep the secret in Vault so it never sits in the job text:

```sql
select vault.create_secret('<same value as CRON_SECRET in Vercel>', 'parakkat_cron_secret');
select cron.schedule('parakkat-agents', '* * * * *', $$
  select net.http_post(
    url := 'https://<your-app>.vercel.app/api/agents/tick',
    headers := jsonb_build_object('authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'parakkat_cron_secret'))
  ) $$);
```

Without it, use **Run next step** on the Admin page.

## 4. Connect the platforms

The Super Admin connects Shopify, Meta and Google from **Admin > Connections** by signing in to each platform and choosing the accounts. Each platform only offers that sign-in to an app registered with it, so first register one app per platform and put its own id and secret in Vercel. Add these redirect URLs to each app exactly:

- Meta: `https://parakkat-ai-office.vercel.app/api/connect/meta/callback`
- Google: `https://parakkat-ai-office.vercel.app/api/connect/google/callback`
- Shopify: `https://parakkat-ai-office.vercel.app/api/connect/shopify/callback`

| Platform | Register the app | Vercel variables |
| --- | --- | --- |
| Meta | developers.facebook.com > Create app (Business type) > add Facebook Login for Business and the Marketing API, add the redirect URL above under Valid OAuth Redirect URIs. People with a role on the app and admin rights on the ad account, page and Instagram account can connect without App Review. Optionally create a Login for Business configuration with a system-user token, which does not expire | `META_APP_ID`, `META_APP_SECRET`, optional `META_LOGIN_CONFIG_ID` |
| Google | Google Cloud > APIs & Services: switch on the Google Ads API, Google Analytics Data API, Google Analytics Admin API and Google Drive API (the Design Studio library reads past designs from Drive with the `drive.readonly` scope; add that scope to the consent screen); create an OAuth client (Web application) with the redirect URL above; set the consent screen to In production. Since September 2026 the access level belongs to this Cloud project (Google Ads API page in Cloud Console), not a developer token: Explorer reads your own accounts; Keyword Planner and creating campaigns need Basic, which asks for brand verification | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (an old `GOOGLE_ADS_DEVELOPER_TOKEN` is still sent if set, and Google ignores it) |
| Shopify | Shopify Dev Dashboard > create an app with Admin API scopes `read_products`, `read_orders`, `read_inventory`, add the redirect URL above as an allowed redirection URL | `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` |

The access each sign-in gives is saved in Supabase encrypted with AES-256-GCM, in a table no signed-in user can read. The key comes from `CREDENTIALS_KEY` when it is set, otherwise from `SUPABASE_SERVICE_ROLE_KEY`; if either changes, connect the platforms again. Meta user sign-ins last about 60 days and the Admin page warns ten days before.

### Design library (past designs from Google Drive)

After Google is connected (and reconnected once if it was connected before Drive was added), open **Design Studio > Design library** as the Super Admin and add the Drive folders that hold past designs, by link or by searching their name. The `library` autopilot job reads one page of one folder every 10 minutes, follows subfolders, and has the Banner Designer study up to 12 new designs per pass from Drive's own previews (images, PDFs and Photoshop files). Every banner and Studio order then starts from the three closest past designs. `drive.readonly` is a restricted Google scope. Until Google verifies the app, sign-in shows an "unverified app" warning that the Super Admin can pass (Advanced, then continue); while the consent screen is still in Testing, the sign-in expires after 7 days.

## 5. Platform keys by hand (optional)

Everything below still works and is used when a platform has not been connected from the Admin page.

| Platform | Where | Variables |
| --- | --- | --- |
| Shopify | New stores: create an app in the Shopify Dev Dashboard with Admin API scopes `read_products`, `read_orders`, `read_inventory`, install it on the store, copy the Client ID and secret (the app trades them for a token each day). Stores with an older custom app can use its Admin API token instead | `SHOPIFY_STORE_DOMAIN`, then `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`, or `SHOPIFY_ADMIN_TOKEN` |
| Meta | Business Settings > Users > System users > add an admin system user, assign the ad account, Page and Instagram account, generate a token with `ads_management`, `ads_read`, `business_management`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights` | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` (starts `act_`), `META_PAGE_ID`, `META_IG_USER_ID`, optional `META_PIXEL_ID` for sales-optimised ads |
| Google Ads | A Google Cloud OAuth client with Google Ads API access on its project, and a refresh token for an admin user | `GOOGLE_ADS_CUSTOMER_ID`, optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_OAUTH_*` |
| Keyword Planner | Uses the Google keys above. The Cloud project needs Basic access; with Explorer the SEO Desk uses Google Trends only | optional `SEO_GEO_TARGETS` (default `2356`, India), `SEO_LANGUAGE` (default `1000`, English) |
| Google Trends | Nothing to set: the SEO Desk reads Google Trends' public pages, which can rate-limit servers. For a dependable feed add a SerpApi key | optional `SERPAPI_KEY`, `SEO_TRENDS_GEO` (default `IN-KL`, Kerala), `SEO_SEED_KEYWORDS` (comma list) |
| GA4 | Admin > Property settings for the property id (same Google OAuth user needs Viewer; the refresh token needs the `analytics.readonly` scope as well as `adwords`) | `GA4_PROPERTY_ID` |
| OpenAI / Gemini | platform.openai.com and aistudio.google.com API keys | `OPENAI_API_KEY`, `GEMINI_API_KEY` |
| Jev | TypeSafe AI | `JEV_API_KEY` (optional; OpenAI answers until then) |

Keys set here live only in Vercel. Access connected from the Admin page is stored encrypted in Supabase, as described above.

## What is live and what is next

- Live: Shopify, Meta ads and Instagram sync; SEO Desk (Google Trends and Keyword Planner, every Monday); Design Studio (banners and posters on request); agent reports; learning memory (brand book and lessons from the heads' notes); competitor Instagram scan; full agent pipeline with team-lead review; Gemini banners from product photos; approvals; publishing to Meta (created paused, switched on only after everything is built).
- Next: automatic Google Ads campaign creation (needs Basic access on the Google Cloud project; until then the Google part of a plan is handed to the Performance Marketer); WhatsApp alerts; Triple Whale as an extra source; reels and catalogue generation.
