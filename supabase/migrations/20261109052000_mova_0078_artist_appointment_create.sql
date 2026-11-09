-- P6 screens: New appointment (board 08c). A stylist books a client they already have into a free time.
-- Checks the same things a client booking checks, except the lead-time and booking-window rules
-- (the stylist may book inside the notice window). Creates a confirmed appointment, source 'artist',
-- with no deposit. Deposits and confirmation texts are not sent by this function.
create or replace function public.mova_artist_appointment_create(
  p_artist_business_id uuid,
  p_client_id uuid,
  p_location_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  loc public.mova_locations%rowtype;
  svc public.mova_services%rowtype;
  sl public.mova_service_locations%rowtype;
  cl public.mova_clients%rowtype;
  pol public.mova_location_policies%rowtype;
  existing_id uuid;
  price bigint;
  duration integer;
  finish timestamptz;
  key text := left(coalesce(p_idempotency_key, ''), 200);
  new_id uuid;
begin
  if not public.mova_has_artist_membership(p_artist_business_id) then
    raise exception using errcode = '42501', message = 'ARTIST_MEMBERSHIP_REQUIRED';
  end if;
  if length(key) < 8 then raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  select id into existing_id from public.mova_appointments
    where artist_business_id = p_artist_business_id and idempotency_key = key;
  if found then return existing_id; end if;

  select * into loc from public.mova_locations
    where artist_business_id = p_artist_business_id and id = p_location_id and is_active;
  if not found then raise exception using errcode = '22023', message = 'LOCATION_NOT_FOUND'; end if;

  select * into svc from public.mova_services
    where artist_business_id = p_artist_business_id and id = p_service_id and status = 'active';
  if not found then raise exception using errcode = '22023', message = 'SERVICE_NOT_FOUND'; end if;

  select * into sl from public.mova_service_locations where service_id = svc.id and location_id = loc.id;
  if not found then raise exception using errcode = '22023', message = 'SERVICE_NOT_OFFERED_AT_LOCATION'; end if;

  select * into cl from public.mova_clients where artist_business_id = p_artist_business_id and id = p_client_id;
  if not found then raise exception using errcode = '22023', message = 'CLIENT_NOT_FOUND'; end if;

  select * into pol from public.mova_location_policies where location_id = loc.id;
  price := coalesce(sl.price_minor_override, svc.base_price_minor);
  duration := coalesce(sl.duration_minutes_override, svc.duration_minutes);
  finish := p_starts_at + make_interval(mins => duration);

  if p_starts_at <= now() then raise exception using errcode = '22023', message = 'SLOT_IN_PAST'; end if;
  if not public.mova_location_window_is_open(loc.id, p_starts_at, finish) then
    raise exception using errcode = '22023', message = 'SLOT_OUTSIDE_LOCATION_HOURS';
  end if;
  if exists (select 1 from public.mova_availability_blocks b where b.location_id = loc.id
      and b.starts_at < finish + make_interval(mins => coalesce(pol.buffer_after_minutes, 0))
      and b.ends_at > p_starts_at - make_interval(mins => coalesce(pol.buffer_before_minutes, 0)))
    or exists (select 1 from public.mova_appointments a where a.location_id = loc.id
      and a.status in ('pending_payment','pending_artist','confirmed','completed')
      and a.starts_at < finish + make_interval(mins => coalesce(pol.buffer_after_minutes, 0)) + make_interval(mins => a.buffer_after_minutes)
      and a.ends_at > p_starts_at - make_interval(mins => coalesce(pol.buffer_before_minutes, 0)) - make_interval(mins => a.buffer_before_minutes))
    or exists (select 1 from public.mova_booking_holds h where h.location_id = loc.id and h.status = 'active' and h.expires_at > now()
      and h.starts_at < finish + make_interval(mins => coalesce(pol.buffer_after_minutes, 0))
      and h.ends_at > p_starts_at - make_interval(mins => coalesce(pol.buffer_before_minutes, 0)))
  then raise exception using errcode = '23505', message = 'SLOT_TAKEN'; end if;

  insert into public.mova_appointments(
    artist_business_id, location_id, service_id, client_id, source, status, starts_at, ends_at,
    buffer_before_minutes, buffer_after_minutes, service_name_snapshot, service_price_minor,
    deposit_due_minor, balance_due_minor, client_name, client_email, client_phone, client_locale,
    manage_token_hash, idempotency_key, confirmed_at
  ) values (
    p_artist_business_id, loc.id, svc.id, cl.id, 'artist', 'confirmed', p_starts_at, finish,
    coalesce(pol.buffer_before_minutes, 0), coalesce(pol.buffer_after_minutes, 0), svc.name, price,
    0, price, cl.display_name, cl.email, cl.phone, cl.preferred_locale,
    sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), key, now()
  ) returning id into new_id;

  insert into public.mova_appointment_services(
    artist_business_id, appointment_id, service_id, position, service_name_snapshot, duration_minutes_snapshot,
    price_minor_snapshot, deposit_type_snapshot, deposit_value_snapshot, deposit_due_minor_snapshot
  ) values (p_artist_business_id, new_id, svc.id, 1, svc.name, duration, price, 'none', 0, 0);

  return new_id;
end;
$$;

revoke all on function public.mova_artist_appointment_create(uuid,uuid,uuid,uuid,timestamptz,text) from public, anon;
grant execute on function public.mova_artist_appointment_create(uuid,uuid,uuid,uuid,timestamptz,text) to authenticated, service_role;
