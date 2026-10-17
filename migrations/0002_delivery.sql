-- Delivery rooms. The app connects as the table owner, which bypasses RLS;
-- authorization is enforced in server functions. RLS is still enabled and
-- default-deny so any non-owner role cannot read client files directly.

create table if not exists profiles (
  id text primary key references "user" (id) on delete cascade,
  role text not null check (role in ('admin', 'creator')),
  display_name text not null,
  avatar_url text,
  storage_limit_bytes bigint not null default 5368709120,
  storage_used_bytes bigint not null default 0,
  must_change_password boolean not null default false,
  is_active boolean not null default true,
  notify_open boolean not null default true,
  notify_comments boolean not null default true,
  notify_accept boolean not null default true,
  notify_reviews boolean not null default true,
  notify_digest boolean not null default false,
  hide_powered_by boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create unique index if not exists profiles_single_admin
  on profiles (role) where role = 'admin';

create table if not exists brand_presets (
  id text primary key,
  owner_id text not null references profiles (id) on delete cascade,
  name text not null,
  logo_url text,
  accent_color text not null default '#E07A3D',
  font_key text not null default 'cormorant',
  theme text not null default 'dark',
  background_type text not null default 'preset',
  background_value text not null default 'ember',
  layout text not null default 'grid',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists brand_presets_owner_idx on brand_presets (owner_id);

create table if not exists rooms (
  id text primary key,
  slug text not null unique,
  owner_id text not null references profiles (id) on delete cascade,
  title text not null default '',
  client_name text not null default '',
  client_email text,
  message text not null default '',
  cover_file_id text,
  co_creators jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'active', 'disabled')),
  expires_at timestamptz,
  expiry_reminded boolean not null default false,
  validity_days integer,
  password_hash text,
  allow_zip boolean not null default true,
  allow_download boolean not null default true,
  hide_powered_by boolean not null default false,
  accent_color text not null default '#E07A3D',
  font_key text not null default 'cormorant',
  theme text not null default 'dark',
  background_type text not null default 'preset',
  background_value text not null default 'ember',
  layout text not null default 'grid',
  logo_url text,
  brand_snapshot jsonb not null default '{}'::jsonb,
  review_state text not null default 'pending' check (review_state in ('pending', 'changes', 'approved')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists rooms_owner_idx on rooms (owner_id);
create index if not exists rooms_expires_idx on rooms (expires_at);

create table if not exists room_files (
  id text primary key,
  room_id text not null references rooms (id) on delete cascade,
  original_name text not null,
  mime text not null,
  size_bytes bigint not null default 0,
  width integer,
  height integer,
  duration_seconds numeric,
  position integer not null default 0,
  kind text not null default 'file',
  thumb_data text,
  preview_data text,
  file_data text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists room_files_room_idx on room_files (room_id, position);

create table if not exists file_reviews (
  file_id text primary key references room_files (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested')),
  reviewer_name text,
  updated_at timestamptz not null default now()
);

create table if not exists file_comments (
  id text primary key,
  file_id text not null references room_files (id) on delete cascade,
  room_id text not null references rooms (id) on delete cascade,
  author_type text not null check (author_type in ('client', 'creator')),
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists file_comments_file_idx on file_comments (file_id, created_at);
create index if not exists file_comments_room_idx on file_comments (room_id, created_at);

create table if not exists room_events (
  id text primary key,
  room_id text not null references rooms (id) on delete cascade,
  file_id text,
  type text not null,
  actor_name text,
  ip_hash text,
  user_agent_short text,
  created_at timestamptz not null default now()
);

create index if not exists room_events_room_idx on room_events (room_id, created_at desc);

create table if not exists testimonials (
  id text primary key,
  room_id text not null references rooms (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text not null,
  author_name text not null,
  author_role text,
  consent_public boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'hidden')),
  created_at timestamptz not null default now(),
  moderated_at timestamptz
);

create index if not exists testimonials_status_idx on testimonials (status, created_at desc);

create table if not exists notifications (
  id text primary key,
  user_id text not null references profiles (id) on delete cascade,
  room_id text,
  kind text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  digest_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

create table if not exists outbox_emails (
  id text primary key,
  to_email text not null,
  subject text not null,
  body_text text not null,
  body_html text not null,
  room_id text,
  kind text,
  created_at timestamptz not null default now()
);

create table if not exists password_resets (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_resets_hash_idx on password_resets (token_hash);

create table if not exists rate_limits (
  bucket text primary key,
  count integer not null,
  window_start timestamptz not null
);

create table if not exists contact_requests (
  id text primary key,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists app_secrets (
  id text primary key,
  value text not null
);

alter table profiles enable row level security;
alter table brand_presets enable row level security;
alter table rooms enable row level security;
alter table room_files enable row level security;
alter table file_reviews enable row level security;
alter table file_comments enable row level security;
alter table room_events enable row level security;
alter table testimonials enable row level security;
alter table notifications enable row level security;
alter table outbox_emails enable row level security;
alter table password_resets enable row level security;
alter table rate_limits enable row level security;
alter table contact_requests enable row level security;
alter table app_secrets enable row level security;

drop policy if exists deny_all on profiles;
drop policy if exists deny_all on brand_presets;
drop policy if exists deny_all on rooms;
drop policy if exists deny_all on room_files;
drop policy if exists deny_all on file_reviews;
drop policy if exists deny_all on file_comments;
drop policy if exists deny_all on room_events;
drop policy if exists deny_all on testimonials;
drop policy if exists deny_all on notifications;
drop policy if exists deny_all on outbox_emails;
drop policy if exists deny_all on password_resets;
drop policy if exists deny_all on rate_limits;
drop policy if exists deny_all on contact_requests;
drop policy if exists deny_all on app_secrets;

create policy deny_all on profiles for all using (false) with check (false);
create policy deny_all on brand_presets for all using (false) with check (false);
create policy deny_all on rooms for all using (false) with check (false);
create policy deny_all on room_files for all using (false) with check (false);
create policy deny_all on file_reviews for all using (false) with check (false);
create policy deny_all on file_comments for all using (false) with check (false);
create policy deny_all on room_events for all using (false) with check (false);
create policy deny_all on testimonials for all using (false) with check (false);
create policy deny_all on notifications for all using (false) with check (false);
create policy deny_all on outbox_emails for all using (false) with check (false);
create policy deny_all on password_resets for all using (false) with check (false);
create policy deny_all on rate_limits for all using (false) with check (false);
create policy deny_all on contact_requests for all using (false) with check (false);
create policy deny_all on app_secrets for all using (false) with check (false);
