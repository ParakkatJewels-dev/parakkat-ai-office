-- Odoo, the ERP: sales for every showroom and the online store, and the real stock (Shopify's stock counts are not kept up to date).
alter table platform_credentials drop constraint if exists platform_credentials_provider_check;
alter table platform_credentials add constraint platform_credentials_provider_check check (provider in ('shopify', 'meta', 'google', 'odoo'));

-- Orders and revenue per branch per day. A branch is a point of sale (a showroom) or a sales channel such as the website.
create table if not exists odoo_branch_daily (
  day date not null,
  branch text not null,
  kind text not null default 'showroom',   -- showroom | online | other
  orders integer not null default 0,
  revenue numeric not null default 0,
  primary key (day, branch)
);
-- Units and revenue per branch, per product, per day.
create table if not exists odoo_sales_daily (
  day date not null,
  branch text not null,
  sku text not null,
  product text,
  units numeric not null default 0,
  revenue numeric not null default 0,
  primary key (day, branch, sku)
);
create index if not exists odoo_sales_daily_sku on odoo_sales_daily (sku, day);
-- What is on hand in each warehouse, replaced in full by each sync.
create table if not exists odoo_stock (
  sku text not null,
  warehouse text not null,
  product text,
  qty numeric not null default 0,
  reserved numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (sku, warehouse)
);
alter table odoo_branch_daily enable row level security;
alter table odoo_sales_daily enable row level security;
alter table odoo_stock enable row level security;
create policy "signed-in read" on odoo_branch_daily for select using (auth.uid() is not null);
create policy "signed-in read" on odoo_sales_daily for select using (auth.uid() is not null);
create policy "signed-in read" on odoo_stock for select using (auth.uid() is not null);

-- Shopify products carry the SKUs of their variants, which is how they are matched to Odoo products.
alter table products add column if not exists skus text[] not null default '{}';
alter table products add column if not exists odoo_stock integer;   -- free stock in Odoo across warehouses; null when Odoo has no match
create index if not exists products_skus on products using gin (skus);

-- Stock to plan with: Odoo's when the product is matched, else Shopify's.
create or replace view product_stock with (security_invoker = true) as
  select p.*, coalesce(p.odoo_stock, p.inventory) as stock, case when p.odoo_stock is null then 'shopify' else 'odoo' end as stock_source
  from products p;

-- After an Odoo stock sync: free quantity (on hand less reserved) summed over each product's SKUs.
create or replace function refresh_odoo_stock() returns integer
  language sql security invoker set search_path = public
  as $$
  with m as (
    -- greatest() skips nulls, so no matching row is kept as null (not in Odoo) rather than 0
    select p.id, (select case when count(*) > 0 then greatest(sum(s.qty - s.reserved), 0)::int end from odoo_stock s where s.sku = any (p.skus)) as q
    from products p where cardinality(p.skus) > 0
  ), u as (
    update products p set odoo_stock = m.q from m where p.id = m.id and p.odoo_stock is distinct from m.q returning 1
  )
  select count(*)::int from u
$$;

-- The best sellers now report the real stock.
create or replace function sales_by_product(p_since date, p_limit int default 15)
  returns table (product_id bigint, title text, product_type text, price numeric, inventory integer, units bigint, revenue numeric)
  language sql stable security invoker set search_path = public
  as $$
  select o.product_id, p.title, p.product_type, p.price, coalesce(p.odoo_stock, p.inventory), sum(o.units)::bigint, sum(o.revenue)
  from orders_daily o left join products p on p.id = o.product_id
  where o.day >= p_since group by o.product_id, p.title, p.product_type, p.price, p.odoo_stock, p.inventory
  order by sum(o.revenue) desc limit least(p_limit, 500)
$$;

-- Each branch's orders and revenue from p_since, with the same length of time before it for comparison.
create or replace function branch_sales(p_since date, p_till date default current_date)
  returns table (branch text, kind text, orders bigint, revenue numeric, prev_revenue numeric)
  language sql stable security invoker set search_path = public
  as $$
  with b as (select p_since as since, p_till as till, p_since - (p_till - p_since + 1) as prev)
  select d.branch, max(d.kind), sum(d.orders) filter (where d.day >= b.since)::bigint,
    coalesce(sum(d.revenue) filter (where d.day >= b.since), 0), coalesce(sum(d.revenue) filter (where d.day < b.since), 0)
  from odoo_branch_daily d, b where d.day >= b.prev and d.day <= b.till
  group by d.branch order by 4 desc
$$;

-- Best sellers in Odoo across every branch, with the free stock left.
create or replace function odoo_top_products(p_since date, p_limit int default 15)
  returns table (sku text, product text, units numeric, revenue numeric, branches bigint, stock numeric)
  language sql stable security invoker set search_path = public
  as $$
  select s.sku, max(s.product), sum(s.units), sum(s.revenue), count(distinct s.branch),
    (select sum(k.qty - k.reserved) from odoo_stock k where k.sku = s.sku)
  from odoo_sales_daily s where s.day >= p_since group by s.sku
  order by sum(s.revenue) desc limit least(p_limit, 500)
$$;

revoke execute on function refresh_odoo_stock() from public, anon, authenticated;
grant execute on function refresh_odoo_stock() to service_role;
revoke execute on function branch_sales(date, date), odoo_top_products(date, int) from public, anon;
grant execute on function branch_sales(date, date), odoo_top_products(date, int), sales_by_product(date, int) to authenticated, service_role;

-- The Shopify sync bot reads Odoo too.
update agents set name = 'Shopify & Odoo Sync Bot', role_desc = 'Products, orders, branch sales, real stock' where id = 'shopifySync';
insert into connections (provider) values ('odoo') on conflict do nothing;
