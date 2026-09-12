create extension if not exists pgcrypto;

create type note_tag as enum ('idea', 'quote', 'limit', 'try');
create type generation_status as enum ('pending', 'succeeded', 'failed', 'fallback');

create table app_user (
  id uuid primary key default gen_random_uuid(),
  display_name text not null default '未来的我',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notebook (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  name varchar(60) not null,
  color varchar(20) not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table note (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references notebook(id) on delete cascade,
  tag note_tag not null,
  color varchar(7),
  body text not null check (char_length(body) between 1 and 5000),
  selected boolean not null default false,
  source_title text,
  source_author text,
  source_url text,
  source_content_id text,
  source_vote_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index note_notebook_created_idx on note(notebook_id, created_at desc);

create table paper (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references notebook(id) on delete cascade,
  version integer not null check (version > 0),
  question text not null,
  conditions jsonb not null default '[]'::jsonb,
  reference_materials jsonb not null default '[]'::jsonb,
  checkpoints jsonb not null default '[]'::jsonb,
  marker_comment text not null,
  generation_status generation_status not null,
  provider varchar(40),
  provider_request_id varchar(200),
  source_snapshot jsonb not null,
  generation_error text,
  created_at timestamptz not null default now(),
  unique (notebook_id, version)
);

create table paper_stage (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references paper(id) on delete cascade,
  position integer not null,
  title varchar(80) not null,
  period varchar(80) not null,
  goal text not null,
  score integer not null check (score between 1 and 100),
  criterion text not null,
  unique (paper_id, position)
);

create table paper_task (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references paper_stage(id) on delete cascade,
  position integer not null,
  body text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  unique (stage_id, position)
);

create table paper_note (
  paper_id uuid not null references paper(id) on delete cascade,
  note_id uuid not null references note(id) on delete restrict,
  primary key (paper_id, note_id)
);

create table api_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index api_cache_expires_idx on api_cache(expires_at);
