-- Product quantities for agent conversations. Aggregate before applying a model-context limit,
-- keep both date bounds, and retain sales whose catalogue or stock record is unavailable.
-- This reads with the caller's existing RLS permissions; it does not refresh or change data.
create or replace function conversation_product_sales(p_from date, p_to date, p_limit int default 26)
  returns table (
    product_id bigint, title text, product_type text, price numeric, status text,
    units bigint, revenue numeric, stock integer, stock_source text,
    last_sale_day date, product_updated_at timestamptz,
    window_units bigint, window_product_count bigint,
    window_first_recorded_day date, window_last_recorded_day date
  )
  language sql stable security invoker set search_path = public
  as $$
  with sold as (
    select o.product_id, sum(o.units)::bigint as units, sum(o.revenue) as revenue,
      min(o.day) as first_day, max(o.day) as last_day
    from orders_daily o
    where o.day between p_from and p_to
    group by o.product_id
  ), totals as (
    select sum(s.units)::bigint as units, count(*) as products,
      min(s.first_day) as first_day, max(s.last_day) as last_day
    from sold s
  )
  select s.product_id, p.title, p.product_type, p.price, p.status, s.units, s.revenue,
    p.stock, case when p.stock is null then null else p.stock_source end,
    s.last_day, p.updated_at, t.units, t.products, t.first_day, t.last_day
  from sold s cross join totals t
  left join product_stock p on p.id = s.product_id
  order by s.units desc, s.revenue desc, s.product_id
  limit greatest(1, least(coalesce(p_limit, 26), 101))
$$;

revoke execute on function conversation_product_sales(date, date, int) from public, anon;
grant execute on function conversation_product_sales(date, date, int) to authenticated, service_role;
