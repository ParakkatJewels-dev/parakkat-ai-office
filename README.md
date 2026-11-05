# Parakkat AI Office

An AI marketing team for Parakkat Jewels that lives in a 3D office you can walk through. Agents read Shopify, Meta, Instagram and Google data, watch competitors, plan festival campaigns, make banners from real product photos, and publish to Meta only after people approve.

## How work flows

1. **Staff agents** do the work and write reports.
2. **AI team lead** of each department re-checks every report and either forwards it to the human head, sends it back to revise (up to twice), or rejects it.
3. **Human heads** (Creative Head, E-com Manager, Performance Marketer) see forwarded reports for their departments and accept, send back or reject them.
4. **Campaign plans** go from the AI CMO to the heads they touch, then to the **Super Admin**, who alone can approve and publish.

**Who sees what.** A head sees their own departments and any conversation another team has with them, never conversations between two other teams. The Super Admin sees everything. This is enforced by Postgres row-level security (`supabase/migrations`), so it also filters the live office feed, not just the screen. Department heads can be reassigned on the Admin page.

## Stack

- Next.js 15 (App Router) on Vercel
- Supabase: Postgres with row-level security, Auth, Storage (banners), Realtime (drives the office)
- OpenAI for agent reasoning (manager and worker tiers), Gemini for images, Jev by TypeSafe AI for scoring (falls back to OpenAI until a key is set)
- three.js r147 for the office (`src/office/engine.mjs`)

## Layout

| Path | What |
| --- | --- |
| `src/office/` | The walkable 3D office: `floorplan.mjs` (ten rooms, seats, routes), `walk.mjs` (movement, doors, E to talk), `building.mjs`, `crowd.mjs`, `engine.mjs`, `agent-hq.mjs`, and the roster |
| `src/lib/agents/` | Campaign pipeline (one stage per call), team-lead review, publishing, data sync |
| `src/lib/connectors/` | Shopify Admin GraphQL, Meta Graph (ads, Instagram, competitors, publishing), Google Ads and GA4 |
| `src/lib/llm/` | OpenAI, Gemini and Jev clients (plain REST) |
| `src/app/` | Office, Dashboard, Approvals, Admin, login |
| `supabase/` | Schema, security rules, sign-off functions; `seed.sql` is generated from the roster |
| `tests/` | Runs the real migration in embedded Postgres and checks the visibility and sign-off rules |

## Develop

```bash
npm install
cp .env.example .env.local   # fill in Supabase and the keys you have
npm run dev
npm test                      # database rules and roster checks, no Supabase needed
npm run seed:gen              # after editing src/office/roster.mjs
node scripts/office-preview.mjs   # the 3D office on http://127.0.0.1:4173 with sample data, no login or database
```

Deploying: see [docs/DEPLOY.md](docs/DEPLOY.md).

For edits on a separate DaVinci Resolve Studio Mac or Windows PC, see
[deploy/video-worker/README.md](deploy/video-worker/README.md). The existing Video
Editor uses a dedicated queue; source media and exports remain on that computer.

For a VPS with **ChatGPT OAuth instead of an OpenAI API key**, follow [docs/SELF_HOST.md](docs/SELF_HOST.md). This uses the official Sign in with ChatGPT flow, keeps renewable credentials in protected storage on the VPS, and sends agent reasoning through your connected ChatGPT plan. Staff still sign in through Supabase; Gemini image generation remains a separate provider.
