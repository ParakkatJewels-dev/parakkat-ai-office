-- Google closed the 2.5 models to new projects; the app now uses Gemini 3.8 Flash for text and 3.1 Flash Image for banners.
insert into usage_prices (key, in_per_m, out_per_m, per_unit, note) values
  ('gemini:gemini-3.8-flash', 0.75, 3.75, 0, 'Gemini 3.8 Flash per million tokens (thinking counts as output); rises to 1.50 / 7.50 on 1 Jan 2027'),
  ('gemini:gemini-3.1-flash-image', 0.50, 60.00, 0, 'Nano Banana 2: image output billed as tokens, about $0.067 per 1024px image')
on conflict (key) do update set in_per_m = excluded.in_per_m, out_per_m = excluded.out_per_m, note = excluded.note, updated_at = now();
update usage_prices set in_per_m = 0.75, out_per_m = 3.75, note = 'Gemini Flash text price per million tokens', updated_at = now() where key = 'gemini:*';
