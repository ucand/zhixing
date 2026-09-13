-- OAuth credentials and sessions are server-side only.
create table if not exists zhihu_oauth_account (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  provider varchar(30) not null default 'zhihu',
  provider_user_id text,
  access_token_ciphertext text not null,
  token_type varchar(30) not null default 'Bearer',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create index if not exists zhihu_oauth_account_provider_user_idx on zhihu_oauth_account(provider, provider_user_id);
create table if not exists oauth_session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists oauth_session_expiry_idx on oauth_session(expires_at);
create table if not exists oauth_state (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists oauth_state_expiry_idx on oauth_state(expires_at);
