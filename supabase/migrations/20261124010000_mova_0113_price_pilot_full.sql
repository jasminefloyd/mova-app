-- 0113: PricePilot to boards PP1–PP8 (CR-019, decisions PP-D1..PP-D5 of 2026-11-23).
-- * The stylist turns PricePilot on (PP8); Mova then finds nearby salons (Google Places) and reads
--   their public menu pages every week. Stylists can add a menu link they're allowed to have checked (PP7).
-- * "Update price" (PP3/PP4) changes the standard price; a location with its own price keeps it.
-- * Stylist locations are geocoded with the U.S. Census geocoder (public domain); salon coordinates from
--   Google are kept 30 days at most and refreshed weekly. BLS metro pay is cached (public domain).
-- Nothing here changes a price by itself: mova_price_pilot_apply runs only on the stylist's tap.

-- Settings: on/off, radius up to 25 miles (PP7 offers 3, 5, 10 and 25), and the three "Where we look" switches.
alter table public.mova_price_pilot_settings
  add column enabled boolean not null default false,
  add column enabled_at timestamptz,
  add column use_nearby_salons boolean not null default true,
  add column use_competitor_menus boolean not null default true,
  add column show_industry_context boolean not null default true;
alter table public.mova_price_pilot_settings drop constraint mova_price_pilot_settings_radius_miles_check;
alter table public.mova_price_pilot_settings add constraint mova_price_pilot_settings_radius_miles_check check (radius_miles between 1 and 25);

-- Sources: salons Mova found itself ('auto') sit beside menus the stylist added ('stylist') and the
-- stylist's own site ('own_site'). Only stylist-added links need the stylist's permission tick.
alter table public.mova_price_pilot_sources
  add column origin text not null default 'stylist' check (origin in ('stylist', 'auto', 'own_site')),
  add column business_name text check (business_name is null or length(business_name) between 1 and 160),
  add column google_place_id text check (google_place_id is null or length(google_place_id) between 1 and 255),
  add column website_url text check (website_url is null or length(website_url) between 8 and 2048),
  add column location_id uuid references public.mova_locations(id) on delete cascade,
  add column latitude double precision check (latitude is null or latitude between -90 and 90),
  add column longitude double precision check (longitude is null or longitude between -180 and 180),
  add column geo_source text check (geo_source is null or geo_source in ('google', 'census')),
  add column geo_expires_at timestamptz,
  add column menu_status text not null default 'found' check (menu_status in ('pending', 'found', 'no_menu', 'failed')),
  add column next_check_at timestamptz,
  add column fail_count smallint not null default 0 check (fail_count between 0 and 100);
alter table public.mova_price_pilot_sources drop constraint mova_price_pilot_sources_authorization_confirmed_check;
alter table public.mova_price_pilot_sources add constraint mova_price_pilot_sources_authorization_check
  check (authorization_confirmed or origin = 'auto');
create unique index mova_price_pilot_sources_place_uq on public.mova_price_pilot_sources (artist_business_id, google_place_id)
  where google_place_id is not null;
create index mova_price_pilot_sources_due_idx on public.mova_price_pilot_sources (next_check_at)
  where status = 'active' and next_check_at is not null;
comment on column public.mova_price_pilot_sources.latitude is 'Google coordinates are kept until geo_expires_at (30 days) and refreshed weekly; Census coordinates do not expire.';

-- Census geocode of each stylist location: coordinates, metro area (CBSA) and state for BLS.
create table public.mova_price_pilot_location_geo (
  location_id uuid primary key references public.mova_locations(id) on delete cascade,
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  address_key text not null check (length(address_key) between 1 and 500),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  cbsa_code text check (cbsa_code is null or cbsa_code ~ '^[0-9]{5}$'),
  state_fips text check (state_fips is null or state_fips ~ '^[0-9]{2}$'),
  matched boolean not null default false,
  geocoded_at timestamptz not null default now()
);

-- BLS OEWS hourly median pay for hairdressers, hairstylists and cosmetologists (SOC 39-5012), per area.
create table public.mova_price_pilot_bls_wages (
  area_code text primary key check (area_code ~ '^[0-9]{7}$'),
  area_type text not null check (area_type in ('M', 'S')),
  hourly_median numeric(8,2) check (hourly_median is null or hourly_median > 0),
  data_year smallint,
  fetched_at timestamptz not null default now()
);

-- "Not now" on PP2 hides a suggestion for 30 days.
create table public.mova_price_pilot_dismissals (
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  service_id uuid not null references public.mova_services(id) on delete cascade,
  location_id uuid not null references public.mova_locations(id) on delete cascade,
  until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (artist_business_id, service_id, location_id)
);

-- Every price the stylist changed through PricePilot.
create table public.mova_price_pilot_changes (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  service_id uuid not null references public.mova_services(id) on delete cascade,
  location_id uuid not null references public.mova_locations(id) on delete cascade,
  scope text not null check (scope in ('standard', 'location')),
  old_price_minor integer not null check (old_price_minor >= 0),
  new_price_minor integer not null check (new_price_minor >= 1),
  reference_median_minor integer check (reference_median_minor is null or reference_median_minor >= 0),
  evidence_count integer check (evidence_count is null or evidence_count >= 0),
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz not null default now()
);
create index mova_price_pilot_changes_business_idx on public.mova_price_pilot_changes (artist_business_id, applied_at desc);

-- Discovery runs: one per stylist location, queued on turn-on, weekly, or by "Find salons near you".
create table public.mova_price_pilot_runs (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  location_id uuid not null references public.mova_locations(id) on delete cascade,
  trigger text not null check (trigger in ('enabled', 'weekly', 'stylist')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  found_count integer not null default 0 check (found_count >= 0),
  error_code text check (error_code is null or length(error_code) <= 80),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index mova_price_pilot_runs_queue_idx on public.mova_price_pilot_runs (status, requested_at);
create index mova_price_pilot_runs_location_idx on public.mova_price_pilot_runs (location_id, requested_at desc);

alter table public.mova_price_pilot_location_geo enable row level security;
alter table public.mova_price_pilot_bls_wages enable row level security;
alter table public.mova_price_pilot_dismissals enable row level security;
alter table public.mova_price_pilot_changes enable row level security;
alter table public.mova_price_pilot_runs enable row level security;
revoke all on public.mova_price_pilot_location_geo, public.mova_price_pilot_bls_wages, public.mova_price_pilot_dismissals,
  public.mova_price_pilot_changes, public.mova_price_pilot_runs from public, anon, authenticated;
grant all on public.mova_price_pilot_location_geo, public.mova_price_pilot_bls_wages, public.mova_price_pilot_dismissals,
  public.mova_price_pilot_changes, public.mova_price_pilot_runs to service_role;

-- PP3/PP4: apply one or more price changes atomically. Each change names the price the stylist saw;
-- if the price moved since, nothing is applied (PRICE_CHANGED). A location with its own price keeps
-- that override and changes it; otherwise the standard price changes. Booked appointments keep their
-- snapshot prices (mova_appointments.service_price_minor, mova_appointment_services.price_minor_snapshot).
create or replace function public.mova_price_pilot_apply(p_artist_business_id uuid, p_user_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_change jsonb;
  v_service public.mova_services;
  v_override integer;
  v_has_row boolean;
  v_current integer;
  v_new integer;
  v_scope text;
  v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 50 then
    raise exception using errcode = 'P0001', message = 'CHANGES_INVALID';
  end if;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_new := (v_change->>'new_price_minor')::integer;
    if v_new is null or v_new < 1 or v_new > 100000000 then
      raise exception using errcode = 'P0001', message = 'PRICE_INVALID';
    end if;
    select * into v_service from public.mova_services
      where id = (v_change->>'service_id')::uuid and artist_business_id = p_artist_business_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'SERVICE_NOT_FOUND'; end if;
    select true, sl.price_minor_override into v_has_row, v_override from public.mova_service_locations sl
      join public.mova_locations l on l.id = sl.location_id and l.artist_business_id = p_artist_business_id
      where sl.service_id = v_service.id and sl.location_id = (v_change->>'location_id')::uuid for update of sl;
    if not coalesce(v_has_row, false) then raise exception using errcode = 'P0002', message = 'SERVICE_NOT_OFFERED_HERE'; end if;
    v_current := coalesce(v_override, v_service.base_price_minor);
    if v_current <> (v_change->>'expected_current_minor')::integer then
      raise exception using errcode = 'P0001', message = 'PRICE_CHANGED';
    end if;
    if v_override is not null then
      update public.mova_service_locations set price_minor_override = v_new
        where service_id = v_service.id and location_id = (v_change->>'location_id')::uuid;
      v_scope := 'location';
    else
      update public.mova_services set base_price_minor = v_new, updated_at = now() where id = v_service.id;
      v_scope := 'standard';
    end if;
    insert into public.mova_price_pilot_changes (artist_business_id, service_id, location_id, scope, old_price_minor, new_price_minor,
      reference_median_minor, evidence_count, applied_by)
    values (p_artist_business_id, v_service.id, (v_change->>'location_id')::uuid, v_scope, v_current, v_new,
      nullif(v_change->>'reference_median_minor', '')::integer, nullif(v_change->>'evidence_count', '')::integer, p_user_id);
    delete from public.mova_price_pilot_dismissals
      where artist_business_id = p_artist_business_id and service_id = v_service.id and location_id = (v_change->>'location_id')::uuid;
    v_out := v_out || jsonb_build_object('service_id', v_service.id, 'location_id', v_change->>'location_id', 'scope', v_scope,
      'old_price_minor', v_current, 'new_price_minor', v_new);
    v_has_row := null; v_override := null;
  end loop;
  return v_out;
end $$;

-- Bookings per service and location in the last 90 days, and how far ahead they were made (PP2 "Why this price").
create or replace function public.mova_price_pilot_booking_stats(p_artist_business_id uuid, p_now timestamptz default now())
returns table (service_id uuid, location_id uuid, bookings_90d integer, avg_lead_days numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with booked as (
    select coalesce(s.service_id, a.service_id) as service_id, a.location_id, a.starts_at, a.created_at
    from public.mova_appointments a
    left join public.mova_appointment_services s on s.appointment_id = a.id
    where a.artist_business_id = p_artist_business_id
      and a.status in ('confirmed', 'completed')
      and a.created_at >= p_now - interval '90 days' and a.created_at <= p_now
  )
  select b.service_id, b.location_id, count(*)::integer,
    round(avg(greatest(0, extract(epoch from (b.starts_at - b.created_at)) / 86400))::numeric, 1)
  from booked b group by b.service_id, b.location_id
$$;

-- Weekly refresh: queue a discovery run for every active location of a stylist who turned PricePilot on,
-- whose plan includes it, and whose last run is more than 7 days old. Idempotent: one queued run per location.
create or replace function public.mova_price_pilot_enqueue_due_runs(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  insert into public.mova_price_pilot_runs (artist_business_id, location_id, trigger, requested_at)
  select l.artist_business_id, l.id, 'weekly', p_now
  from public.mova_price_pilot_settings s
  join public.mova_locations l on l.artist_business_id = s.artist_business_id and l.is_active
  where s.enabled and s.use_nearby_salons
    and coalesce((public.mova_feature_gate(s.artist_business_id, 'ai_price_pilot', null)->>'enabled')::boolean, false)
    and not exists (select 1 from public.mova_price_pilot_runs r where r.location_id = l.id
      and (r.status in ('queued', 'running') or r.requested_at > p_now - interval '7 days'));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Worker leases: claim queued runs and due menu checks with SKIP LOCKED so overlapping ticks never double-process.
create or replace function public.mova_price_pilot_claim_runs(p_limit integer default 2, p_now timestamptz default now())
returns setof public.mova_price_pilot_runs language sql security definer set search_path = public, pg_temp as $$
  update public.mova_price_pilot_runs r set status = 'running', started_at = p_now
  where r.id in (
    select id from public.mova_price_pilot_runs
    where status = 'queued' or (status = 'running' and started_at < p_now - interval '15 minutes')
    order by requested_at limit greatest(1, least(p_limit, 10)) for update skip locked)
  returning r.*
$$;

create or replace function public.mova_price_pilot_claim_sources(p_limit integer default 3, p_now timestamptz default now())
returns setof public.mova_price_pilot_sources language sql security definer set search_path = public, pg_temp as $$
  update public.mova_price_pilot_sources s set next_check_at = p_now + interval '30 minutes'
  where s.id in (
    select src.id from public.mova_price_pilot_sources src
    join public.mova_price_pilot_settings st on st.artist_business_id = src.artist_business_id and st.enabled
    where src.status = 'active' and src.next_check_at is not null and src.next_check_at <= p_now
    order by src.next_check_at limit greatest(1, least(p_limit, 10)) for update of src skip locked)
  returning s.*
$$;

-- Google coordinates may be kept only for a limited time; clear expired ones (the weekly run refreshes them).
create or replace function public.mova_price_pilot_expire_google_coordinates(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  update public.mova_price_pilot_sources set latitude = null, longitude = null, geo_source = null, geo_expires_at = null
  where geo_source = 'google' and geo_expires_at <= p_now;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.mova_price_pilot_apply(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mova_price_pilot_booking_stats(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mova_price_pilot_enqueue_due_runs(timestamptz) from public, anon, authenticated;
revoke all on function public.mova_price_pilot_claim_runs(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.mova_price_pilot_claim_sources(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.mova_price_pilot_expire_google_coordinates(timestamptz) from public, anon, authenticated;
grant execute on function public.mova_price_pilot_apply(uuid, uuid, jsonb), public.mova_price_pilot_booking_stats(uuid, timestamptz),
  public.mova_price_pilot_enqueue_due_runs(timestamptz), public.mova_price_pilot_claim_runs(integer, timestamptz),
  public.mova_price_pilot_claim_sources(integer, timestamptz), public.mova_price_pilot_expire_google_coordinates(timestamptz) to service_role;
