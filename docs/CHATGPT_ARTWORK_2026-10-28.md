# ChatGPT artwork in AI Office

Update: Studio and conversation controls now default to [automatic Higgsfield OAuth generation using subscription credits](HIGGSFIELD_OAUTH_2026-10-28.md), including GPT Image 2.5. Native ChatGPT generation described below remains a manual import option.

AI Office prepares the artwork request. The person generates or revises the image in native ChatGPT using their plan, then imports the finished image into the matching Studio card. This workflow does not use an OpenAI image API key or Gemini generation. ChatGPT's own plan allowances still apply; AI Office cannot reset them.

## Using it

1. Request a poster or carousel in an AI Office department-head conversation, or create a request in Design Studio.
2. On the **Awaiting ChatGPT artwork** card, copy the brief and download its reference pack.
3. Unzip the pack. Open ChatGPT, attach the product photos, selected style references and previous artwork when provided, then paste the brief and generate the image.
4. Download the finished PNG, JPEG or WebP and use **Import for review** on the matching AI Office card.
5. Check the exact product, wording, logo and visual finish. Submit a human Good/Bad review in Studio. Importing alone does not approve artwork or publish a campaign.

For five-card carousels, each card has its own request and import destination. Set revisions retain order and previous previews. Conversations show the linked request and imported preview; they do not automatically operate the user's ChatGPT website or read unrelated ChatGPT conversations.

## Implementation

- `ARTWORK_PROVIDER=chatgpt` is the default. Legacy Gemini generation requires the explicit value `gemini`. In the default mode, generation entry points reject Gemini text, image and review calls, background image workers prepare handoffs, and library scans only discover metadata. Existing saved library fingerprints remain usable.
- The saved `artwork_handoff` snapshot holds the brief and source metadata under a fresh `artwork_request_id`. Copying and downloading use the same product filenames and selected references. No Drive source pixels are persisted by the handoff.
- Reference packs contain the brief, real product photographs, selected Drive reference pixels and the previous version where available. Images are bounded to 2048 pixels per side for the attachment pack, without enlargement. Product and generated artwork in storage are not resized by import.
- Imports require a signed-in authorized user, a same-origin request and a current pending request UUID. Uploads are bounded to 20 MiB and decoded as still PNG/JPEG/WebP, 256 pixels minimum per side and at most 40 megapixels.
- Uploads use unique private object paths. A database transaction locks the artwork, checks scope and revision, preserves the previous version, records importer/time and removes the previous review. Stale or conflicting requests cannot replace a newer image.
- Human reviews lock the same record and verify the displayed image path and request UUID. Approved campaign assets remain frozen; imported campaign artwork needs a Good human review before final approval.
- `chatgpt_import` records the user-selected import workflow. AI Office does not cryptographically verify which external model produced the file and does not run an automated visual quality check on it.

## Why there is a manual ChatGPT step

The existing ChatGPT-plan sign-in integration does not support the `image_generation` tool or access to the user's ChatGPT conversations. OpenAI documents this in its [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). Native ChatGPT image generation can use included plan usage; a separately billed image API is a different integration. No hosted browser scraping or authentication workaround was added.

## Verification

The release is checked with upload decoding/size/origin tests, private-request access tests, stale/concurrent import and review transaction tests, packet consistency tests, Studio and conversation interaction tests, TypeScript and the production build. Live checks are recorded after deployment.

## Live release and verification

Deployed `chatgpt-handoff-20261028-r2` to https://ai-office.parakkatjewels.in on 28 October 2026. The atomic import/review migration `20261028000300_chatgpt_artwork_import.sql` was applied successfully through the existing Supabase project. The image is `sha256:32a7e8b99048a5b54dbaaf479329415a8a20e51654a34636b8bb3e5014413547`; source manifest is `d055edaaef306e81091ffc2be6f7417e149c5b633a4697ab9dfeda832674c282` (552 files). Only AI Office's app and scheduler were updated; the 22 unrelated containers, protected environment, authentication volumes and resource/network settings were preserved. The dedicated builder was stopped.

- Full suite: 925 passing tests. Additional final UI regression checks: 9 passing tests, TypeScript clean and production build passed. Backend lifecycle/transaction fixtures include request ownership, concurrent and stale imports, review version binding and campaign freeze behavior.
- The live Fine Millennium design `859f552f-f858-4f47-8c71-94c05cc3e23f` is awaiting a ChatGPT import under request `c4b78901-aaae-4946-becc-a3de8a0f9f5b`; its previous v3 file and history are intact. Its saved brief retains exact product identity, a freshly rendered scene, existing wording and the dark chocolate/bronze direction without promotional or ceremonial additions.
- Its linked conversation is `/agents/creativeDirector?thread=83df8ca0-f84a-4ba4-80bc-6d326c01ce02#conversation`. The same request, previous preview and handoff controls are visible there.
- Both surfaces successfully downloaded the private reference pack. The final pack has seven files (brief, instructions, product photograph, three selected Drive styles and previous artwork), 11,907,840 bytes; ZIP integrity passed. Copy succeeded in the conversation. An unfocused clipboard wait in Studio safely fell back to manual copying after two seconds and left downloads/upload controls usable.
- No new image generation, live finished-image import, approval or publishing was performed for this release. Import acceptance/rejection and version transactions were exercised in automated tests; the live checks covered preparation, packet consistency, download and display. Native ChatGPT allowances were not reset or bypassed.
- Live screenshots: [Studio](proofs/chatgpt-handoff-studio.jpg) and [conversation](proofs/chatgpt-handoff-conversation.jpg).

The UI fixes in r2 prevent clipboard waiting from locking the handoff and give pending cards more space without applying gallery-card styling to their numbered steps.

Final runtime check at 07:36:16 UTC: zero Gemini API requests since the 07:19:27 deployment baseline; AI Office unpaused, app healthy, scheduler running, builder stopped, and all 22 unrelated containers unchanged.
