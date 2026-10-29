# Automatic Higgsfield artwork

The user authorized automatic image generation using existing Higgsfield subscription credits, without separate API billing. This supersedes the manual Higgsfield handoff as the primary image workflow. Native ChatGPT subscription image generation remains a manual import option because the supported ChatGPT OAuth integration does not expose image generation.

## Behavior

- A Super Admin connects Higgsfield in Settings through its official OAuth authorization flow. AI Office saves encrypted renewable credentials in the existing private provider-secrets volume; browser responses never contain those credentials.
- Explicit new artwork and revision requests in Studio and agent conversations reserve durable background jobs. Connecting an account, loading a gallery, and refreshing a reference brief do not start generation. Five-card requests authorize five separate images.
- Default: `gpt_image_2_5`, Sunburst, high quality, 2K. Alternative: `nano_banana_pro`, 2K. Live model metadata must support the chosen aspect ratio and reference inputs. No silent quality downgrade or provider fallback is requested.
- AI Office quotes subscription credits before uploads and again before generation. It requests `use_unlim:false`. Website Unlimited is not used by this integration. No separate OpenAI or Higgsfield API key is configured.
- The exact product photos, verified saved design references and previous artwork accompany the saved revision brief. Reference identity and request nonce are checked again immediately before submission.
- Finished images are downloaded, fully decoded and saved at immutable private storage paths. They appear in Studio and chat. A new human Good review is required before campaign approval; completion does not claim automated visual quality verification.

## Recovery and spending

One generation job is allowed per artwork revision. The database records submission intent before the provider call and uses expiring leases to exclude duplicate workers. A submission with an unknown outcome becomes `uncertain` and is never automatically replayed. Known provider IDs are polled and collected without creating replacement generations. The worker revalidates its lease before the chargeable call.

Insufficient credits or a known preparation failure blocks generation before submission. An explicit retry may requeue a safe pre-submission block. Failed or uncertain submissions require a new revision after checking the original provider job. Estimates are recorded as estimates, not asserted as actual billed credits or zero-dollar usage.

When the account preference requests automatic projects, a durable destination is reused for a conversation or Studio artwork group. An ambiguous project-creation response is retained for reconciliation rather than silently creating duplicate projects.

Media transfer uses HTTPS with public DNS answers pinned to the TLS request, no redirects, and no forwarded OAuth cookies or headers. Downloaded images must be still PNG, JPEG or WebP, at least 256 pixels on each side, at most 40 megapixels and 20 MiB.

## Operations

Migration: `supabase/migrations/20261028000500_higgsfield_generation.sql`. Job/project tables and lifecycle RPCs are service-only. OAuth credential location: `GEMINI_CONFIG_DIR/higgsfield/credentials.enc` (existing provider volume); encryption uses `CREDENTIALS_KEY`, with the existing service key fallback. No secrets belong in this document or source control.

The scheduler advances only explicitly reserved jobs. Gemini remains disabled in the non-Gemini artwork mode. The office pause switch stops new submissions at the next check. Existing provider work can still finish remotely while paused and can be collected after resume.

The migration can precede the app update because it does not rewrite old artwork or start work. After provider submissions exist, rollback must preserve and reconcile the job ledger; the old manual release cannot collect the new jobs. Never clear a submitted/uncertain job to force a retry.

## Verified native MCP contract

AI Office's OAuth client receives Higgsfield's generic MCP catalog, which differs from the ChatGPT connector. The transport maps the worker's model lookup to `models_explore({action:'get',model_id})` and its cost estimate to `generate_image({params:{...requested,get_cost:true}})`. The final `get_cost:true` cannot be overridden by callers. The provider describes that flag as returning cost without submitting a job; an unexpected job receipt during a quote instead stops the worker as uncertain. Actual generation remains a separate call with no automatic resubmission.

Both verified model descriptors require `medias[].role='image_references'`. Uploaded reference UUIDs are passed in the saved input order. Provider UUID versions 1–8 are accepted; internal artwork and revision identifiers keep their separate validation.

Read-only checks through the app's own OAuth connection on 28 October 2026 verified an Ultimate account, zero credits, and no available MCP Unlimited allowance. A single 4:5 image costs an estimated 2.75 credits for GPT Image 2.5 Sunburst/high/2K, or 2 credits for Nano Banana Pro/2K. The account preference does not create projects automatically. No image, reference upload or project was created during these checks.

## Provider references

- [Higgsfield MCP](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp)
- [Connecting an AI agent](https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent)
- [ChatGPT OAuth preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## Live deployment and validation

Deployed `higgsfield-oauth-20261028-r5` to https://ai-office.parakkatjewels.in on 28 October 2026; maintenance was cleared at 11:33 UTC. Runtime image: `sha256:f6f4d641789538fc74be2aa61128464a576d5d936568033443bb78688848828c`. Frozen source manifest: `ce30dcd09837651dc69f43c6d030d97f7c4d3079d292de44f96c54959e5d23ba` (576 files). This evidence section and historical-document links were completed after runtime packaging.

The app is healthy, the scheduler is running once, and the builder is stopped. All 22 unrelated containers and existing resource/network/private-volume settings are unchanged. The connected account survived restart. Temporary verification code was removed. Generation jobs and projects remained zero, and Gemini usage did not increase. Application text and image rolling caps remain disabled; provider account limits still apply.

The full application suite passed 1,023 tests before the final compatibility changes. The final authentication, transport and worker checks passed 47 tests after those changes; TypeScript and the production build passed. Earlier focused database and Studio/conversation checks also passed. Live checks used only model discovery, balance and cost-only quotes; actual image generation and visual output quality remain unverified because the connected account has zero credits.

Studio and the existing Creative Director conversation both displayed the connected account, GPT Image 2.5, the 2.75-credit estimate and the zero-credit notice. Selecting Nano Banana Pro in Studio displayed 2 credits, and the selection was returned to GPT Image 2.5. Generate was disabled at zero balance. The previous artwork and request were retained; no message or generation was submitted during UI checks.

- [Studio verification](proofs/higgsfield-oauth-studio.png)
- [Conversation verification](proofs/higgsfield-oauth-chat.png)
- Detailed local release report: `/tmp/parakkat-higgsfield-oauth-r5-release-report.json`
