-- Gemini now answers the agents' text work when OpenAI cannot, so price its text models explicitly.
insert into usage_prices (key, in_per_m, out_per_m, per_unit, note) values
  ('gemini:gemini-2.5-pro', 1.25, 10.00, 0, 'Gemini 2.5 Pro per million tokens (prompts up to 200k); for GEMINI_MANAGER_MODEL if you set it'),
  ('gemini:gemini-2.5-flash', 0.30, 2.50, 0, 'Gemini 2.5 Flash per million tokens; used by workers when OpenAI is unavailable')
on conflict (key) do nothing;
