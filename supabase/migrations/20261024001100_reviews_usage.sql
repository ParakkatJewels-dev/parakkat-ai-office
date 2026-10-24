-- 1. Heads' reviews of AI images (Design Studio orders and campaign banners). Each review also becomes a lesson.
alter table creatives add column if not exists created_at timestamptz not null default now();

create table if not exists image_reviews (
  source text not null check (source in ('design', 'creative')),
  item_id uuid not null,
  verdict text not null check (verdict in ('good', 'bad')),
  note text,
  reviewer uuid references auth.users on delete set null,
  reviewer_role app_role,
  updated_at timestamptz not null default now(),
  primary key (source, item_id)
);
alter table image_reviews enable row level security;
create policy "creative heads and admin read" on image_reviews for select using (is_admin() or 'creative' in (select my_depts()));
grant select on image_reviews to authenticated;
grant all on image_reviews to service_role;

-- Every AI image in one list, newest first, with its review. Reads through each table's own row-level security.
create or replace view ai_images with (security_invoker = true) as
  select x.*, r.verdict, r.note as review, r.reviewer_role, r.updated_at as reviewed_at
  from (
    select 'design'::text as source, d.id, d.format as kind, d.brief, d.headline, d.language, d.image_path, d.status,
           d.review_note as lead_note, d.error, d.created_at, null::uuid as campaign_id, null::text as campaign_name
    from designs d
    union all
    select 'creative', c.id, c.kind, coalesce(c.body, ''), c.headline, c.language, c.image_path, c.status,
           null, null, c.created_at, c.campaign_id, cp.name
    from creatives c left join campaigns cp on cp.id = c.campaign_id
    where c.image_path is not null
  ) x left join image_reviews r on r.source = x.source and r.item_id = x.id;
grant select on ai_images to authenticated;

-- 2. Usage and billing: one row per paid AI or API call, with its estimated cost. Super Admin only.
create table if not exists api_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  provider text not null,                 -- openai | gemini | jev | serpapi
  model text,
  agent_id text,
  dept text,
  run_id uuid,
  feature text,                           -- campaign | seo | design | autopilot:<job> | ...
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  units integer not null default 1,       -- images or calls
  cost_usd numeric not null default 0,
  ok boolean not null default true,
  ms integer
);
create index if not exists api_usage_at on api_usage (at desc);
create index if not exists api_usage_run on api_usage (run_id) where run_id is not null;
alter table api_usage enable row level security;
create policy "admin reads usage" on api_usage for select using (is_admin());

-- List prices, editable on the Usage page. Per million tokens, or per call/image.
create table if not exists usage_prices (
  key text primary key,                   -- provider:model, or provider:* for a default
  in_per_m numeric not null default 0,
  out_per_m numeric not null default 0,
  per_unit numeric not null default 0,
  note text,
  updated_at timestamptz not null default now()
);
alter table usage_prices enable row level security;
create policy "admin reads prices" on usage_prices for select using (is_admin());
insert into usage_prices (key, in_per_m, out_per_m, per_unit, note) values
  ('openai:gpt-4.1', 2.00, 8.00, 0, 'OpenAI list price per million tokens; check platform.openai.com/pricing'),
  ('openai:gpt-4.1-mini', 0.40, 1.60, 0, 'OpenAI list price per million tokens'),
  ('openai:*', 2.00, 8.00, 0, 'Used for any other OpenAI model until you add its price'),
  ('gemini:gemini-2.5-flash-image', 0.30, 30.00, 0, 'Image output is billed as tokens (about 1,290 per image, roughly $0.039)'),
  ('gemini:*', 0.30, 2.50, 0, 'Gemini Flash text price per million tokens'),
  ('jev:*', 0, 0, 0, 'Enter the price per call from your TypeSafe AI plan'),
  ('serpapi:*', 0, 0, 0.015, 'SerpApi Developer plan: $75 for 5,000 searches')
on conflict (key) do nothing;

-- Monthly plans that do not depend on usage (Vercel, Supabase, domains...), entered by hand.
create table if not exists fixed_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  monthly_usd numeric not null default 0,
  note text,
  active boolean not null default true
);
alter table fixed_costs enable row level security;
create policy "admin reads fixed costs" on fixed_costs for select using (is_admin());
insert into fixed_costs (name, monthly_usd, note)
  select * from (values ('Vercel Pro', 20, 'Per team member; check vercel.com/account/billing'), ('Supabase Pro', 25, 'Plus compute and usage over the plan; check supabase.com/dashboard/org/_/billing')) v
  where not exists (select 1 from fixed_costs);

create table if not exists billing_settings (
  id int primary key default 1 check (id = 1),
  usd_inr numeric not null default 88,
  monthly_budget_inr numeric,
  alert_pct int not null default 80,
  alerted_month text                      -- the month an alert was last sent, so it is sent once
);
alter table billing_settings enable row level security;
create policy "admin reads billing settings" on billing_settings for select using (is_admin());
insert into billing_settings (id) values (1) on conflict do nothing;

revoke all on api_usage, usage_prices, fixed_costs, billing_settings from anon;
grant select on api_usage, usage_prices, fixed_costs, billing_settings to authenticated;
grant all on api_usage, usage_prices, fixed_costs, billing_settings to service_role;
grant usage on sequence api_usage_id_seq to service_role;

-- Usage summed in the database for a date range: totals, and breakdowns by provider, agent, team, feature, campaign and day.
create or replace function usage_report(p_from date, p_to date) returns jsonb
  language sql stable security invoker set search_path = public
  as $$
  with u as (select * from api_usage where at >= p_from and at < p_to + 1)
  select jsonb_build_object(
    'calls', (select count(*) from u),
    'failed', (select count(*) from u where not ok),
    'cost_usd', (select coalesce(sum(cost_usd), 0) from u),
    'input_tokens', (select coalesce(sum(input_tokens), 0) from u),
    'output_tokens', (select coalesce(sum(output_tokens), 0) from u),
    'images', (select coalesce(sum(units), 0) from u where provider = 'gemini' and model like '%image%'),
    'by_model', coalesce((select jsonb_agg(x order by x.cost_usd desc) from (select provider, model, count(*) calls, sum(input_tokens) input_tokens, sum(output_tokens) output_tokens, sum(units) units, sum(cost_usd) cost_usd from u group by 1, 2) x), '[]'),
    'by_agent', coalesce((select jsonb_agg(x order by x.cost_usd desc) from (select coalesce(agent_id, 'unknown') agent_id, max(dept) dept, count(*) calls, sum(cost_usd) cost_usd from u group by 1 order by 4 desc limit 25) x), '[]'),
    'by_dept', coalesce((select jsonb_agg(x order by x.cost_usd desc) from (select coalesce(dept, 'other') dept, count(*) calls, sum(cost_usd) cost_usd from u group by 1) x), '[]'),
    'by_feature', coalesce((select jsonb_agg(x order by x.cost_usd desc) from (select coalesce(feature, 'other') feature, count(*) calls, sum(cost_usd) cost_usd from u group by 1) x), '[]'),
    'by_run', coalesce((select jsonb_agg(x order by x.cost_usd desc) from (select u.run_id, max(r.kind) kind, max(r.occasion) occasion, count(*) calls, sum(u.cost_usd) cost_usd
                         from u left join agent_runs r on r.id = u.run_id where u.run_id is not null group by u.run_id order by 5 desc limit 15) x), '[]'),
    'by_day', coalesce((select jsonb_agg(jsonb_build_array(d, c) order by d) from (select at::date d, sum(cost_usd) c from u group by 1) x), '[]'))
$$;
revoke execute on function usage_report(date, date) from public, anon;
grant execute on function usage_report(date, date) to authenticated, service_role;
