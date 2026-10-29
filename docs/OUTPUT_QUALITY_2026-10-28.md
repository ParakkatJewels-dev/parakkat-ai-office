# Output quality repair — 28 October 2026

Status at the initial repair: implemented and tested locally, without inference or production changes. These repairs were subsequently deployed with the usage monitoring and Gemini Pro upgrade; see [the release record](USAGE_AND_IMAGE_QUALITY_2026-10-28.md) for current production status and validation. The findings and limits below describe the initial repair's scope.

## Findings and repairs

- Conversation synthesis shortened completed specialist responses from the accepted 6,000-character limit to 1,800 characters. Final answers could therefore lose deliverables and qualifications at the end. Current-task contributions now reach the next specialist and final writer in full within the existing saved-response bound.
- Revision requests such as “Make it more premium” could lose the original brief, source scope and intermediate manager constraints. Follow-ups now retain that context, specialists receive the relevant private-thread history, and repeated revision requests cannot reuse an earlier cached answer. Older history stays bounded to 10,000 characters; any middle omission is explicitly marked and retains the beginning and end. The thread still reads at most 16 recent messages.
- Head-task review and independent QC compressed an already bounded evidence snapshot again to 4,000 characters. This could remove detailed rows needed to verify a draft. Both now receive the saved snapshot intact. A second specialist also receives the full validated peer contribution and its warnings.
- Library fingerprints used a final 2,200-character cut that could remove palette, lighting, typography, production notes and constraints after long introductory fields. The same total budget is now shared across every populated category, preserving short fields and fairly shortening long fields.
- Normal designs could silently skip Creative Director direction when the text provider was unavailable or failed. They now stop before any image request unless valid art direction is available. Auto-written headlines must also be valid nonempty text.
- Normal image review now receives the brief, format, concept, manager feedback and saved style fingerprints alongside the product photos. It checks composition, readability, spacing, rendering defects, uncertainty and unrequested claim badges.
- Carousel review previously judged jewellery identity only. It now separately requires product fidelity, visual finish and compliance with the requested direction, with the style reference visible to the reviewer. Malformed or failed checks cannot approve a card; one correction remains the maximum.

## Validation

- Full local suite: **826 tests passed, none failed or skipped**.
- TypeScript checking passed.
- Optimized production build passed.
- Whitespace checking passed.
- Regression fixtures exercise complete specialist handoffs, original and intermediate revision requirements, cached-edit prevention, exact review evidence, preserved fingerprint categories, malformed headlines, unavailable art direction and independent carousel quality decisions. Provider responses are mocked.

## Remaining limits

These checks establish information preservation and review behavior; they do not establish subjective output quality or quality parity between providers. A fresh visual and writing comparison is still needed after deployment and when the applicable allowance permits it.

The carousel renderer still uses a fixed typography/layout overlay. Regenerating its photographic scene cannot repair a defect in that fixed overlay. Existing text-only brand-reference storage and product-rendering behavior were preserved. Legacy short fingerprints are not enriched automatically by this patch.

More complete context and the carousel style image can use more tokens. Existing input and usage guards remain in force; an oversized task stops before inference instead of silently dropping its evidence. No budget increase or provider switch is included.

The reported “AI Office has reached its image-request allowance” message originates in the application's image reservation guard. It is separate from any provider quota; this repair does not reset either allowance.
