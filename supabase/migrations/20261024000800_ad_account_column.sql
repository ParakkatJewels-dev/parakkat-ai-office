-- Several ad accounts per platform can be synced; each day's row says which account it came from.
alter table ad_insights_daily add column if not exists account_id text;
create index if not exists ad_insights_daily_account on ad_insights_daily (platform, account_id, day);
