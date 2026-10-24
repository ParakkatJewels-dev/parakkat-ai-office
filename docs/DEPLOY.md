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

Each campaign advances one stage per call to `/api/agents/tick`. Schedule it every minute from Supabase (**Database > Extensions**: enable `pg_cron` and `pg_net`, then in SQL Editor). Keep the secret in Vault so it never sits in the job text:

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

## 4. Platform keys

| Platform | Where | Variables |
| --- | --- | --- |
| Shopify | New stores: create an app in the Shopify Dev Dashboard with Admin API scopes `read_products`, `read_orders`, `read_inventory`, install it on the store, copy the Client ID and secret (the app trades them for a token each day). Stores with an older custom app can use its Admin API token instead | `SHOPIFY_STORE_DOMAIN`, then `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`, or `SHOPIFY_ADMIN_TOKEN` |
| Meta | Business Settings > Users > System users > add an admin system user, assign the ad account, Page and Instagram account, generate a token with `ads_management`, `ads_read`, `business_management`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights` | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` (starts `act_`), `META_PAGE_ID`, `META_IG_USER_ID`, optional `META_PIXEL_ID` for sales-optimised ads |
| Google Ads | Google Ads > Tools > API Center for the developer token; a Google Cloud OAuth client and a refresh token for an admin user | `GOOGLE_ADS_*`, `GOOGLE_OAUTH_*` |
| Keyword Planner | Uses the Google Ads keys above. The developer token needs Basic access; a test token returns test data only | optional `SEO_GEO_TARGETS` (default `2356`, India), `SEO_LANGUAGE` (default `1000`, English) |
| Google Trends | Nothing to set: the SEO Desk reads Google Trends' public pages, which can rate-limit servers. For a dependable feed add a SerpApi key | optional `SERPAPI_KEY`, `SEO_TRENDS_GEO` (default `IN-KL`, Kerala), `SEO_SEED_KEYWORDS` (comma list) |
| GA4 | Admin > Property settings for the property id (same Google OAuth user needs Viewer; the refresh token needs the `analytics.readonly` scope as well as `adwords`) | `GA4_PROPERTY_ID` |
| OpenAI / Gemini | platform.openai.com and aistudio.google.com API keys | `OPENAI_API_KEY`, `GEMINI_API_KEY` |
| Jev | TypeSafe AI | `JEV_API_KEY` (optional; OpenAI answers until then) |

Secrets live only in Vercel. The database stores which accounts are connected, never the keys.

## What is live and what is next

- Live: Shopify, Meta ads and Instagram sync; SEO Desk (Google Trends and Keyword Planner, every Monday); Design Studio (banners and posters on request); agent reports; learning memory (brand book and lessons from the heads' notes); competitor Instagram scan; full agent pipeline with team-lead review; Gemini banners from product photos; approvals; publishing to Meta (created paused, switched on only after everything is built).
- Next: automatic Google Ads campaign creation (needs Basic access on the developer token; until then the Google part of a plan is handed to the Performance Marketer); WhatsApp alerts; Triple Whale as an extra source; reels and catalogue generation.
