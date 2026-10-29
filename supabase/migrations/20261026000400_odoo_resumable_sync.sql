-- Replace a fully read Odoo day and advance its continuation in one transaction.
-- Service-only: never expose deletion or checkpoint mutation to signed-in clients.
create or replace function replace_odoo_sales_day(p_day date, p_branches jsonb, p_sales jsonb, p_state jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_day is null or jsonb_typeof(p_branches) is distinct from 'array'
    or jsonb_typeof(p_sales) is distinct from 'array' or jsonb_typeof(p_state) is distinct from 'object'
    or jsonb_typeof(p_state->'pending') is distinct from 'array' then
    raise exception 'Invalid Odoo day or checkpoint';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_branches) as r(day date) where r.day is distinct from p_day)
    or exists (select 1 from jsonb_to_recordset(p_sales) as r(day date) where r.day is distinct from p_day) then
    raise exception 'Odoo rows must belong to the completed day';
  end if;
  delete from odoo_branch_daily where day = p_day;
  delete from odoo_sales_daily where day = p_day;
  insert into odoo_branch_daily(day,branch,kind,orders,revenue)
    select day,branch,kind,orders,revenue from jsonb_to_recordset(p_branches)
      as r(day date,branch text,kind text,orders integer,revenue numeric);
  insert into odoo_sales_daily(day,branch,sku,product,units,revenue)
    select day,branch,sku,product,units,revenue from jsonb_to_recordset(p_sales)
      as r(day date,branch text,sku text,product text,units numeric,revenue numeric);
  insert into sync_cursors(name,state,updated_at) values ('odoo_sales',p_state,now())
    on conflict(name) do update set state=excluded.state,updated_at=excluded.updated_at;
end $$;
revoke all on function replace_odoo_sales_day(date,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function replace_odoo_sales_day(date,jsonb,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
