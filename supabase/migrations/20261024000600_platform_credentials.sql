-- Access saved when the Super Admin connects Shopify, Meta or Google from the Admin page.
-- The app encrypts the tokens before they reach the database (AES-256-GCM), and row-level security is on
-- with no policies, so nobody signed in can read this table: only the server, with the service role, can.
create table if not exists platform_credentials (
  provider text primary key check (provider in ('shopify', 'meta', 'google')),
  secret text not null,                     -- encrypted tokens
  settings jsonb not null default '{}',     -- the accounts chosen and the ones to choose from; never a secret
  expires_at timestamptz,                   -- when the saved access runs out, if it does
  connected_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table platform_credentials enable row level security;
revoke all on platform_credentials from public, anon, authenticated;
grant all on platform_credentials to service_role;
