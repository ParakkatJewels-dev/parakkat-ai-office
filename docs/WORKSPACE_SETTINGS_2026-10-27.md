# Workspace settings — 27 October 2026

**Live:** `ui-settings-20261027-r1` at [AI Office](https://ai-office.parakkatjewels.in/admin). All **19 production verification gates passed at 10:39:47 IST** on 27 October 2026.

## Delivered

Workspace settings now uses grouped navigation with eight focused sections:

| Group | Sections |
| --- | --- |
| Workspace | Overview; People & permissions; Brand guidance |
| Intelligence | AI providers; Learning memory; Competitors |
| System | Connections; Office controls |

The overview provides status and entry points without loading provider setup or operational histories. People and department-role forms remain locked until Edit is selected. Brand voice, standards and context have their own section; learning memory provides team filtering, pagination, new lessons and retirement controls.

AI providers and business connections are separate. Saved provider configuration is collapsed behind clear controls; errors, expired access and usage limits remain visible. Business service checks distinguish saved credentials from successful syncs. Additional AI service errors open their details automatically. Account selections, password-field behavior, server credential precedence and permission guards are preserved.

Office controls groups pause/resume, opportunity reviews, campaign recovery and schedules. Legacy settings anchors continue to select the relevant section while preserving feedback and review flags. Unsaved settings trigger a focused Keep editing / Discard and continue dialog for workspace navigation; pending submissions block leaving. Filtering learning memory also respects unsaved drafts.

The global dark theme now uses neutral black (`#090909`) and white text (`#fafafa`), with green actions and status accents. The dashboard’s dark summary card is neutral. The light palette is unchanged.

## Verification

- **665 tests passed:** the full 660-test run plus five settings-navigation tests. After resolving the pagination module filename collision, all 17 focused settings/pagination tests passed again.
- TypeScript typecheck, clean local and remote production builds, and the final diff check passed.
- Live browser QA covered all eight sections, locked role controls, brand draft retention and explicit discard without saving, and memory filtering from eight to four lessons with the department filter retained by pagination.
- Meta disconnect, Gemini Generate test and office pause confirmations were opened and cancelled. No disconnect, image request or pause occurred; the office remained running.
- The legacy `/admin#sync` link opened Connections. Light and dark desktop layouts had no horizontal overflow. At **390 × 844**, Overview and AI-provider content had matching **374 px** client/scroll widths. The checked confirmation occupied y=295.875–548.125 with every button inside its bounds.
- The checked browser console contained no warnings or errors. Final light, dark and mobile screenshots are saved below.

QA made no settings writes, provider writes or paid AI/image test calls. The existing Google Keyword Planner **403** remains visible. An existing opportunity review that needs attention is also preserved; this release does not resolve those underlying service/workflow issues.

## Deployment boundaries and proof

Only AI Office was deployed. All **22 other VPS containers**, including **Hermes**, were verified unchanged. Office running state, usage caps, schedules, models, credentials, configuration, protected permissions, runtime volumes, resource limits and networks were preserved. The app and scheduler use the expected image; a scheduler tick completed after deployment, with no detected app/scheduler errors, restarts or out-of-memory events. The dedicated builder was stopped afterward.

| Item | Verified value |
| --- | --- |
| Release | `ui-settings-20261027-r1` |
| Image | `sha256:56aeed68412f3474f45239089fe5dea753c859ee5974e6f43fd876caff969dd8` |
| Source manifest | 415 files; SHA-256 `3070ad3f8ee608325346ec19fcf5b797e870bd963a2c92ce59dc349619cbec27` |
| Rollback | `parakkat-ai-office:before-ui-settings-20261027-r1` |
| Final runtime proof | `/tmp/parakkat-ui-settings-r1-final-verification.json` |
| HTTP proof | `/tmp/parakkat-ui-settings-r1-http-verification.json` |
| Focused test proof | `/tmp/ai-office-settings-focused-tests.log` |

Production screenshots: [Dark](settings-dark-2026-10-27.png), [Light](settings-light-2026-10-27.png), [Mobile](settings-mobile-2026-10-27.png).

This is a navigation, presentation and interaction update. It adds no permission expansion, provider capability, database migration or autonomous publishing behavior. Existing execution and approval guards remain authoritative. Browser checks establish the tested flows and viewport sizes, not a complete accessibility certification.
