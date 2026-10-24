-- Parakkat AI Office: core schema.
-- Agents run on the server with the service role key and bypass RLS. People sign in and only ever read
-- through the policies below; their decisions go through the security-definer functions at the end.

create extension if not exists pgcrypto;

-- ---------- people ----------
create type app_role as enum ('super_admin', 'creative_head', 'ecom_manager', 'perf_marketer', 'viewer');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role app_role not null default 'viewer',
  created_at timestamptz not null default now()
);

create or replace function my_role() returns app_role
  language sql stable security definer set search_path = public
  as $$ select coalesce((select role from profiles where id = auth.uid()), 'viewer'::app_role) $$;

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select my_role() = 'super_admin' $$;

-- new sign-ups get a profile; the Super Admin assigns roles
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
  as $$ begin insert into profiles (id, full_name) values (new.id, new.raw_user_meta_data ->> 'full_name'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------- org: buildings, departments, agents ----------
create table departments (
  id text primary key,                    -- matches room ids in src/office/roster.mjs
  name text not null,
  building text not null,
  human_head_role app_role not null,      -- who this department reports to; the Super Admin can reassign
  ai_lead_agent text                      -- the AI team lead who reviews every staff report
);

create table agents (
  id text primary key,                    -- matches person ids in src/office/roster.mjs
  name text not null,
  role_desc text not null,
  department_id text not null references departments,
  is_lead boolean not null default false,
  model text not null,
  enabled boolean not null default true
);

-- departments the signed-in head can see (all of them for the Super Admin)
create or replace function my_depts() returns setof text
  language sql stable security definer set search_path = public
  as $$ select id from departments where is_admin() or human_head_role = my_role() $$;

-- ---------- data from connected platforms ----------
create table connections (
  provider text primary key,              -- shopify, meta, instagram, google_ads, ga4, triple_whale, openai, gemini, jev
  status text not null default 'not_connected',
  account_ref text,                       -- shop domain, ad account id, customer id... never a secret
  last_synced_at timestamptz,
  last_error text
);

create table products (
  id bigint primary key,                  -- Shopify numeric id
  title text not null,
  handle text,
  product_type text,
  tags text[] not null default '{}',
  price numeric,
  image_url text,
  inventory integer,
  status text,
  updated_at timestamptz
);

create table orders_daily (
  day date not null,
  product_id bigint not null,
  units integer not null default 0,
  revenue numeric not null default 0,
  primary key (day, product_id)
);

create table ad_insights_daily (
  day date not null,
  platform text not null,                 -- meta | google
  campaign_id text,
  campaign_name text,
  ad_id text not null,
  ad_name text,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  purchases numeric not null default 0,
  revenue numeric not null default 0,
  primary key (day, platform, ad_id)
);

create table social_posts (
  id text primary key,
  platform text not null,                 -- instagram | facebook
  permalink text,
  caption text,
  media_type text,
  media_url text,
  posted_at timestamptz,
  reach bigint, saves bigint, likes bigint, comments bigint, shares bigint,
  attributed_orders integer,
  updated_at timestamptz not null default now()
);

create table competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  instagram_handle text,
  website text,
  facebook_page_id text,
  notes text,
  created_at timestamptz not null default now()
);

create table competitor_moves (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid references competitors on delete cascade,
  seen_at timestamptz not null default now(),
  kind text not null,                     -- offer | creative | channel | search | product | price
  summary text not null,
  source_url text,
  score numeric,                          -- how much it matters, from Jev or the fallback classifier
  raw jsonb
);

-- ---------- agent work ----------
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                     -- campaign | daily_sync | competitor_scan
  occasion text,
  stage text not null default 'queued',
  state jsonb not null default '{}',
  status text not null default 'running', -- running | waiting | done | failed
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Everything that happens between agents. Drives the 3D office and the chatter feed.
create table agent_events (
  id bigint generated always as identity primary key,
  run_id uuid references agent_runs on delete cascade,
  at timestamptz not null default now(),
  kind text not null,                     -- think | say | walk | feedback | report | approval | live
  from_agent text references agents,
  to_agent text references agents,
  from_dept text references departments,
  to_dept text references departments,
  text text not null,
  payload jsonb
);
create index agent_events_at on agent_events (at desc);

-- A staff report travels: staff -> AI team lead -> human head.
create type report_status as enum ('lead_review', 'revise', 'rejected_by_lead', 'with_head', 'accepted', 'sent_back', 'rejected');
create table reports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs on delete set null,
  department_id text not null references departments,
  author_agent text not null references agents,
  lead_agent text references agents,
  title text not null,
  body text not null,
  data jsonb,
  status report_status not null default 'lead_review',
  revision integer not null default 1,
  lead_note text,
  head_note text,
  decided_by uuid references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs on delete set null,
  name text not null,
  occasion text,
  plan jsonb not null,                    -- brief, audiences, budget split, reasons
  budget_daily numeric,
  start_date date,
  end_date date,
  channels text[] not null default '{}',
  status text not null default 'draft',   -- draft | in_approval | approved | live | changes | rejected
  external_ids jsonb,                     -- ids created on Meta and Google after publishing
  created_at timestamptz not null default now()
);

create table creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns on delete cascade,
  kind text not null,                     -- banner | story | reel_script | catalogue_page | email
  language text not null default 'en',
  headline text,
  body text,
  image_path text,                        -- Supabase Storage path in the creatives bucket
  product_ids bigint[] not null default '{}',
  score numeric,
  status text not null default 'draft'
);

-- A campaign plan travels: AI CMO -> the heads it touches -> Super Admin, who alone can publish.
create table approvals (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns on delete cascade,
  version integer not null default 1,
  required_roles app_role[] not null,     -- department heads this plan touches
  status text not null default 'pending', -- pending | changes | rejected | approved | published
  created_at timestamptz not null default now()
);

create table approval_steps (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references approvals on delete cascade,
  role app_role not null,
  decision text not null check (decision in ('approve', 'changes', 'reject')),
  note text,
  user_id uuid not null references auth.users,
  decided_at timestamptz not null default now(),
  unique (approval_id, role)
);

-- ---------- row-level security ----------
alter table profiles enable row level security;
alter table departments enable row level security;
alter table agents enable row level security;
alter table connections enable row level security;
alter table products enable row level security;
alter table orders_daily enable row level security;
alter table ad_insights_daily enable row level security;
alter table social_posts enable row level security;
alter table competitors enable row level security;
alter table competitor_moves enable row level security;
alter table agent_runs enable row level security;
alter table agent_events enable row level security;
alter table reports enable row level security;
alter table campaigns enable row level security;
alter table creatives enable row level security;
alter table approvals enable row level security;
alter table approval_steps enable row level security;

create policy "see own profile, admin sees all" on profiles for select using (id = auth.uid() or is_admin());
create policy "admin sets roles" on profiles for update using (is_admin());

create policy "signed-in read" on departments for select using (auth.uid() is not null);
create policy "admin reassigns heads" on departments for update using (is_admin());
create policy "signed-in read" on agents for select using (auth.uid() is not null);
create policy "admin read" on connections for select using (is_admin());
create policy "admin read" on agent_runs for select using (is_admin());

-- business data every head may use for their own work
create policy "signed-in read" on products for select using (auth.uid() is not null);
create policy "signed-in read" on orders_daily for select using (auth.uid() is not null);
create policy "signed-in read" on ad_insights_daily for select using (auth.uid() is not null);
create policy "signed-in read" on social_posts for select using (auth.uid() is not null);
create policy "signed-in read" on competitors for select using (auth.uid() is not null);
create policy "signed-in read" on competitor_moves for select using (auth.uid() is not null);

-- Heads see conversations inside their departments and any conversation one of their departments takes part in.
-- Talk between two other teams stays hidden. This also filters Realtime, so the office only animates what you may see.
create policy "own departments and conversations with them" on agent_events for select
  using (is_admin() or from_dept in (select my_depts()) or to_dept in (select my_depts()));

-- Heads see a report only once their AI team lead has forwarded it.
create policy "forwarded reports for my departments" on reports for select
  using (is_admin() or (department_id in (select my_depts()) and status in ('with_head', 'accepted', 'sent_back', 'rejected')));

create policy "plans that touch me" on approvals for select using (is_admin() or my_role() = any (required_roles));
create policy "steps of plans that touch me" on approval_steps for select
  using (exists (select 1 from approvals a where a.id = approval_id and (is_admin() or my_role() = any (a.required_roles))));
create policy "campaigns that touch me" on campaigns for select
  using (is_admin() or exists (select 1 from approvals a where a.campaign_id = campaigns.id and my_role() = any (a.required_roles)));
create policy "creatives of campaigns that touch me" on creatives for select
  using (is_admin() or exists (select 1 from approvals a where a.campaign_id = creatives.campaign_id and my_role() = any (a.required_roles)));

-- ---------- decisions people make ----------
-- A head accepts, sends back or rejects a report forwarded to them.
create or replace function decide_report(p_report uuid, p_decision text, p_note text default null) returns report_status
  language plpgsql security definer set search_path = public
  as $$
declare r reports; s report_status;
begin
  select * into r from reports where id = p_report for update;
  if r is null or r.status <> 'with_head' then raise exception 'This report is not waiting on a head'; end if;
  if not (is_admin() or r.department_id in (select my_depts())) then raise exception 'Not your department'; end if;
  if p_decision <> 'accept' and coalesce(trim(p_note), '') = '' then raise exception 'Add a note so the team lead knows why'; end if;
  s := case p_decision when 'accept' then 'accepted' when 'send_back' then 'sent_back' when 'reject' then 'rejected' end;
  if s is null then raise exception 'Unknown decision %', p_decision; end if;
  update reports set status = s, head_note = p_note, decided_by = auth.uid(), updated_at = now() where id = p_report;
  insert into agent_events (kind, to_agent, from_dept, to_dept, text, payload)
    values (case when s = 'accepted' then 'say' else 'feedback' end, r.lead_agent, 'lead', r.department_id,
            initcap(replace(p_decision, '_', ' ')) || ': ' || r.title || coalesce(' — ' || p_note, ''), jsonb_build_object('report_id', r.id, 'by_role', my_role()));
  return s;
end $$;

-- A head or the Super Admin signs a campaign plan. Heads go first; the Super Admin signs last.
-- Returns the approval status; 'approved' means the server may now publish.
create or replace function decide_approval(p_approval uuid, p_decision text, p_note text default null) returns text
  language plpgsql security definer set search_path = public
  as $$
declare a approvals; me app_role := my_role(); heads_left int; st text;
begin
  select * into a from approvals where id = p_approval for update;
  if a is null or a.status <> 'pending' then raise exception 'This plan is not waiting on anyone'; end if;
  if p_decision not in ('approve', 'changes', 'reject') then raise exception 'Unknown decision %', p_decision; end if;
  if p_decision <> 'approve' and coalesce(trim(p_note), '') = '' then raise exception 'Add a note so the team knows why'; end if;
  select count(*) into heads_left from unnest(a.required_roles) h
    where not exists (select 1 from approval_steps s where s.approval_id = a.id and s.role = h and s.decision = 'approve');
  if me = 'super_admin' then
    if heads_left > 0 and p_decision = 'approve' then raise exception 'Department heads have not all approved yet'; end if;
  elsif not (me = any (a.required_roles)) then raise exception 'This plan does not need your approval';
  elsif exists (select 1 from approval_steps s where s.approval_id = a.id and s.role = me) then raise exception 'You already decided on this plan';
  end if;
  insert into approval_steps (approval_id, role, decision, note, user_id) values (a.id, me, p_decision, p_note, auth.uid())
    on conflict (approval_id, role) do update set decision = excluded.decision, note = excluded.note, user_id = excluded.user_id, decided_at = now();
  st := case when p_decision = 'changes' then 'changes' when p_decision = 'reject' then 'rejected'
             when me = 'super_admin' then 'approved' else 'pending' end;
  update approvals set status = st where id = a.id;
  update campaigns set status = case st when 'approved' then 'approved' when 'pending' then 'in_approval' else st end where id = a.campaign_id;
  insert into agent_events (kind, from_dept, to_dept, to_agent, text, payload)
    values ('approval', 'lead', 'board', 'cmo', initcap(p_decision) || ' by ' || replace(me::text, '_', ' ') || coalesce(': ' || p_note, ''), jsonb_build_object('approval_id', a.id, 'by_role', me));
  return st;
end $$;

grant execute on function decide_report(uuid, text, text) to authenticated;
grant execute on function decide_approval(uuid, text, text) to authenticated;

-- ---------- realtime and storage ----------
alter publication supabase_realtime add table agent_events, reports, approvals;
insert into storage.buckets (id, name, public) values ('creatives', 'creatives', false) on conflict do nothing;
create policy "signed-in read creatives" on storage.objects for select using (bucket_id = 'creatives' and auth.uid() is not null);
