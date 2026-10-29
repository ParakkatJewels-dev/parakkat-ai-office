-- Separate final image charges from text/thinking tokens; interim thought images are not charged.
-- https://ai.google.dev/gemini-api/docs/pricing (standard, verified 2026-10-28)
alter table api_usage add column if not exists cost_note text;
comment on column api_usage.cost_note is 'Explanation when a cost estimate uses incomplete provider token or modality metadata.';

insert into usage_prices (key, in_per_m, out_per_m, per_unit, note) values
  ('gemini:gemini-3-pro-image', 2, 12, 0, 'Pro input $2/M; text and thinking $12/M. Final images are charged separately using the resolution price rows. https://ai.google.dev/gemini-api/docs/pricing'),
  ('gemini:gemini-3-pro-image-image-2k', 0, 0, 0.134, 'Pro final image at 1K or 2K, per image. Interim thought images are not charged. https://ai.google.dev/gemini-api/docs/pricing'),
  ('gemini:gemini-3-pro-image-image-4k', 0, 0, 0.24, 'Pro final image at 4K, per image. Interim thought images are not charged. https://ai.google.dev/gemini-api/docs/pricing')
on conflict (key) do nothing;
