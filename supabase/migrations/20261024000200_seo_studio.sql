-- SEO Desk (Google Trends + Keyword Planner) and the Design Studio (banners and posters on request).

insert into departments (id, name, building, human_head_role, ai_lead_agent) values
  ('seo', 'SEO Desk', 'Parakkat Intelligence Centre', 'ecom_manager', 'seoLead')
on conflict (id) do update set name = excluded.name, building = excluded.building, ai_lead_agent = excluded.ai_lead_agent;

insert into agents (id, name, role_desc, department_id, is_lead, model) values
  ('seoLead', 'SEO Lead', 'Head of the SEO Desk', 'seo', true, 'OpenAI GPT, manager tier'),
  ('trendsAnalyst', 'Google Trends Analyst', 'Rising and falling searches in Kerala', 'seo', false, 'OpenAI GPT, worker tier'),
  ('keywordResearcher', 'Keyword Researcher', 'Search volumes from Keyword Planner', 'seo', false, 'OpenAI GPT, worker tier'),
  ('seoWriter', 'SEO Content Writer', 'Product titles, meta descriptions, blog topics', 'seo', false, 'OpenAI GPT, worker tier')
on conflict (id) do update set name = excluded.name, role_desc = excluded.role_desc, department_id = excluded.department_id, is_lead = excluded.is_lead, model = excluded.model;

insert into connections (provider) values ('google_trends'), ('keyword_planner') on conflict do nothing;

-- One row per search term. Keyword Planner fills volumes and bids; Google Trends fills interest and direction.
create table seo_keywords (
  keyword text primary key,
  avg_monthly_searches integer,
  competition text,                       -- LOW | MEDIUM | HIGH from Keyword Planner
  bid_low numeric,                        -- top-of-page bid range in rupees
  bid_high numeric,
  monthly jsonb,                          -- [{month, searches}] from Keyword Planner
  trend_interest integer,                 -- latest Google Trends interest, 0 to 100
  trend_change numeric,                   -- last 4 weeks against the 4 before, in percent
  trend_series jsonb,                     -- [{date, value}] from Google Trends
  rising boolean not null default false,  -- appeared as a rising related query
  source text[] not null default '{}',    -- keyword_planner, google_trends
  updated_at timestamptz not null default now()
);
alter table seo_keywords enable row level security;
create policy "signed-in read" on seo_keywords for select using (auth.uid() is not null);

-- Banners and posters the Creative House makes on request, outside a campaign.
create table designs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users,
  format text not null,                   -- post | story | poster | web_banner
  brief text not null,
  headline text,
  language text not null default 'en',
  product_ids bigint[] not null default '{}',
  image_path text,                        -- Supabase Storage path in the creatives bucket
  status text not null default 'making',  -- making | ready | needs_fix | failed
  review_note text,                       -- the Creative Director AI's check
  error text,
  created_at timestamptz not null default now()
);
alter table designs enable row level security;
create policy "creative heads and admin read" on designs for select using (is_admin() or 'creative' in (select my_depts()));
create index designs_created on designs (created_at desc);
