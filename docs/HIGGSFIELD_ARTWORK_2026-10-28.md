# Higgsfield artwork handoff — 28 October 2026

Historical release record: [automatic Higgsfield OAuth generation](HIGGSFIELD_OAUTH_2026-10-28.md) now supersedes this manual workflow as the primary path in Studio and chat. The website/import flow remains a fallback.

Design Studio and the existing conversation artwork card now offer ChatGPT or Higgsfield for manual website generation. The Higgsfield link opens `https://higgsfield.ai/ai/image?model=nano-banana-pro`, the URL supplied in the user's screenshot. This is a website link, not an OAuth connection or an automated image request.

1. Select Higgsfield in the pending artwork card.
2. Copy the brief and download/unzip the reference pack.
3. Open Higgsfield, attach the reference images and paste the brief. Enable Unlimited and confirm that the generate button says Unlimited. Model and resolution eligibility depend on the user's current plan.
4. Download the completed image and use Import for review on the same card.

The same request UUID, cached brief, selected product photos and style references work with either service. Switching providers does not change the design request or its previous image. It clears the local file selection to avoid attributing an already-selected upload to the wrong provider. The pack's README follows the selected provider.

Imports use the existing private storage and human review lifecycle. The multipart provider is allowlisted as `chatgpt` or `higgsfield`; absent provider defaults to ChatGPT for older open forms. New storage objects use the corresponding `chatgpt-imports/` or `higgsfield-imports/` prefix. Provider provenance is selected by the uploader, not cryptographic verification of the generating model.

Migration `20261028000400_higgsfield_artwork_import.sql` adds the service-only `commit_external_artwork_import` transaction and preserves the previous ChatGPT RPC as a wrapper. Both origins invalidate older reviews, preserve version audit metadata, reject stale request IDs and frozen campaigns, and require a fresh human Good review before campaign approval. No existing design, image, request ID or cached brief is rewritten by this migration.

Gemini stays disabled in the default manual handoff mode. No paid Higgsfield connector, account credential, API billing or automated generation was added. The connected Higgsfield account was previously checked: its website Unlimited entitlement did not provide an active connector unlimited allowance, and image cost estimates required credits. Public reference: https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp

Validation: 948 tests passed, including provider path/provenance validation, frozen brief reuse, import/review transaction privileges, human campaign review gates for both providers, and Studio/conversation controls. A completed artwork was not generated or imported as a live test.

## Live verification

Deployed `higgsfield-handoff-20261028-r1` to https://ai-office.parakkatjewels.in on 28 October 2026. Image: `sha256:9cc59c6dac7b0ac600e6906be314a7ced11befc88609c3b44637807a79461590`. Frozen source manifest: `c9e19c8db0497815352924cc0d38dbd3e65aa1f03d8ca499e1dd524db1629a86` (556 files). App healthy, scheduler running, builder stopped, 22 unrelated containers unchanged. The new import RPC, legacy wrapper and review schema were verified. Gemini usage remained zero since the original handoff baseline.

The live Fine Millennium card was switched to Higgsfield; Copy brief and Download reference pack worked. The 11,908,126-byte ZIP had seven intact files and the Higgsfield README, retaining request `c4b78901-aaae-4946-becc-a3de8a0f9f5b` and the same frozen brief. The Open Higgsfield link opened the Nano Banana Pro image page. That browser profile was signed out of Higgsfield; no login or generation was submitted. The linked private Creative Director conversation also displayed and switched the provider controls correctly. Screenshot: `docs/proofs/higgsfield-handoff-studio.jpg`.

Operational report: `/tmp/parakkat-higgsfield-release-report.json`. Pack verification: `/tmp/parakkat-higgsfield-pack-proof.json`. Live migration query: https://supabase.com/dashboard/project/gcctwmavpitooogjfdkk/sql/bc8ae889-ff80-48fd-81f1-a58e62e0b367 .
