-- Services can be offered everywhere (legacy default) or only at explicitly selected locations.
alter table public.mova_services
  add column location_assignment_mode text not null default 'all'
  check (location_assignment_mode in ('all', 'selected'));

-- Preserve legacy behaviour for services already available at every active location.
-- An explicit row is also required by the stylist-booking RPC.
insert into public.mova_service_locations(artist_business_id, service_id, location_id)
select s.artist_business_id, s.id, l.id
from public.mova_services s
join public.mova_locations l on l.artist_business_id = s.artist_business_id and l.is_active
where s.location_assignment_mode = 'all'
on conflict (service_id, location_id) do nothing;

create or replace function public.mova_sync_all_service_locations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'mova_services' then
    if new.location_assignment_mode = 'all' then
      insert into public.mova_service_locations(artist_business_id, service_id, location_id)
      select new.artist_business_id, new.id, l.id
      from public.mova_locations l
      where l.artist_business_id = new.artist_business_id and l.is_active
      on conflict (service_id, location_id) do nothing;
    end if;
  else
    insert into public.mova_service_locations(artist_business_id, service_id, location_id)
    select s.artist_business_id, s.id, new.id
    from public.mova_services s
    where s.artist_business_id = new.artist_business_id
      and s.location_assignment_mode = 'all'
      and new.is_active
    on conflict (service_id, location_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger mova_services_sync_all_locations
  after insert or update of location_assignment_mode on public.mova_services
  for each row execute function public.mova_sync_all_service_locations();

create trigger mova_locations_sync_all_services
  after insert or update of is_active on public.mova_locations
  for each row execute function public.mova_sync_all_service_locations();

create or replace function public.mova_service_available_at_location(p_service_id uuid, p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.location_assignment_mode = 'all'
       or exists (
         select 1 from public.mova_service_locations sl
         where sl.service_id = s.id and sl.location_id = p_location_id
       )
     from public.mova_services s where s.id = p_service_id),
    false
  );
$$;

create or replace function public.mova_enforce_service_location_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  checked_service_id uuid;
  checked_location_id uuid;
begin
  if tg_table_name = 'mova_appointments' then
    checked_service_id := new.service_id;
    checked_location_id := new.location_id;
  else
    checked_service_id := new.service_id;
    select a.location_id into checked_location_id
      from public.mova_appointments a
      where a.id = new.appointment_id and a.artist_business_id = new.artist_business_id;
  end if;

  if checked_service_id is not null and checked_location_id is not null
     and not public.mova_service_available_at_location(checked_service_id, checked_location_id) then
    raise exception using errcode = 'P0001', message = 'SERVICE_NOT_OFFERED_AT_LOCATION';
  end if;
  if tg_table_name = 'mova_appointments'
     and exists (
       select 1 from public.mova_appointment_services aps
       where aps.appointment_id = new.id
         and aps.artist_business_id = new.artist_business_id
         and not public.mova_service_available_at_location(aps.service_id, checked_location_id)
     ) then
    raise exception using errcode = 'P0001', message = 'SERVICE_NOT_OFFERED_AT_LOCATION';
  end if;
  return new;
end;
$$;

create trigger mova_appointments_service_location_check
  before insert or update of service_id, location_id on public.mova_appointments
  for each row execute function public.mova_enforce_service_location_assignment();

create trigger mova_appointment_services_location_check
  before insert or update of service_id, appointment_id on public.mova_appointment_services
  for each row execute function public.mova_enforce_service_location_assignment();

revoke all on function public.mova_service_available_at_location(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mova_enforce_service_location_assignment() from public, anon, authenticated;
revoke all on function public.mova_sync_all_service_locations() from public, anon, authenticated;
