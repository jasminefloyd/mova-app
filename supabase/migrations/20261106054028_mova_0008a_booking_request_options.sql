alter table public.mova_portfolio_items
  add constraint mova_portfolio_items_business_item_id_uq unique (artist_business_id, id);

alter table public.mova_appointments
  add column alternate_starts_at timestamptz,
  add column client_note text,
  add column portfolio_item_id uuid,
  add constraint mova_appointments_client_note_length_check
    check (client_note is null or char_length(client_note) <= 1000),
  add constraint mova_appointments_alternate_start_distinct_check
    check (alternate_starts_at is null or alternate_starts_at <> starts_at),
  add constraint mova_appointments_portfolio_item_fk
    foreign key (artist_business_id, portfolio_item_id)
    references public.mova_portfolio_items (artist_business_id, id)
    on delete set null (portfolio_item_id);

create or replace function public.mova_booking_create_with_options(
  p_location_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_client_locale text,
  p_idempotency_key text,
  p_manage_token_hash bytea,
  p_alternate_starts_at timestamptz default null,
  p_client_note text default null,
  p_portfolio_item_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  result jsonb;
  appointment public.mova_appointments%rowtype;
  location public.mova_locations%rowtype;
  policies public.mova_location_policies%rowtype;
  alternate_ends_at timestamptz;
begin
  if p_client_note is not null and char_length(trim(p_client_note)) > 1000 then
    raise exception using errcode = '22023', message = 'CLIENT_NOTE_TOO_LONG';
  end if;
  if p_alternate_starts_at is not null and p_alternate_starts_at = p_starts_at then
    raise exception using errcode = '22023', message = 'ALTERNATE_TIME_MUST_DIFFER';
  end if;

  result := public.mova_booking_create(
    p_location_id, p_service_id, p_starts_at, p_client_name, p_client_email,
    p_client_phone, p_client_locale, p_idempotency_key, p_manage_token_hash
  );
  select * into appointment
  from public.mova_appointments
  where id = (result ->> 'id')::uuid;
  if not found then
    raise exception using errcode = 'P0002', message = 'BOOKING_NOT_FOUND';
  end if;
  if coalesce((result ->> 'replayed')::boolean, false) then
    return result;
  end if;

  if p_portfolio_item_id is not null and not exists (
    select 1
    from public.mova_portfolio_items p
    join public.mova_portfolio_service_links l on l.portfolio_item_id = p.id
    where p.id = p_portfolio_item_id
      and p.artist_business_id = appointment.artist_business_id
      and p.is_published
      and l.service_id = appointment.service_id
  ) then
    raise exception using errcode = '22023', message = 'PORTFOLIO_LOOK_NOT_AVAILABLE_FOR_SERVICE';
  end if;

  if p_alternate_starts_at is not null then
    select * into location
    from public.mova_locations
    where id = appointment.location_id and artist_business_id = appointment.artist_business_id;
    if not found or location.booking_mode <> 'request' then
      raise exception using errcode = '22023', message = 'ALTERNATE_TIME_REQUIRES_REQUEST_MODE';
    end if;
    select * into policies
    from public.mova_location_policies
    where location_id = location.id;
    alternate_ends_at := p_alternate_starts_at + (appointment.ends_at - appointment.starts_at);
    if p_alternate_starts_at < appointment.ends_at and alternate_ends_at > appointment.starts_at then
      raise exception using errcode = '22023', message = 'ALTERNATE_TIME_OVERLAPS_FIRST_CHOICE';
    end if;
    if p_alternate_starts_at < now() + make_interval(mins => coalesce(policies.lead_time_minutes, 60))
      or p_alternate_starts_at > now() + make_interval(days => coalesce(policies.booking_horizon_days, 60)) then
      raise exception using errcode = '22023', message = 'ALTERNATE_TIME_OUTSIDE_BOOKING_WINDOW';
    end if;
    if not public.mova_location_window_is_open(location.id, p_alternate_starts_at, alternate_ends_at) then
      raise exception using errcode = '22023', message = 'ALTERNATE_TIME_OUTSIDE_LOCATION_HOURS';
    end if;
    if exists (
      select 1 from public.mova_availability_blocks b
      where b.location_id = location.id
        and b.starts_at < alternate_ends_at + make_interval(mins => coalesce(policies.buffer_after_minutes, 0))
        and b.ends_at > p_alternate_starts_at - make_interval(mins => coalesce(policies.buffer_before_minutes, 0))
    ) or exists (
      select 1 from public.mova_appointments a
      where a.location_id = location.id and a.id <> appointment.id
        and a.status in ('pending_payment', 'pending_artist', 'confirmed', 'completed')
        and a.starts_at < alternate_ends_at + make_interval(mins => coalesce(policies.buffer_after_minutes, 0)) + make_interval(mins => a.buffer_after_minutes)
        and a.ends_at > p_alternate_starts_at - make_interval(mins => coalesce(policies.buffer_before_minutes, 0)) - make_interval(mins => a.buffer_before_minutes)
    ) or exists (
      select 1 from public.mova_booking_holds h
      where h.location_id = location.id and h.status = 'active' and h.expires_at > now()
        and h.starts_at < alternate_ends_at + make_interval(mins => coalesce(policies.buffer_after_minutes, 0))
        and h.ends_at > p_alternate_starts_at - make_interval(mins => coalesce(policies.buffer_before_minutes, 0))
    ) then
      raise exception using errcode = '23505', message = 'ALTERNATE_SLOT_TAKEN';
    end if;
  end if;

  update public.mova_appointments
  set alternate_starts_at = p_alternate_starts_at,
      client_note = nullif(trim(p_client_note), ''),
      portfolio_item_id = p_portfolio_item_id
  where id = appointment.id;
  return result;
end;
$$;

revoke all on function public.mova_booking_create_with_options(uuid, uuid, timestamptz, text, text, text, text, text, bytea, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.mova_booking_create_with_options(uuid, uuid, timestamptz, text, text, text, text, text, bytea, timestamptz, text, uuid) to service_role;
