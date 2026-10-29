# Agent management — 26 October 2026

Agent management adds a searchable directory and saved working instructions for each AI agent. Migration 006 is applied, the new image passed its deployment audit at **16:18:39 IST**, and live directory, save/persistence, next-step instruction propagation, and clearing checks passed. The temporary test instruction was cleared at revision 2; no other agent instructions were set during verification.

## Using the page

Open **Agents → Agent management** (`/agents/manage`). Search by name or role, filter by department, and select an agent. The detail view shows its current role, department, lead, enabled status, base guidance, and the context your account may read.

The Super Admin can edit all agents. A department's assigned human head can edit that department's agents. Other heads and viewers can browse the basic roster, but cannot read or change another department's saved instructions or history.

Enter additional guidance, up to **6,000 Unicode characters**, and press **Save instructions**. Use it for priorities, preferred formats, or working preferences. Empty the field and save to clear the additions. Each confirmed save creates a new revision and history entry; using an earlier history entry as a draft does not change the saved version until Save is pressed.

If another person saved first, the page keeps your draft and shows the latest saved revision. Choose the latest text or explicitly keep your draft for retry, then save against that revision. A stale save cannot silently replace newer instructions. Switching agents with an unsaved draft prompts you to keep editing or discard it.

## Runtime behavior

Every named agent call reads its current database role, enabled state, saved instructions, brand guidance, and relevant lessons. There is no process-wide saved-instruction cache. The new text applies at the next agent step; an already submitted model request keeps the prompt it received.

Propagation covers conversations and meetings, opportunity reviews, campaign planning/copy/review, SEO, named Gemini image generation and visual review, design-library analysis, and classification. The supplied database client preserves the requester's context visibility; background runtime uses the server's read access. A missing/disabled agent or failed instruction read stops that step rather than silently using stale preferences.

Saved instructions supplement the agent's role. House rules, current-task response formats, evidence limits, product fidelity, access permissions, and approval gates take precedence. The editor does not grant new tools or authority to publish, spend, contact customers, or change provider accounts. Existing campaigns and approvals remain intact.

## Migration and permissions

Applied migration: [`20261026000600_agent_instructions.sql`](../supabase/migrations/20261026000600_agent_instructions.sql), confirmed successful by the deployment owner in the authenticated Supabase SQL Editor, inside one transaction. It creates new tables/functions/policies without rewriting existing business records and requests a PostgREST schema reload.

- `agent_instructions`: current text, positive revision, timestamp, and editor, keyed by agent ID.
- `agent_instruction_history`: append-only application history with old/new revision, new text, timestamp, and editor.
- `save_agent_instructions(p_agent_id, p_instructions, p_expected_revision)`: authenticated save RPC returning the updated record. Use expected revision **0** for the first save; later saves require the exact current revision. Blank text is a versioned clear.

Row-level security restricts both tables to the Super Admin or the current department head, explicitly excluding viewers. Authenticated clients have SELECT access only; they cannot insert, update, or delete either table directly. The runtime service role receives SELECT access. Only the authenticated RPC performs edits and appends history.

The save transaction locks the editor's profile, target agent, and assigned department to stabilize role/department authorization and serialize first saves. A stale expected revision raises **40001**; unauthorized access raises **42501**; unknown agents raise **P0002**; invalid input raises **22023**. Current text and audit history commit together or both roll back.

## Validation and release record

| Check | Result |
| --- | --- |
| Migration / RLS / RPC tests | **10/10 focused PGlite tests passed.** Covers unauthenticated/viewer/other-head denial, correct-head/admin saves, Unicode limit and input validation, first/update revision conflicts, scoped reads/history, department reassignment, role revocation, denied direct client/runtime writes, and rollback when history insertion fails. |
| UI save tests | UI owner reported **10 focused tests passed** and typecheck passed. |
| Runtime and usage tests | Runtime owner reported **13 focused tests passed**, covering fresh instructions, bounded read failures, Unicode preservation, and agent usage attribution. |
| Independent code review | No critical permission, concurrent-save, or propagation gap found in the final UI/runtime review. Runtime owner independently reviewed migration locking and access rules. |
| Full release tests and production build | **220/220 tests passed**, typecheck passed, and the production build passed, as confirmed by the deployment owner. |
| Production image / rollback tag | App and scheduler use `management-20261026` / `local`, immutable OCI manifest **`sha256:f7060c89a64e2a20a81164bfbd34d1f7885f621478192205bba4bc6acfcc0689`**, verified against the image descriptor. `before-management-20261026` preserves prior manifest **`sha256:53b6dc994f4e18a69d061828a60ecf681e8231ea7c2e26137349a6b242d01253`**. |
| Live directory, save, persistence, and history | **Passed.** All **67 agents** appeared in the searchable directory with their current roles/default guidance. A temporary Analytics Lead instruction saved as revision 1 at **16:18 IST** and persisted after navigating away and back. History displayed both revisions after clearing. Concurrent-save conflicts were covered by automated DB/UI tests; no live concurrent browser-save test was performed. |
| Live next-step instruction propagation and restored test state | **Passed.** At **16:19 IST**, an actual Analytics Lead task replied with the marker **“Saved instructions are active.”**, which appeared only in the saved instruction, then identified its correct role/department. The test instruction was cleared at **revision 2, 16:19 IST**; the UI confirmed the clear and showed **0 / 6,000** characters. No other agent received test instructions. |
| Final app/scheduler/private-volume health and unrelated services | **Passed at 16:18:39 IST.** App healthy; scheduler running with inherited HTTP check disabled and its first successful tick at **16:18:20 IST**. No restart, OOM, failed-request, or error-log matches. All **22 unrelated containers, including Hermes**, retain IDs/start times against both the fresh and original baselines. |

Only AI Office's app and scheduler were recreated. App limits remain 1 CPU / 1.5 GiB / 192 PIDs; scheduler limits remain 0.25 CPU / 128 MiB / 64 PIDs, on only its private office network. Neither publishes host ports. The dedicated builder is stopped with 1 CPU / 2 GiB caps. ChatGPT/provider-secret directories remain mode `0700`, UID/GID 1000; the Gemini key file remains `0600`. No secret values were output. Sanitized audit evidence: `/tmp/parakkat-management-final-readonly-audit.json`; fresh baseline: `/tmp/parakkat-before-agent-management.json`.

Live response screenshot: `/tmp/ai-office-agent-instruction-response.png` (temporary local evidence). Clearing restored the agent to base guidance while preserving revision 1 and revision 2 in the scoped audit history. This live check exercised ChatGPT reasoning; other named model paths were verified by source review and focused tests rather than separate paid live calls.

The migration can remain installed during an application rollback; older versions do not use these additive tables. Preserve saved instructions/history and private credential volumes. Any service rollback must affect only AI Office, with only one scheduler owner active. See [self-hosting](SELF_HOST.md), [production readiness](PRODUCTION_READINESS_2026-10-26.md), and the prior [opportunity-review release](OPPORTUNITY_REVIEWS_2026-10-26.md) for existing connector limits and isolation requirements.

No production mutations were performed by the migration author/auditor. The deployment owner applied the migration; live application changes are recorded above separately.
