# Design-library scan — 26 October 2026

The saved design library was incomplete because folder discovery had not finished. The starting library held **59 ready references and 2 skipped**, with **139 eligible Drive files not yet indexed**. The repaired release is deployed and healthy. Its live manual pass completed at **16:38:08 IST**, bringing the library to **200 indexed references across 49 folders**: **71 ready, 2 skipped, and 127 waiting for visual study**, with no failed references or unfinished folders. The browser refreshed automatically and displayed the same counts.

## Verified starting state

At **16:24:19 IST**, exact status counts and a paginated read both returned **61 references**. None were hidden, and every ready reference had a stored preview. The two skipped files were marked “Not a finished design.”

| Selected root | Drive folders, including root | Eligible Drive files | Indexed references | Ready | Skipped | Not indexed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CAROUSEL DIWALI | 5 | 40 | 40 | 40 | 0 | 0 |
| Kiran | 44 | 160 | 21 | 19 | 2 | 139 |
| Total | **49** | **200** | **61** | **59** | **2** | **139** |

The deployment owner's independent Drive traversal completed **49 read-only requests** without provider errors, incomplete-search responses, or shortcuts. These counts are a point-in-time comparison, not a promise that every eligible file will be accepted as a finished design after visual study. The comparison used all 61 saved references, not a gallery display limit.

The database held **45 folder records**, of which **41 had no completed-scan timestamp**, with no saved page tokens or folder errors. The latest library job completed at **16:21:06 IST** with “CAROUSEL DIWALI: 4 read, 0 new · 0 studied.” The latest newly indexed file and library study were around **14:27 IST**. No scan lease was active at the observation time.

The office was not paused, the Banner Designer was enabled, Gemini had a saved configuration and a successful recent image check, and ChatGPT was connected without a usage block. Recorded monthly spend was **₹305.14 of ₹500**. These checks do not make a fresh provider request or guarantee future quota.

## Cause and repair scope

The old job processed **one folder page per run**, normally every nine minutes. A recursive library therefore needed many runs before files in later folders appeared. The old **Scan now** action also cleared completed folder timestamps, so repeated requests could restart discovery progress. The old incremental query coupled pagination to a changing modification-time filter.

The reviewed repair uses the same full-folder query for every page, then checks file eligibility locally. This also fixes a mismatch where TIFF and other image formats were accepted by the eligibility helper but excluded by the old query. Discovery can read up to **50 pages or 85 seconds per pass**. A page advances only after its child folders and file records have been saved; replay after a partial write is safe. Incomplete Drive searches and real folder failures retain unfinished checkpoints with persisted retry backoff. Reaching the discovery time budget preserves progress without recording a false folder error.

A dedicated **260-second lease** protects a worker whose work deadline is **230 seconds**. Scheduled and manual scans share ownership, and add/remove actions use the same lock with their own shorter deadline. The runner owns its schedule row, rechecks whether a scheduled pass is due under the lease, and uses conditional progress/outcome writes. **Resume scan** preserves completed folders and active page tokens; **Resume study** preserves completed folder inventories. A full rescan is requested when no unfinished discovery or study remains. The implementation uses the existing `sync_cursors` table; **no migration is required**.

Study is separately limited to **12 existing references per pass**, with at most **four concurrent calls** and a 40-second per-reference deadline. Claims are saved before model requests. Completed output must still match the current reference revision and active lease; uncertain interrupted claims become explicit failures instead of being automatically submitted again. A provider-wide quota, authentication, model, or instruction-read problem stops further batches and leaves the queue blocked until an explicit resume after correction. Metadata discovery can continue while visual study is blocked.

Discovery reads Drive metadata. Studying a reference reads its preview and uses Gemini to describe it; those are separate steps, and study may incur model usage. A discovered file may be skipped if it is not suitable finished artwork. Existing finished references and user pin/hide choices must remain intact.

## Validation and release record

| Check | Result |
| --- | --- |
| Read-only DB and Drive reconciliation | **Passed.** Counts above distinguish undiscovered files from unfinished study. |
| Pre-release runtime audit | **Passed at 16:24:53 IST.** App healthy on management image `sha256:f7060c89a64e2a20a81164bfbd34d1f7885f621478192205bba4bc6acfcc0689`; scheduler running with HTTP healthcheck disabled. Seven ticks completed since its recreation, latest at **16:24:06 IST**; no error-log matches, OOMs, or restarts. Dedicated builder stopped. |
| Unrelated services | **All 22 existing containers, including Hermes, retain their container IDs and start times.** Fresh deployment baseline: `/tmp/parakkat-before-library-fix.json`. |
| Independent checkpoint/concurrency/failure review | **Passed.** Final review found no remaining critical blocker after scheduler outcome ownership, deadline handling, resume behavior, and folder-edit concurrency were corrected. |
| Focused scanner tests | Implementation owner reported **27/27 passed**. Tests execute the actual TypeScript runner with injected providers/database: 237 files across multiple pages, nested discovery, partial checkpoint replay, saved backoff, busy/resume behavior, claims present before model invocation, exact revision checks, lease loss, provider-wide blocking, pause, and bounded cancellation. No live provider calls occur in these tests. |
| Full tests, typecheck, production build | **Passed.** Deployment owner confirmed **253/253 tests**, typecheck, diff check, and production build. No database migration was required. |
| New immutable image and rollback tag | **Verified.** App and scheduler use `library-20261026` / `local`, manifest **`sha256:ebefd55aa7187e3c47e8e668eafe57bcfabd9856cb7122c24188aca8d70cd687`**. `before-library-20261026` preserves the prior management image **`sha256:f7060c89a64e2a20a81164bfbd34d1f7885f621478192205bba4bc6acfcc0689`**. |
| Live discovery / inventory reconciliation | **Passed.** The manual pass completed at **16:38:08 IST** (`2026-10-26T11:08:08.816Z`), reading **44 folder pages** and recording **139 new files**, reaching **200 references / 49 folders**, with **zero pending folders or folder errors**. A second direct Drive traversal made **49 read-only metadata calls** and matched every eligible file and folder: **Kiran 160 files / 44 folders**, **CAROUSEL DIWALI 40 files / 5 folders**, **zero missing references or untracked folders**. No shortcuts, incomplete searches, errors, or traversal limits were encountered. The comparison used all 200 saved references; it read no images and made no writes. |
| Limited live visual study and UI refresh | **Passed.** The real manual UI pass successfully studied **12 existing queued references**, with no artificial test images. Saved state and the automatically refreshed browser agree: **71 ready, 2 skipped, 127 waiting, zero failed**. The pass ended `queued` for remaining study, with **zero active claims** and **no study block**. |
| Final app/scheduler and unrelated-container audit | **Passed at 16:37:02 IST.** App healthy; scheduler running with HTTP healthcheck disabled and two completed ticks, latest **16:37:00 IST**. No error-log matches, OOMs, or restarts. All **22 unrelated containers, including Hermes**, retain IDs and start times against both the fresh and original baselines. |

Only AI Office's app and scheduler were recreated. App limits remain **1 CPU / 1.5 GiB / 192 PIDs**; scheduler limits remain **0.25 CPU / 128 MiB / 64 PIDs**, on only its private office network. Neither publishes host ports. The dedicated builder is stopped with **1 CPU / 2 GiB** caps. ChatGPT and provider-secret directories remain `0700`, UID/GID 1000, and the Gemini key file remains `0600`.

Discovery is complete for the verified inventory; **127 indexed references remain queued for ordinary bounded visual-study passes**. They are not missing Drive files. The ready/skipped totals will change as those studies finish, and new Drive changes are checked by subsequent inventory passes. The live check does not claim that all 200 files have already been visually studied or accepted as finished artwork.

Final per-root status: **Kiran 31 ready / 2 skipped / 127 waiting**; **CAROUSEL DIWALI 40 ready**. The verified live page shows **Queued**, **200 indexed**, **0 / 49 folders pending**, **71 ready**, **127 waiting**, and **0 failed**. Of 24 rendered gallery image elements, **23 were loaded, one remained lazy/unloaded, and none were broken**. Screenshot: `/tmp/ai-office-library-scan-fixed.png` (temporary local evidence).

Sanitized local evidence: `/tmp/parakkat-library-readonly-audit.json`, `/tmp/parakkat-library-runtime-audit.json`, and `/tmp/parakkat-library-final-runtime-audit.json`. No secret values, model requests, provider writes, or production changes were made by the auditor. Deployment and live application actions are performed by the deployment owner and recorded separately.

Any deployment or rollback must affect only AI Office's app and scheduler, preserve private credential volumes and saved references, and keep one scheduler owner. The previous image is preserved under `before-library-20261026`. An old-image rollback restores the earlier, slower scanner; prefer keeping the scheduler stopped until its handling of the saved version-2 progress has been reviewed, so interrupted study claims are not automatically resubmitted by legacy code. No database rollback or deletion of references is required. See [self-hosting](SELF_HOST.md) and [agent management](AGENT_MANAGEMENT_2026-10-26.md) for the runtime and isolation requirements.
