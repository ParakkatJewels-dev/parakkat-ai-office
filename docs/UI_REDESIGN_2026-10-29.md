# Workspace UI redesign — 29 October 2026

## Scope

Compact presentation and accessibility improvements across Dashboard, Agent reports and workspaces, Agent management, Approvals, Outcomes, Automations, Design Studio, SEO, Usage, Settings, and sign-in.

The office page is excluded. `WorkspaceFrame` applies the new `workspace` class only outside `/office` and nested office routes. The original global stylesheet, map implementation, map controls, and office dialogue markup remain unchanged. Shared conversation and artwork handoff CSS retain their original base rules; new styles are opt-in workspace overrides.

## Design changes

- 60px workspace header, 218px desktop navigation, full-width content, and smaller page gutters.
- 4–6px panel and control corners, 12–14px typical panel padding, and tighter section spacing.
- Clearer text hierarchy, readable secondary text, stronger form borders, visible keyboard focus, and larger mobile controls.
- Agent directory becomes scan-friendly rows; individual workspaces group identity, conversation, activity and reports.
- Studio uses a compact summary, consistent artwork cards with complete image previews, grouped review/revision actions, and reference lists without empty image placeholders.
- Operational screens use compact forms and tables, keyboard-scrollable table regions, clear labels, and responsive layouts.

No database, permissions, model routing, generation, review, publishing, billing, or scheduler behavior is changed by this redesign. Existing saved work and draft protections are retained.

## Verification

- Route isolation test covers navigating between workspace and office routes while preserving children.
- Office/map source baseline checked against 16 files; unchanged.
- Shared stylesheet parsed and all 188 rules checked for workspace scope.
- Local dashboard visual preview checked at desktop and 390px phone width in light and dark themes; no page overflow.
- Core contrast pairs: light secondary text 6.47:1, light helper text 5.03:1, light control border 3.26:1; dark secondary text 9.8:1, dark helper text 7.72:1, dark control border 3.46:1.
- TypeScript and focused form, navigation, Studio, conversation, and draft protection tests checked during implementation.

Release checks, source identity, deployment result, and live visual proof are recorded below when the integrated release is verified.

## Release evidence

Deployed `workspace-ui-20261029-r1` to https://ai-office.parakkatjewels.in on 29 October 2026. The app became healthy at **01:48:26 UTC**; the release-owned maintenance pause was cleared at **01:48:43 UTC**.

| Item | Verified value |
| --- | --- |
| Frozen source files | 595 |
| Source manifest SHA-256 | `3795d1dcad17eab1f7c70692092021c9b649c4e2a289eed765eb9ba37d457643` |
| Source archive SHA-256 | `ef0da325af94f0a56214289de93e559e781f4e84c417e3f6055846f63b3f42df` |
| Runtime image | `sha256:6738803b56725113c9c6236d4fa80aafe7470245254893ad4b6f5c4af321d923` |
| Previous image | `sha256:068648b315ff70e3cc06b22bf86fef746ef39e0088ca7963781ce55c1b1fd493` |
| Rollback image tag | `parakkat-ai-office:before-workspace-ui-20261029-r1` |
| Remote source | `/opt/parakkat-ai-office/releases/workspace-ui-20261029-r1/source` |

The exact frozen archive passed **1,047 tests**, with zero failures, skips, or cancellations, plus TypeScript validation from an independently extracted copy. The production Docker build used that same checksummed archive and the existing dedicated builder, capped at one CPU and 2 GiB. The builder is stopped after release.

The source was compared against the actual deployed `chatgpt-revision-routing-20261028-r1` manifest, not Git HEAD. Its delta is exactly the 39 reviewed redesign files plus four historical release documentation/proof files. All 16 protected office/global files match the baseline. The original 8,559-byte conversation stylesheet and 3,411-byte ChatGPT artwork stylesheet remain identical prefixes; appended rules are workspace-scoped. No dependency, deployment configuration, API/backend, or SQL file changed. This evidence section was appended after freezing the package.

Live preservation checks confirmed:

- The app is healthy, public `/login` returns HTTP 200, and exactly one scheduler runs the same new image. The office is unpaused, with zero active tasks, image-generation states, leases, recent text reservations, or job locks at resume.
- All **22 unrelated containers** retain their IDs, image IDs, start times, restart counts, resources, network/port/mount configuration, environment fingerprints, restart policies, and proxy labels. AI Office's private mounts, credentials/runtime-file fingerprints, limits, networks, ports, and proxy routing are unchanged.
- All 11 protected artwork records, review fingerprints, and related generation-job fingerprints are unchanged. The current five-card carousel remains **ready, v4, ChatGPT-imported, error-free, with zero human reviews**. The ChatGPT connection and runtime settings are preserved.
- Deployment submitted no generation, revision, approval, publication, or live chat message and applied no database migration. Only the release-owned pause marker was cleared.

Sanitized release report: `/tmp/parakkat-workspace-ui-20261029-r1-release-report.json`. Frozen validation logs, source review, container inventories, protected artwork fingerprints, and owned-pause/resume records share the same release prefix. Authenticated visual verification is performed separately by the coordinating agent after resume.

## Live visual QA and finishing patch

Authenticated desktop checks covered the dashboard in both themes, agent directory and detail, settings, automations, outcomes, approvals, usage, agent management, SEO, and Studio. The office route retained its original shell and exact measured geometry, colors, typography, padding, and corners after the release. The five existing carousel images and versions remained unchanged.

Visual QA identified three presentation corrections: Studio portrait images needed an absolutely positioned image box to respect the preview height cap; SEO empty panels needed top alignment rather than stretching to the adjacent column; Usage inherited a column direction from an older shared chart selector, so its bar chart now explicitly uses a row and its panel no longer stretches to the tall provider table. These three CSS modules are the only runtime changes in the finishing release.

The corrected Studio DOM and styles were checked in a same-origin local preview using the five existing artwork files: at 390px, the document and main content both measured 390px without horizontal overflow; each image box matched its parent at 422.5px with `object-fit: contain`. At desktop width all five loaded images matched their 400px parent. This is a responsive layout check, not a mobile end-to-end interaction test. Browser viewport emulation was unavailable, so the 390px check used a fixed-width iframe.

Saved proofs are in `docs/proofs/workspace-ui-*-2026-10-29.png`. Studio proof will be refreshed against the live finishing release.

## Finishing release evidence

Deployed `workspace-ui-20261029-r2` on 29 October 2026. Healthy activation completed at **04:41:21 UTC**, and the release-owned pause was cleared at **04:41:47 UTC**.

| Item | Verified value |
| --- | --- |
| Frozen source files | 600 |
| Source manifest SHA-256 | `e819efe6302f12e7e00863b5764f00bee295aac59b740f9e80626cf030fc1616` |
| Source archive SHA-256 | `228af3cc6561a70942857ea3c775c268762d830ff9828a366a13d97cbc4a162a` |
| Runtime image | `sha256:4a743d4ef9300657228bbb38c7ed8be7260d753c4f8ff2072a6c79348853714d` |
| Previous r1 image | `sha256:6738803b56725113c9c6236d4fa80aafe7470245254893ad4b6f5c4af321d923` |
| Rollback image tag | `parakkat-ai-office:before-workspace-ui-20261029-r2` |
| Remote source | `/opt/parakkat-ai-office/releases/workspace-ui-20261029-r2/source` |

An independently extracted copy of the final frozen archive passed **all 1,047 tests** and TypeScript validation. The production build used that same checksummed archive. The exact delta against deployed r1 is nine approved files: three CSS modules, this document, and five visual proof files. All 16 protected office/global files and all shared conversation/artwork styles are unchanged from r1. No backend/API, dependency, deployment configuration, or SQL change is included. An earlier unused candidate was superseded before upload or build; only the final manifest above was deployed.

Post-activation checks confirmed a healthy app, public `/login` HTTP 200, exactly one scheduler on the new image, and the same stopped dedicated builder container with its one-CPU/2-GiB limits. All **22 unrelated containers** preserved their identities, images, start times, restart counts, resources, networks, ports, mounts, environment fingerprints, restart policies, and proxy labels. AI Office's runtime-file/credential fingerprints, private volumes, settings, and account connection remained unchanged.

All 11 protected artwork records and associated review/job fingerprints match the pre-release snapshot, including the five ready, error-free, unreviewed v4 ChatGPT carousel cards. At resume all active-work, active/uncertain generation, lease, recent text-reservation, and lock counts were zero. No generation, revision, approval, publication, live chat message, or schema migration was submitted by deployment. Only the r2-owned maintenance marker was cleared; rollback was not needed.

Sanitized report: `/tmp/parakkat-workspace-ui-20261029-r2-release-report.json`. This evidence section and the final live proof refresh are outside the immutable deployed archive. Final authenticated visual verification is recorded by the coordinating agent after resume.

## Final live verification

After r2 activation, all five current carousel images loaded at 1122 × 1402, remained v4, and rendered with `position: absolute`, `object-fit: contain`, and matching 400px image/parent heights. Studio has no horizontal page overflow at the desktop viewport. Its proof screenshot has been refreshed from r2.

The live Usage chart now computes `flex-direction: row`, a 2px gap, and zero minimum bar width; its 1176px visible width equals scroll width and the chart card is 235.5px high. A separate static 90-bar fixture at 390px verified that the chart's 336px width equals scroll width and the page remains 390px. The live SEO grid computes `align-items: start` without main-content overflow.

The dashboard was refreshed and saved in the original dark theme. Keyboard focus has a visible 2px solid outline. The native Studio image dialog shows the full image, closes with Escape, and restores focus to View image. The office baseline comparison remains identical. No review, generation, publishing, settings, or chat action was submitted during UI verification.

The local preview servers have been stopped. Saved screenshots and this QA section were refreshed after the immutable deployment package was frozen and do not change its source manifest identity.
