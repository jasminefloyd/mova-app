create table public.mova_google_calendar_connections (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  google_account_email text,
  calendar_id text not null default 'primary',
  refresh_token_encrypted bytea not null,
  status text not null default 'active' check (status in ('active','revoked','error')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_google_calendar_connections_email_check check (google_account_email is null or length(google_account_email) <= 320)
);

create table public.mova_calendar_sync_settings (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  location_ids uuid[] not null default '{}',
  privacy_level text not null default 'service_only' check (privacy_level = 'service_only'),
  google_enabled boolean not null default false,
  apple_feed_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.mova_google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  state_hash text not null unique,
  verifier_encrypted bytea not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mova_google_oauth_states_hash_check check (state_hash ~ '^[0-9a-f]{64}$')
);
create index mova_google_oauth_states_expiry_idx on public.mova_google_oauth_states(expires_at);

create table public.mova_external_calendar_events (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  appointment_id uuid not null,
  provider_event_id text not null,
  provider_calendar_id text not null,
  event_sequence integer not null default 0 check (event_sequence >= 0),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mova_external_calendar_events_appointment_fk foreign key (appointment_id, artist_business_id) references public.mova_appointments(id, artist_business_id) on delete cascade,
  constraint mova_external_calendar_events_appointment_uq unique (appointment_id),
  constraint mova_external_calendar_events_provider_id_uq unique (artist_business_id, provider_calendar_id, provider_event_id)
);

create table public.mova_calendar_feed_tokens (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint mova_calendar_feed_tokens_hash_check check (token_hash ~ '^[0-9a-f]{64}$')
);
create unique index mova_calendar_feed_tokens_active_uq on public.mova_calendar_feed_tokens(artist_business_id) where revoked_at is null;

create or replace function public.mova_rotate_calendar_feed_token(p_artist_business_id uuid,p_token_hash text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='FEED_TOKEN_HASH_INVALID'; end if;
  update public.mova_calendar_feed_tokens set revoked_at=now() where artist_business_id=p_artist_business_id and revoked_at is null;
  insert into public.mova_calendar_feed_tokens(artist_business_id,token_hash) values(p_artist_business_id,p_token_hash);
end $$;
revoke all on function public.mova_rotate_calendar_feed_token(uuid,text) from public,anon,authenticated;
grant execute on function public.mova_rotate_calendar_feed_token(uuid,text) to service_role;

create trigger mova_google_calendar_connections_touch before update on public.mova_google_calendar_connections for each row execute function public.mova_touch_updated_at();
create trigger mova_calendar_sync_settings_touch before update on public.mova_calendar_sync_settings for each row execute function public.mova_touch_updated_at();

alter table public.mova_google_calendar_connections enable row level security;
alter table public.mova_calendar_sync_settings enable row level security;
alter table public.mova_google_oauth_states enable row level security;
alter table public.mova_external_calendar_events enable row level security;
alter table public.mova_calendar_feed_tokens enable row level security;

create policy mova_google_calendar_connections_member_select on public.mova_google_calendar_connections for select to authenticated using (public.mova_has_artist_membership(artist_business_id));
create policy mova_calendar_sync_settings_member_select on public.mova_calendar_sync_settings for select to authenticated using (public.mova_has_artist_membership(artist_business_id));
create policy mova_external_calendar_events_member_select on public.mova_external_calendar_events for select to authenticated using (public.mova_has_artist_membership(artist_business_id));

revoke all on public.mova_google_calendar_connections, public.mova_google_oauth_states, public.mova_external_calendar_events, public.mova_calendar_feed_tokens from anon, authenticated;
grant select (artist_business_id, google_account_email, status, connected_at) on public.mova_google_calendar_connections to authenticated;
grant select (id, artist_business_id, appointment_id, provider_event_id, provider_calendar_id, event_sequence, last_synced_at, created_at) on public.mova_external_calendar_events to authenticated;
revoke all on public.mova_calendar_sync_settings from anon, authenticated;
grant select on public.mova_calendar_sync_settings to authenticated;
