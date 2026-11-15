-- Location deactivation is allowed only after every open appointment at that
-- location has been closed out. Appointment writes lock the location row so a
-- booking cannot race the closeout check.
create or replace function public.mova_require_active_appointment_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  location_active boolean;
begin
  select location.is_active into location_active
  from public.mova_locations location
  where location.id = new.location_id
    and location.artist_business_id = new.artist_business_id
  for update;

  if not found or not location_active then
    raise exception using errcode = '22023', message = 'LOCATION_NOT_BOOKABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists mova_appointments_require_active_location on public.mova_appointments;
create trigger mova_appointments_require_active_location
  before insert or update of location_id, artist_business_id on public.mova_appointments
  for each row execute function public.mova_require_active_appointment_location();
revoke all on function public.mova_require_active_appointment_location() from public, anon, authenticated;

create or replace function public.mova_set_location_active(
  p_artist_business_id uuid,
  p_location_id uuid,
  p_is_active boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  location_row public.mova_locations%rowtype;
  open_booking_count integer := 0;
begin
  if current_user_id is null or not exists (
    select 1
    from public.mova_artist_memberships membership
    where membership.artist_business_id = p_artist_business_id
      and membership.user_id = current_user_id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'OWNER_PROFILE_REQUIRED';
  end if;

  select * into location_row
  from public.mova_locations location
  where location.id = p_location_id
    and location.artist_business_id = p_artist_business_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'LOCATION_NOT_FOUND';
  end if;

  if not p_is_active then
    select count(*)::integer into open_booking_count
    from public.mova_appointments appointment
    where appointment.artist_business_id = p_artist_business_id
      and appointment.location_id = p_location_id
      and appointment.status in ('pending_payment', 'pending_artist', 'confirmed');

    if open_booking_count > 0 then
      return jsonb_build_object(
        'is_active', location_row.is_active,
        'open_bookings', open_booking_count
      );
    end if;
  end if;

  update public.mova_locations
  set is_active = p_is_active
  where id = p_location_id
    and artist_business_id = p_artist_business_id;

  return jsonb_build_object(
    'is_active', p_is_active,
    'open_bookings', 0
  );
end;
$$;

revoke all on function public.mova_set_location_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.mova_set_location_active(uuid, uuid, boolean) to authenticated;
