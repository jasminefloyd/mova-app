-- P6 Google: one Google connection powers Google Business Profile (listing, services, reviews in,
-- replies out) and Google Calendar sync. Existing calendar connections are carried over into
-- mova_google_connections so nobody reconnects. The legacy tables are kept (no data is deleted).
--
-- Rollback note: revert the Edge Functions and web build to the calendar-only versions. The legacy
-- mova_google_calendar_connections rows still exist, so calendar sync resumes for every connection
-- that existed before this migration. Connections made after this migration live only in
-- mova_google_connections; to keep them, reconnect or re-run the carry-over from the legacy table.
-- Dropping mova_google_connections is a data-loss step and needs owner approval.

create table if not exists public.mova_google_connections (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  google_account_email text check (google_account_email is null or length(google_account_email) <= 320),
  refresh_token_encrypted bytea not null,
  granted_scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active','revoked','error')),
  calendar_enabled boolean not null default false,
  calendar_id text not null default 'primary' check (length(calendar_id) between 1 and 320),
  business_profile_enabled boolean not null default false,
  business_location_id text check (business_location_id is null or length(business_location_id) between 3 and 200),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger mova_google_connections_touch before update on public.mova_google_connections
  for each row execute function public.mova_touch_updated_at();

alter table public.mova_google_connections enable row level security;
create policy mova_google_connections_member_select on public.mova_google_connections for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));

revoke all on public.mova_google_connections from public, anon, authenticated;
-- The refresh token ciphertext is never selectable by clients (same rule as the legacy table).
grant select (artist_business_id, google_account_email, granted_scopes, status, calendar_enabled, calendar_id,
  business_profile_enabled, business_location_id, connected_at, updated_at) on public.mova_google_connections to authenticated;

-- Copies every legacy calendar connection that is not in the new table yet. Safe to run again: existing
-- rows are never overwritten, so a connection changed after the first run keeps its newer state.
create or replace function public.mova_google_carry_over_calendar_connections()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_copied integer;
begin
  insert into public.mova_google_connections (
    artist_business_id, google_account_email, refresh_token_encrypted, granted_scopes, status,
    calendar_enabled, calendar_id, business_profile_enabled, connected_at
  )
  select c.artist_business_id, c.google_account_email, c.refresh_token_encrypted,
    array['https://www.googleapis.com/auth/calendar.events']::text[], c.status,
    (c.status = 'active' and coalesce(s.google_enabled, false)), c.calendar_id, false, c.connected_at
  from public.mova_google_calendar_connections c
  left join public.mova_calendar_sync_settings s on s.artist_business_id = c.artist_business_id
  on conflict (artist_business_id) do nothing;
  get diagnostics v_copied = row_count;

  -- The Google location used for review import (0054) becomes the connection's Business Profile location.
  update public.mova_google_connections g set business_location_id = r.google_location_id
  from public.mova_review_settings r
  where r.artist_business_id = g.artist_business_id and r.google_location_id is not null and g.business_location_id is null;

  return v_copied;
end $$;

revoke all on function public.mova_google_carry_over_calendar_connections() from public, anon, authenticated;
grant execute on function public.mova_google_carry_over_calendar_connections() to service_role;

select public.mova_google_carry_over_calendar_connections();
