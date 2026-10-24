-- Built for volume: indexes on the columns every page filters and sorts by, and totals worked out in the database.
-- PostgREST returns at most 1000 rows a request, so summing raw rows in the app goes wrong once a store has real data.
-- Every function runs as the caller (security invoker), so row-level security still decides what each head sees.

-- ---------- indexes ----------
create index if not exists orders_daily_product on orders_daily (product_id, day);
create index if not exists ad_insights_campaign on ad_insights_daily (campaign_id, day);
create index if not exists agent_events_from on agent_events (from_agent, at desc);
create index if not exists agent_events_to on agent_events (to_agent, at desc);
create index if not exists agent_events_run on agent_events (run_id);
create index if not exists agent_events_from_dept on agent_events (from_dept, at desc);
create index if not exists agent_events_to_dept on agent_events (to_dept, at desc);
create index if not exists reports_status on reports (status, updated_at desc);
create index if not exists reports_dept on reports (department_id, updated_at desc);
create index if not exists reports_author on reports (author_agent, updated_at desc);
create index if not exists approvals_status on approvals (status, created_at desc);
create index if not exists approvals_campaign on approvals (campaign_id);
create index if not exists campaigns_run on campaigns (run_id);
create index if not exists creatives_campaign on creatives (campaign_id);
create index if not exists competitor_moves_seen on competitor_moves (seen_at desc);
create index if not exists social_posts_saves on social_posts (saves desc nulls last);
create index if not exists social_posts_posted on social_posts (posted_at desc);
create index if not exists agent_runs_started on agent_runs (started_at desc);
create index if not exists products_active on products (status, updated_at desc);
create index if not exists seo_keywords_volume on seo_keywords (avg_monthly_searches desc nulls last);
create index if not exists seo_keywords_trend on seo_keywords (trend_change desc nulls last);
create index if not exists designs_format on designs (format, created_at desc);
create index if not exists lessons_created on lessons (created_at desc) where active;
create index if not exists profiles_created on profiles (created_at);

-- ---------- Dashboard: the last p_days against the p_days before ----------
create or replace function dashboard_summary(p_days int default 30) returns jsonb
  language sql stable security invoker set search_path = public
  as $$
  with b as (select current_date - p_days as since, current_date - 2 * p_days as prev),
  o as (select o.day, o.product_id, o.units, o.revenue, o.day >= b.since as cur from orders_daily o, b where o.day >= b.prev),
  a as (select a.platform, a.spend, a.revenue, a.day >= b.since as cur from ad_insights_daily a, b where a.day >= b.prev)
  select jsonb_build_object(
    'revenue', (select coalesce(sum(revenue), 0) from o where cur),
    'prev_revenue', (select coalesce(sum(revenue), 0) from o where not cur),
    'units', (select coalesce(sum(units), 0) from o where cur),
    'prev_units', (select coalesce(sum(units), 0) from o where not cur),
    'spend', (select coalesce(sum(spend), 0) from a where cur),
    'ad_revenue', (select coalesce(sum(revenue), 0) from a where cur),
    'prev_spend', (select coalesce(sum(spend), 0) from a where not cur),
    'prev_ad_revenue', (select coalesce(sum(revenue), 0) from a where not cur),
    'days', coalesce((select jsonb_agg(jsonb_build_array(day, rev) order by day) from (select day, sum(revenue) rev from o where cur group by day) d), '[]'),
    'platforms', coalesce((select jsonb_agg(jsonb_build_object('platform', platform, 'spend', s, 'revenue', r) order by s desc)
                           from (select platform, sum(spend) s, sum(revenue) r from a where cur group by platform) x), '[]'),
    'top', coalesce((select jsonb_agg(jsonb_build_object('id', t.product_id, 'revenue', t.rev, 'title', p.title, 'image_url', p.image_url) order by t.rev desc)
                     from (select product_id, sum(revenue) rev from o where cur group by product_id order by 2 desc limit 5) t
                     left join products p on p.id = t.product_id), '[]'))
$$;

-- ---------- what the agents read: best sellers and best ads, already summed ----------
create or replace function sales_by_product(p_since date, p_limit int default 15)
  returns table (product_id bigint, title text, product_type text, price numeric, inventory integer, units bigint, revenue numeric)
  language sql stable security invoker set search_path = public
  as $$
  select o.product_id, p.title, p.product_type, p.price, p.inventory, sum(o.units)::bigint, sum(o.revenue)
  from orders_daily o left join products p on p.id = o.product_id
  where o.day >= p_since group by o.product_id, p.title, p.product_type, p.price, p.inventory
  order by sum(o.revenue) desc limit least(p_limit, 500)
$$;

create or replace function ad_rollup(p_since date, p_limit int default 15)
  returns table (platform text, campaign_name text, ad_name text, spend numeric, clicks bigint, purchases numeric, revenue numeric)
  language sql stable security invoker set search_path = public
  as $$
  select platform, campaign_name, ad_name, sum(spend), sum(clicks)::bigint, sum(purchases), sum(revenue)
  from ad_insights_daily where day >= p_since group by platform, campaign_name, ad_name
  order by sum(spend) desc limit least(p_limit, 500)
$$;

-- ---------- Agent reports ----------
-- Activity and report counts per agent since p_since.
create or replace function agent_activity(p_ids text[], p_since timestamptz)
  returns table (agent_id text, actions bigint, last_at timestamptz, last_text text, reports bigint, forwarded bigint, accepted bigint, pushed_back bigint)
  language sql stable security invoker set search_path = public
  as $$
  select i.id, coalesce(e.n, 0), l.at, l.text, coalesce(r.n, 0), coalesce(r.fwd, 0), coalesce(r.acc, 0), coalesce(r.back, 0)
  from unnest(p_ids) as i(id)
  left join lateral (select count(*) n from agent_events where from_agent = i.id and at >= p_since) e on true
  left join lateral (select at, text from agent_events where from_agent = i.id and at >= p_since order by at desc limit 1) l on true
  left join lateral (
    select count(*) n,
           count(*) filter (where status::text in ('with_head', 'accepted', 'sent_back', 'rejected')) fwd,
           count(*) filter (where status::text = 'accepted') acc,
           count(*) filter (where status::text in ('sent_back', 'rejected', 'revise', 'rejected_by_lead')) back
    from reports where author_agent = i.id and created_at >= p_since) r on true
$$;

-- The campaigns each agent worked on since p_since, with what the campaign has earned on Meta so far.
create or replace function agent_campaigns(p_ids text[], p_since timestamptz)
  returns table (agent_id text, campaign_id uuid, name text, status text, spend numeric, revenue numeric)
  language sql stable security invoker set search_path = public
  as $$
  with runs as (select distinct from_agent, run_id from agent_events where from_agent = any (p_ids) and at >= p_since and run_id is not null)
  select r.from_agent, c.id, c.name, c.status, coalesce(m.spend, 0), coalesce(m.revenue, 0)
  from runs r join campaigns c on c.run_id = r.run_id
  left join lateral (select sum(spend) spend, sum(revenue) revenue from ad_insights_daily
                     where campaign_id = c.external_ids -> 'meta' ->> 'campaign_id') m on true
$$;

-- Lifetime Meta results for a set of campaign ids, for the Campaign Strategist's look back.
create or replace function campaign_results(p_ids text[])
  returns table (campaign_id text, spend numeric, revenue numeric, purchases numeric)
  language sql stable security invoker set search_path = public
  as $$
  select campaign_id, sum(spend), sum(revenue), sum(purchases) from ad_insights_daily where campaign_id = any (p_ids) group by campaign_id
$$;

revoke execute on function campaign_results(text[]) from public, anon;
grant execute on function campaign_results(text[]) to authenticated, service_role;
revoke execute on function dashboard_summary(int), sales_by_product(date, int), ad_rollup(date, int),
  agent_activity(text[], timestamptz), agent_campaigns(text[], timestamptz) from public, anon;
grant execute on function dashboard_summary(int), sales_by_product(date, int), ad_rollup(date, int),
  agent_activity(text[], timestamptz), agent_campaigns(text[], timestamptz) to authenticated, service_role;
