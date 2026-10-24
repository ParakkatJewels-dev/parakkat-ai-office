-- Auto-pause when the month's spend reaches the budget. The guard fires once per month and budget: after the
-- Super Admin resumes, it stays quiet until the next month or until the budget is changed.
alter table billing_settings add column if not exists autopaused_month text, add column if not exists autopaused_cap numeric;

-- This month's spend in rupees, worked out the same way as the Usage page: AI and API calls so far, plus the
-- active monthly plans for the days gone.
create or replace function month_spend() returns jsonb
  language sql stable security invoker set search_path = public
  as $$
  with b as (select * from billing_settings where id = 1),
  t as (select date_trunc('month', now() at time zone 'utc') m0, extract(day from now() at time zone 'utc') dom,
               extract(day from date_trunc('month', now() at time zone 'utc') + interval '1 month' - interval '1 day') dim)
  select jsonb_build_object(
    'month', to_char(now() at time zone 'utc', 'YYYY-MM'),
    'budget_inr', (select monthly_budget_inr from b),
    'spent_inr', ((select coalesce(sum(cost_usd), 0) from api_usage, t where at >= t.m0)
                  + (select coalesce(sum(monthly_usd), 0) from fixed_costs where active) * (select dom / dim from t)) * (select usd_inr from b),
    'autopaused_month', (select autopaused_month from b),
    'autopaused_cap', (select autopaused_cap from b))
$$;
revoke execute on function month_spend() from public, anon, authenticated;
grant execute on function month_spend() to service_role;
