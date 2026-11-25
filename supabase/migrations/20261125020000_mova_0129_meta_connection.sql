-- 0129 Connections › Meta (CN5): one Meta connection per stylist, so the Concierge can answer Instagram DMs
-- and Facebook Page messages. Owner applies by hand; then deploy meta-connect and redeploy
-- instagram-webhook and concierge-artist. Everything stays off until MOVA_META_CONNECT_ENABLED=true
-- and Meta has approved the app (owner decision O6).

create table if not exists public.mova_meta_connections (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  status text not null default 'active' check (status in ('active','revoked','error')),
  page_id text not null check (page_id ~ '^[0-9A-Za-z_-]{3,64}$'),
  page_name text not null default '' check (length(page_name) <= 200),
  instagram_user_id text check (instagram_user_id is null or instagram_user_id ~ '^[0-9A-Za-z_-]{3,64}$'),
  instagram_username text check (instagram_username is null or length(instagram_username) between 1 and 60),
  page_token_encrypted bytea not null,
  user_token_encrypted bytea,
  granted_scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_message_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists mova_meta_connections_page_active_uq on public.mova_meta_connections(page_id) where status = 'active';
drop trigger if exists mova_meta_connections_touch on public.mova_meta_connections;
create trigger mova_meta_connections_touch before update on public.mova_meta_connections
  for each row execute function public.mova_touch_updated_at();

alter table public.mova_meta_connections enable row level security;
drop policy if exists mova_meta_connections_member_select on public.mova_meta_connections;
create policy mova_meta_connections_member_select on public.mova_meta_connections for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));
revoke all on public.mova_meta_connections from public, anon, authenticated;
-- Tokens are never selectable by clients.
grant select (artist_business_id, status, page_id, page_name, instagram_user_id, instagram_username, granted_scopes,
  connected_at, last_message_at, updated_at) on public.mova_meta_connections to authenticated;

create table if not exists public.mova_meta_oauth_states (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mova_meta_oauth_states_expiry_idx on public.mova_meta_oauth_states(expires_at);
alter table public.mova_meta_oauth_states enable row level security;
revoke all on public.mova_meta_oauth_states from public, anon, authenticated;

-- Facebook Page messages ("messenger") join Instagram as a Concierge channel.
alter table public.mova_sending_identities drop constraint if exists mova_sending_identities_channel_check;
alter table public.mova_sending_identities add constraint mova_sending_identities_channel_check
  check (channel in ('sms','email','instagram','messenger'));
alter table public.mova_conversations drop constraint if exists mova_conversations_channel_check;
alter table public.mova_conversations add constraint mova_conversations_channel_check
  check (channel in ('sms','missed_call','web_chat','instagram','messenger'));
alter table public.mova_messages drop constraint if exists mova_messages_channel_check;
alter table public.mova_messages add constraint mova_messages_channel_check
  check (channel in ('sms','email','instagram','push','in_app','web_chat','messenger'));
alter table public.mova_concierge_settings alter column channels
  set default '{"instagram":false,"messenger":false,"sms":false,"missed_call":false,"web_chat":false}';
