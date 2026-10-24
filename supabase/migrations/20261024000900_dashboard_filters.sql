-- The dashboard's numbers for any date range, optionally for one ad platform and one ad account.
-- The comparison is the same number of days just before the range. Summed in the database so it stays fast on big tables.
create or replace function dashboard_report(p_from date, p_to date, p_platform text default null, p_account text default null) returns jsonb
  language sql stable security invoker set search_path = public
  as $$
  with b as (select p_from as since, p_to as till, p_from - (p_to - p_from + 1) as prev),
  o as (select o.day, o.product_id, o.units, o.revenue, o.day >= b.since as cur from orders_daily o, b where o.day >= b.prev and o.day <= b.till),
  a as (select a.platform, a.spend, a.revenue, a.day >= b.since as cur from ad_insights_daily a, b
        where a.day >= b.prev and a.day <= b.till
          and (p_platform is null or a.platform = p_platform)
          and (p_account is null or a.account_id = p_account))
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

-- The ad accounts that have data, for the dashboard's account filter.
create or replace function ad_accounts() returns table (platform text, account_id text)
  language sql stable security invoker set search_path = public
  as $$ select distinct platform, account_id from ad_insights_daily where account_id is not null order by 1, 2 $$;

revoke execute on function dashboard_report(date, date, text, text), ad_accounts() from public, anon;
grant execute on function dashboard_report(date, date, text, text), ad_accounts() to authenticated, service_role;
