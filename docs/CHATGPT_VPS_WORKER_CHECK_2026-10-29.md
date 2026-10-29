# ChatGPT subscription image worker — deployment and live verification, 29 October 2026

The VPS worker successfully completed an explicit Studio image request and imported the finished artwork for human review. AI Office release `chatgpt-image-worker-20261029-r1` is deployed, and the separate recurring image worker is running with a verified idle queue.

## Verified locally

A non-interactive Codex CLI run successfully generated one raster image using the built-in `image_gen__imagegen` tool and saved it without any upload or publication.

- CLI: `0.164.0-alpha.11.1`, macOS arm64.
- Authentication: `codex login status` reported **Logged in using ChatGPT**.
- API-key environment variables were removed for the child process: `OPENAI_API_KEY`, `CODEX_API_KEY`, and `CODEX_ACCESS_TOKEN`.
- The run used `--ignore-user-config --ephemeral --sandbox workspace-write --disable apps`, with `forced_login_method="chatgpt"` and `features.image_generation=true`.
- Exactly one generation was requested, with no retry or paid-provider fallback.
- Prompt: “Create a simple square photograph of a single plain gold bangle on an off-white background, soft studio lighting, no text, no logo.”
- Result: `output/imagegen/codex-worker-check-2026-10-29/test.png`, 1254 × 1254 pixels; visually inspected.
- SHA-256: `0f8bc5e2560f1f9f93de3a705c7aad9ef2d02b7a11fdff5f1e7b62f0230bdc85`.
- Transcript: `output/imagegen/codex-worker-check-2026-10-29/run.log`.

This verifies subscription-based image generation in a scripted Codex session on this Mac. The separate Linux verification is recorded below. Built-in generation uses included ChatGPT/Codex usage and is subject to plan limits; this is not a claim of unlimited generation.

## Verified on the VPS

A fresh, separate ChatGPT login completed in the isolated Linux Codex worker. The existing AI Office OAuth session was preserved. The worker uses the pinned official `@openai/codex@0.165.0` client and its own persistent authentication and work volumes.

The initial Linux pilot completed exactly one native image generation, without an API key or paid-provider fallback:

- Image: 1254 × 1254 pixels, 1,624,711 bytes.
- SHA-256: `3cc1b301c468704a895686caec4f23918df2c37382c22424c1852cfa946e8f0f`.
- The initial attempt to copy the already generated image with a shell command failed under `bwrap`. The image generation itself had succeeded.
- The supervisor was changed to collect the PNG from the exact native session identified by the trusted CLI receipt. This collector was validated against the same image, with no regeneration.
- The unprivileged child was denied access to the root-owned supervisor control data.
- Validated worker image: `12f8a6d30173`; resource limits: 0.5 CPU and 1 GiB RAM; no published host ports. Host security settings and unrelated applications were preserved.

The collector checks the session identity, rejects symlink directories and files, requires exactly one regular PNG, and validates its dimensions, structure and hash. The model no longer needs a shell or copy command. A durable session receipt lets the supervisor recover an existing image after a later process failure without submitting another generation.

## Deployed AI Office integration

The existing AI Office custom ChatGPT OAuth connection supplies text. The new image worker is a separate Codex CLI integration. It adds an authenticated durable queue, frozen briefs and reference bundles, guarded dispatch, and versioned ChatGPT artwork import with human review. It does not use Higgsfield credits or a paid image API as a fallback.

Migration `20261029000600_chatgpt_image_worker.sql` was applied successfully through Supabase. Release `chatgpt-image-worker-20261029-r1` is deployed: the app is healthy and its separate scheduler runs the same new application image.

| Release evidence | Verified value |
| --- | --- |
| Application image | `sha256:e00abb34e68201c0f72d1e02d1e5b48b3d86ff286c6098aa4a3c116d4498e3de` |
| Frozen source archive SHA-256 | `b9cc66d45765038e879ec61533dddd6a15d76325b4e1490026214c8aaeb71bfa` |
| Frozen source files | 608 |
| Release-owned pause | Set at 11:12:49.710 UTC; cleared after validation |
| Unrelated containers | All 23 retained their container IDs and start times |
| Protected records at application replacement | Before/after hashes identical for 20 designs, 4 creatives and 0 reviews |

The protected-record comparison was made around application replacement, before the explicit live image trial described below. No approval or publishing action was triggered. The final evidence in this document was added after the immutable source archive was frozen.

## Live Studio queue and import proof

An explicit Studio request for the Bangle design used four frozen reference files: the exact selected Shopify product image and three style references. The worker generated the image through the native ChatGPT tool and saved it through the guarded import path.

| Job evidence | Verified value |
| --- | --- |
| Job | `d756bdd6-19c7-42e7-8bf0-cac2f53ce4e8` |
| Design | `c28ab8b5-89d1-46ae-aaf1-c7bb277381bc` |
| Artwork request | `6a8e8d9c-3d0f-4acf-b1ef-b85cacb4bc0f` |
| Native Codex thread | `01a1875f-64a8-70a3-8473-fe871e195bfb` |
| Dispatch | 11:15:38.024283 UTC |
| Completion | 11:16:45.950275 UTC |
| PNG | 1122 × 1402 pixels; 2,130,088 bytes |
| SHA-256 | `97d0f1c086b1706ae207f6587d21f2f3db3aab6b9dc4956101b6ebca02e4aa29` |
| Saved result | Ready, ChatGPT, version 1; zero human reviews |

Full pixel decoding with Sharp and visual inspection passed. The stored object's bytes matched the generated image hash; its public URL returned HTTP 400, consistent with private storage. The authenticated Studio browser view confirmed the imported artwork and its human-review requirement. No approval was submitted.

Local evidence: [proof.json](../output/chatgpt-worker-2026-10-29/live-bangle/proof.json) and [poster.png](../output/chatgpt-worker-2026-10-29/live-bangle/poster.png). The live result used neither Higgsfield credits nor image API keys. It did not approve or publish artwork.

After the trial, only the requested Bangle design changed. The other 19 designs and all 4 creatives remained unchanged, and the review count remained zero. The comparison is recorded in [preservation-proof.json](../output/chatgpt-worker-2026-10-29/preservation-proof.json).

## Validation and recurring operation

The application changes passed 1,082 full-suite tests, TypeScript validation and the production build before the final collector fix. The revised collector and runner passed their 26 focused tests, covering exact-session output selection, receipt persistence, recovery and duplicate prevention. The successful live queue/import trial above supplies the runtime proof.

The recurring image worker started at **11:17:47.550 UTC** and logged an idle queue at **11:17:47.766 UTC**. Final inspection confirmed it running with zero restarts, an `unless-stopped` restart policy, 0.5 CPU and 1,073,741,824 bytes of RAM, and no published ports. The app remained healthy, and its separate scheduler ran the same application image and completed four ticks. An unauthenticated POST to the image-worker endpoint returned HTTP 401.

The queue runs independently of the Mac and processes authorized image requests one at a time. ChatGPT plan limits continue to apply; the worker does not provide Higgsfield Unlimited or unlimited ChatGPT usage, and has no paid fallback.

## Official documentation checked

- [Non-interactive Codex execution and ChatGPT-managed authentication](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Headless ChatGPT login](https://learn.chatgpt.com/docs/auth)
- [Built-in image generation and included usage limits](https://learn.chatgpt.com/docs/image-generation)

The prior manual-only conclusion applied to AI Office's custom token-sharing integration. The separately authenticated Codex worker now has a verified Linux generation and live Studio import path.
