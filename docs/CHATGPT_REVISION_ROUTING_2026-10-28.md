# ChatGPT artwork revision routing

Deployed `chatgpt-revision-routing-20261028-r1` to https://ai-office.parakkatjewels.in on 28 October 2026. The app became healthy at **12:56:54 UTC** and its deployment-owned maintenance pause was cleared at **12:58:06 UTC**.

## Behavior

ChatGPT-imported artwork now keeps ChatGPT as the default when requesting a revision in Studio or an agent conversation. A ChatGPT revision prepares its saved brief for generation outside AI Office and guarded import; it does not silently reserve a Higgsfield credit-based generation. An explicit provider selection or an unambiguous provider request can override that default. The same routing covers individual images and all five carousel cards, including new conversation requests that explicitly name ChatGPT.

Studio exposes a revision provider choice. A five-card revision can keep each card's saved provider or explicitly select ChatGPT or Higgsfield. Conversation and Studio artwork panels initialize from the saved artwork provider. Provider selection alone does not generate an image.

This is a routing correction. It does not add unattended ChatGPT image generation, change account limits, grant Higgsfield Unlimited access, or approve or publish artwork.

## Release evidence

| Item | Verified value |
| --- | --- |
| Frozen source files | 583 |
| Source manifest SHA-256 | `e996c88a0ea189dc2fca238df683b799828883633a6ad64d1a2315f90f15b967` |
| Source archive SHA-256 | `230fb4a3357f37a039a7054681c944b803b658528b083aef3dcee7da24109437` |
| Runtime image | `sha256:068648b315ff70e3cc06b22bf86fef746ef39e0088ca7963781ce55c1b1fd493` |
| Previous r5 image | `sha256:f6f4d641789538fc74be2aa61128464a576d5d936568033443bb78688848828c` |
| Rollback image tag | `parakkat-ai-office:before-chatgpt-revision-routing-20261028-r1` |
| Remote source | `/opt/parakkat-ai-office/releases/chatgpt-revision-routing-20261028-r1/source` |

The frozen package was compared with the deployed r5 manifest, rather than the repository's older Git baseline. Its only application/test differences are the **14 approved routing files**; seven documentation/proof files also differ. No dependency, deployment configuration, or database migration changed. `output/imagegen` was excluded from the runtime package while preserving every local image deliverable. This evidence document was written after packaging.

The complete application suite passed **1,046 tests**, with no failures, skips, or cancellations, from an independently extracted copy of the exact frozen archive. TypeScript and the isolated production Docker build passed. The dedicated builder was stopped after building.

## Live preservation checks

- The app is healthy and public `/login` returns HTTP 200. Exactly one scheduler runs the same release image.
- All **22 unrelated containers** retained their IDs, image IDs, start times, restart counts, resource settings, networks, ports, and mounts. AI Office's resource limits, networks, private credential volumes, and runtime-file metadata were unchanged. Its ChatGPT connection remains connected.
- All five cards in carousel `d01daca7-6636-4ed6-b3d6-ec5d4bf5515c` remained **ready, v4, `chatgpt_import`, error-free, with zero human reviews**. Their image paths, history, request identifiers, cached references, and saved state fingerprints were unchanged by deployment.
- The older five-card carousel and Fine Millennium v4 were also unchanged. Review and related generation-job fingerprints matched before and after; no active or uncertain generation job was present.
- Deployment made **zero image-generation requests**, ran no schema migration, and submitted no revision, approval, publication, or live chat message. No temporary probe files were installed in the running container.

The coordinating agent completed the authenticated UI check after resume: all five cards still display v4, ChatGPT artwork and the human-review notice; the selected set has no credit-error notices. Opening the first card's revision form showed ChatGPT selected by default, with the explicit Higgsfield credit option still available. The form was closed without submission. No revision, generation, review, publication or chat message was submitted during verification.

- [Five-card live Studio proof](proofs/chatgpt-carousel-v4-studio.png)
- [Live ChatGPT provider selection](proofs/chatgpt-revision-provider-live.png)

Sanitized local evidence: `/tmp/parakkat-chatgpt-revision-routing-20261028-r1-release-report.json`. The matching source review, frozen validation logs, container snapshots, artwork fingerprints, and owned-pause/resume records share that release prefix.

Related: [ChatGPT conversation generation and guarded import](CHATGPT_CONVERSATION_IMPORT_2026-10-28.md), [Higgsfield OAuth behavior and limitations](HIGGSFIELD_OAUTH_2026-10-28.md).
