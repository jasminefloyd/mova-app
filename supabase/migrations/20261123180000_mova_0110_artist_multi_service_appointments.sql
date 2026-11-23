-- Manual appointments use the same ordered service snapshots as showcase bookings.
-- Checking a slot and booking it use the same rules. Booking locks the location and rechecks.
create function public.mova_artist_appointment_create_multi(
  p_artist_business_id uuid,
  p_client_id uuid,
  p_location_id uuid,
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_idempotency_key text,
  p_check_only boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  loc public.mova_locations%rowtype;
  cl public.mova_clients%rowtype;
  pol public.mova_location_policies%rowtype;
  existing public.mova_appointments%rowtype;
  selected_services jsonb;
  active_count integer;
  offered_count integer;
  total_price bigint;
  total_minutes integer;
  finish timestamptz;
  reserved_from timestamptz;
  reserved_until timestamptz;
  key text := left(coalesce(p_idempotency_key, ''), 200);
  check_only boolean := p_check_only is true;
  new_id uuid;
begin
  if not public.mova_has_artist_membership(p_artist_business_id) then
    raise exception using errcode = '42501', message = 'ARTIST_MEMBERSHIP_REQUIRED';
  end if;

  if not check_only then
    if length(key) < 8 then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_artist_business_id::text || ':' || key, 0));
    select * into existing from public.mova_appointments
      where artist_business_id = p_artist_business_id and idempotency_key = key;
    if found then
      return jsonb_build_object('appointment_id', existing.id, 'ends_at', existing.ends_at);
    end if;
  end if;

  if p_service_ids is null or cardinality(p_service_ids) not between 1 and 8
    or array_ndims(p_service_ids) <> 1
    or cardinality(p_service_ids) <> (select count(distinct id) from unnest(p_service_ids) as requested(id))
  then
    raise exception using errcode = '22023', message = 'SERVICES_INVALID';
  end if;

  if check_only then
    select * into loc from public.mova_locations
      where artist_business_id = p_artist_business_id and id = p_location_id and is_active;
  else
    select * into loc from public.mova_locations
      where artist_business_id = p_artist_business_id and id = p_location_id and is_active
      for update;
  end if;
  if loc.id is null then raise exception using errcode = '22023', message = 'LOCATION_NOT_FOUND'; end if;

  select * into cl from public.mova_clients where artist_business_id = p_artist_business_id and id = p_client_id;
  if not found then raise exception using errcode = '22023', message = 'CLIENT_NOT_FOUND'; end if;

  select count(*), count(*) filter (where offered), sum(price), sum(duration)::integer,
    jsonb_agg(jsonb_build_object(
      'service_id', service_id, 'position', position, 'name', name, 'duration', duration, 'price', price
    ) order by position)
  into active_count, offered_count, total_price, total_minutes, selected_services
  from (
    select s.id as service_id, requested.position, s.name,
      coalesce(link.duration_minutes_override, s.duration_minutes) + s.buffer_minutes as duration,
      coalesce(link.price_minor_override, s.base_price_minor) as price,
      s.location_assignment_mode = 'all' or link.service_id is not null as offered
    from unnest(p_service_ids) with ordinality as requested(id, position)
    join public.mova_services s on s.id = requested.id and s.artist_business_id = p_artist_business_id and s.status = 'active'
    left join public.mova_service_locations link
      on link.service_id = s.id and link.location_id = loc.id and link.artist_business_id = p_artist_business_id
  ) as service_rows;
  if active_count <> cardinality(p_service_ids) then
    raise exception using errcode = '22023', message = 'SERVICE_NOT_FOUND';
  end if;
  if offered_count <> active_count then
    raise exception using errcode = '22023', message = 'SERVICE_NOT_OFFERED_AT_LOCATION';
  end if;

  select * into pol from public.mova_location_policies where location_id = loc.id;
  if p_starts_at is null or p_starts_at < now() + make_interval(mins => coalesce(pol.lead_time_minutes, 60)) then
    raise exception using errcode = '22023', message = 'SLOT_OUTSIDE_BOOKING_WINDOW';
  end if;
  if p_starts_at <= now() then raise exception using errcode = '22023', message = 'SLOT_IN_PAST'; end if;
  finish := p_starts_at + make_interval(mins => total_minutes);
  reserved_from := p_starts_at - make_interval(mins => coalesce(pol.buffer_before_minutes, 0));
  reserved_until := finish + make_interval(mins => coalesce(pol.buffer_after_minutes, 0));

  if not public.mova_location_window_is_open(loc.id, p_starts_at, finish) then
    raise exception using errcode = '22023', message = 'SLOT_OUTSIDE_LOCATION_HOURS';
  end if;
  if exists (
    select 1 from public.mova_availability_blocks b
    where b.location_id = loc.id and b.starts_at < reserved_until and b.ends_at > reserved_from
  ) or exists (
    select 1 from public.mova_appointments a
    where a.location_id = loc.id and a.status in ('pending_payment', 'pending_artist', 'confirmed', 'completed')
      and a.starts_at - make_interval(mins => a.buffer_before_minutes) < reserved_until
      and a.ends_at + make_interval(mins => a.buffer_after_minutes) > reserved_from
  ) or exists (
    select 1 from public.mova_booking_holds h
    where h.location_id = loc.id and h.status = 'active' and h.expires_at > now()
      and h.starts_at < reserved_until and h.ends_at > reserved_from
  ) then
    if check_only then return jsonb_build_object('ends_at', finish, 'available', false); end if;
    raise exception using errcode = '23505', message = 'SLOT_TAKEN';
  end if;

  if check_only then
    return jsonb_build_object('ends_at', finish, 'available', true);
  end if;

  insert into public.mova_appointments (
    artist_business_id, location_id, service_id, client_id, source, status, starts_at, ends_at,
    buffer_before_minutes, buffer_after_minutes, service_name_snapshot, service_price_minor,
    deposit_due_minor, balance_due_minor, client_name, client_email, client_phone, client_locale,
    manage_token_hash, idempotency_key, confirmed_at
  ) values (
    p_artist_business_id, loc.id, (selected_services->0->>'service_id')::uuid, cl.id,
    'artist', 'confirmed', p_starts_at, finish, coalesce(pol.buffer_before_minutes, 0),
    coalesce(pol.buffer_after_minutes, 0), selected_services->0->>'name', total_price,
    0, total_price, cl.display_name, cl.email, cl.phone, cl.preferred_locale,
    sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), key, now()
  ) returning id into new_id;

  insert into public.mova_appointment_services (
    artist_business_id, appointment_id, service_id, position, service_name_snapshot, duration_minutes_snapshot,
    price_minor_snapshot, deposit_type_snapshot, deposit_value_snapshot, deposit_due_minor_snapshot
  )
  select p_artist_business_id, new_id, service_id, position, name, duration, price, 'none', 0, 0
  from jsonb_to_recordset(selected_services) as s(service_id uuid, position smallint, name text, duration integer, price bigint);

  return jsonb_build_object('appointment_id', new_id, 'ends_at', finish);
end;
$$;

revoke all on function public.mova_artist_appointment_create_multi(uuid,uuid,uuid,uuid[],timestamptz,text,boolean) from public, anon;
grant execute on function public.mova_artist_appointment_create_multi(uuid,uuid,uuid,uuid[],timestamptz,text,boolean) to authenticated, service_role;

-- Keep existing single-service callers on the same locked booking path.
create or replace function public.mova_artist_appointment_create(
  p_artist_business_id uuid,
  p_client_id uuid,
  p_location_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_idempotency_key text
) returns uuid
language sql
set search_path = public, pg_temp
as $$
  select (public.mova_artist_appointment_create_multi(
    p_artist_business_id, p_client_id, p_location_id, array[p_service_id], p_starts_at, p_idempotency_key, false
  )->>'appointment_id')::uuid;
$$;
