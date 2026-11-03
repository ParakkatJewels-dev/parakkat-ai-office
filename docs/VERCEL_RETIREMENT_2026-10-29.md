# Vercel project retirement — 29 October 2026

At the user's explicit request, only the old Vercel project **parakkat-ai-office** was deleted. AI Office continues at **https://ai-office.parakkatjewels.in** on the VPS.

| Scope | Identifier |
| --- | --- |
| Project | `prj_kn6NZnww92DNxApOqYwDoLyL57gm` |
| Team | `team_S8OrkT9Yk97mKBe70rcNID0f` |

The scoped CLI removal reported success. Subsequent checks confirmed:

- A scoped lookup of the project ID returned HTTP 404, project not found.
- The exact project-name search returned no projects.
- `https://parakkat-ai-office.vercel.app` returned HTTP 404, `DEPLOYMENT_NOT_FOUND`.
- The immediate check of the historical production deployment URL still returned HTTP 503, `DEPLOYMENT_PAUSED`; it served no application.

Post-deletion VPS checks found the app healthy and its scheduler and separate image worker running, each with zero restarts. The VPS login page returned HTTP 200. A repeated Supabase read **after deletion**, at **17:01:01.603 IST** (11:31:01.603 UTC), returned HTTP 200 and confirmed the office remained unpaused. The scoped deletion checks are saved in [deletion-proof.json](../output/vercel-retirement-2026-10-29/deletion-proof.json), verified at **17:01:05.252 IST** (11:31:05.252 UTC).

The retirement changed no VPS service or setting, Supabase data or configuration, or GitHub repository. No Vercel account, team or other project was deleted.

A protected project-metadata snapshot exists at `output/vercel-retirement-2026-10-29/project-before.json`, verified as mode `0600`. Environment values were not printed. This metadata snapshot is **not a complete credential backup**.

The stale local `.vercel/project.json` link was archived at `output/vercel-retirement-2026-10-29/retired-project-link.json`, preserving its original content. Other `.vercel` files were unchanged.

The earlier instructions to retain or unpause this Vercel project for rollback are superseded by this retirement. They remain in the historical migration reports as evidence of the original cutover, not as current operating instructions.
