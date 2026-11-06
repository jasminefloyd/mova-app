create table public.mova_locations (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  location_type text not null check (location_type in ('suite','booth','commission_salon','mobile')),
  booking_mode text not null check (booking_mode in ('instant','request')),
  calendar_ownership text not null check (calendar_ownership in ('mova','external')),
  payment_collector text not null check (payment_collector in ('artist','salon')),
  time_zone text not null,
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  display_color_index smallint not null default 0 check (display_color_index between 0 and 11),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_locations_business_id_id_uq unique (artist_business_id, id),
  constraint mova_locations_external_mode_check check (calendar_ownership = 'mova' or booking_mode = 'request')
);

create table public.mova_location_hours (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  location_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  constraint mova_location_hours_positive_span check (opens_at <> closes_at),
  constraint mova_location_hours_location_fk foreign key (artist_business_id, location_id)
    references public.mova_locations(artist_business_id, id) on delete cascade
);
create index mova_location_hours_lookup_idx on public.mova_location_hours(location_id, weekday, opens_at);

create table public.mova_location_exceptions (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  location_id uuid not null,
  exception_date date not null,
  is_closed boolean not null default false,
  hours jsonb not null default '[]'::jsonb check (jsonb_typeof(hours) = 'array'),
  reason text,
  constraint mova_location_exceptions_location_date_uq unique (location_id, exception_date),
  constraint mova_location_exceptions_location_fk foreign key (artist_business_id, location_id)
    references public.mova_locations(artist_business_id, id) on delete cascade
);

create table public.mova_location_policies (
  location_id uuid primary key,
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  lead_time_minutes integer not null default 60 check (lead_time_minutes between 0 and 525600),
  booking_horizon_days integer not null default 60 check (booking_horizon_days between 1 and 730),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 1440),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 1440),
  cancellation_window_minutes integer not null default 1440 check (cancellation_window_minutes between 0 and 525600),
  request_expiry_hours integer not null default 24 check (request_expiry_hours between 1 and 168),
  client_details jsonb not null default '{}'::jsonb check (jsonb_typeof(client_details) = 'object'),
  door_code_encrypted bytea,
  updated_at timestamptz not null default now(),
  constraint mova_location_policies_location_fk foreign key (artist_business_id, location_id)
    references public.mova_locations(artist_business_id, id) on delete cascade
);

alter table public.mova_services add constraint mova_services_id_business_uq unique (id, artist_business_id);
alter table public.mova_service_locations add column artist_business_id uuid references public.mova_artist_businesses(id) on delete cascade;
update public.mova_service_locations service_location
set artist_business_id = service.artist_business_id
from public.mova_services service
where service.id = service_location.service_id;
alter table public.mova_service_locations alter column artist_business_id set not null;
alter table public.mova_service_locations drop constraint if exists mova_service_locations_service_id_location_id_key;
alter table public.mova_service_locations add constraint mova_service_locations_service_business_fk
  foreign key (service_id, artist_business_id) references public.mova_services(id, artist_business_id) on delete cascade;
alter table public.mova_service_locations add constraint mova_service_locations_location_business_fk
  foreign key (artist_business_id, location_id) references public.mova_locations(artist_business_id, id) on delete cascade;
alter table public.mova_service_locations add constraint mova_service_locations_service_location_uq unique (service_id, location_id);
create index mova_service_locations_location_idx on public.mova_service_locations(location_id);

create table public.mova_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  location_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default 'blocked',
  created_at timestamptz not null default now(),
  constraint mova_availability_blocks_positive_span check (starts_at < ends_at),
  constraint mova_availability_blocks_location_fk foreign key (artist_business_id, location_id)
    references public.mova_locations(artist_business_id, id) on delete cascade
);
create index mova_availability_blocks_range_idx on public.mova_availability_blocks(location_id, starts_at, ends_at);

create trigger mova_locations_touch_updated_at before update on public.mova_locations for each row execute function public.mova_touch_updated_at();

alter table public.mova_locations enable row level security;
alter table public.mova_location_hours enable row level security;
alter table public.mova_location_exceptions enable row level security;
alter table public.mova_location_policies enable row level security;
alter table public.mova_availability_blocks enable row level security;

create policy mova_locations_member_select on public.mova_locations for select to authenticated using (public.mova_has_artist_membership(artist_business_id));
create policy mova_locations_member_insert on public.mova_locations for insert to authenticated with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_locations_member_update on public.mova_locations for update to authenticated using (public.mova_has_artist_membership(artist_business_id)) with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_locations_member_delete on public.mova_locations for delete to authenticated using (public.mova_has_artist_membership(artist_business_id));

create policy mova_location_hours_member_all on public.mova_location_hours for all to authenticated
  using (public.mova_has_artist_membership(artist_business_id)) with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_location_exceptions_member_all on public.mova_location_exceptions for all to authenticated
  using (public.mova_has_artist_membership(artist_business_id)) with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_location_policies_member_all on public.mova_location_policies for all to authenticated
  using (public.mova_has_artist_membership(artist_business_id)) with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_availability_blocks_member_all on public.mova_availability_blocks for all to authenticated
  using (public.mova_has_artist_membership(artist_business_id)) with check (public.mova_has_artist_membership(artist_business_id));

grant select, insert, update, delete on public.mova_locations, public.mova_location_hours, public.mova_location_exceptions,
  public.mova_location_policies, public.mova_availability_blocks, public.mova_service_locations to authenticated;

create or replace function public.mova_save_location(
  p_artist_business_id uuid, p_location_id uuid, p_name text, p_location_type text, p_booking_mode text, p_calendar_ownership text,
  p_payment_collector text, p_time_zone text, p_address jsonb, p_display_color_index smallint,
  p_hours jsonb, p_policies jsonb, p_exceptions jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare business_id uuid := p_artist_business_id; saved_id uuid; current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not exists(select 1 from public.mova_artist_memberships membership
      where membership.artist_business_id=business_id and membership.user_id=current_user_id and membership.role='owner' and membership.status='active') then
    raise exception using errcode='42501', message='OWNER_PROFILE_REQUIRED';
  end if;
  if p_time_zone not in (select name from pg_timezone_names) then raise exception using errcode='22023', message='TIME_ZONE_INVALID'; end if;
  if jsonb_typeof(p_hours) <> 'array' or jsonb_typeof(p_policies) <> 'object' or jsonb_typeof(coalesce(p_exceptions,'[]')) <> 'array' then raise exception using errcode='22023', message='LOCATION_DATA_INVALID'; end if;
  if p_calendar_ownership='external' and p_booking_mode<>'request' then raise exception using errcode='22023', message='EXTERNAL_CALENDAR_REQUIRES_REQUEST_MODE'; end if;
  if p_location_id is null then
    insert into public.mova_locations(artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone,address,display_color_index)
    values (business_id,trim(p_name),p_location_type,p_booking_mode,p_calendar_ownership,p_payment_collector,p_time_zone,coalesce(p_address,'{}'),coalesce(p_display_color_index,0)) returning id into saved_id;
  else
    update public.mova_locations set name=trim(p_name),location_type=p_location_type,booking_mode=p_booking_mode,calendar_ownership=p_calendar_ownership,
      payment_collector=p_payment_collector,time_zone=p_time_zone,address=coalesce(p_address,'{}'),display_color_index=coalesce(p_display_color_index,0)
    where id=p_location_id and artist_business_id=business_id returning id into saved_id;
    if saved_id is null then raise exception using errcode='P0002', message='LOCATION_NOT_FOUND'; end if;
    delete from public.mova_location_hours where location_id=saved_id and artist_business_id=business_id;
    delete from public.mova_location_exceptions where location_id=saved_id and artist_business_id=business_id;
  end if;
  insert into public.mova_location_hours(artist_business_id,location_id,weekday,opens_at,closes_at)
  select business_id,saved_id,(entry->>'weekday')::smallint,(entry->>'opens_at')::time,(entry->>'closes_at')::time from jsonb_array_elements(p_hours) entry;
  insert into public.mova_location_exceptions(artist_business_id,location_id,exception_date,is_closed,hours,reason)
  select business_id,saved_id,(entry->>'exception_date')::date,coalesce((entry->>'is_closed')::boolean,false),coalesce(entry->'hours','[]'),nullif(entry->>'reason','') from jsonb_array_elements(coalesce(p_exceptions,'[]')) entry;
  insert into public.mova_location_policies as existing_policy(location_id,artist_business_id,lead_time_minutes,booking_horizon_days,buffer_before_minutes,buffer_after_minutes,cancellation_window_minutes,request_expiry_hours,client_details,door_code_encrypted)
  values(saved_id,business_id,coalesce((p_policies->>'lead_time_minutes')::int,60),coalesce((p_policies->>'booking_horizon_days')::int,60),
    coalesce((p_policies->>'buffer_before_minutes')::int,0),coalesce((p_policies->>'buffer_after_minutes')::int,0),coalesce((p_policies->>'cancellation_window_minutes')::int,1440),
    coalesce((p_policies->>'request_expiry_hours')::int,24),coalesce(p_policies->'client_details','{}'),decode(nullif(p_policies->>'door_code_encrypted_hex',''), 'hex'))
  on conflict(location_id) do update set lead_time_minutes=excluded.lead_time_minutes,booking_horizon_days=excluded.booking_horizon_days,
    buffer_before_minutes=excluded.buffer_before_minutes,buffer_after_minutes=excluded.buffer_after_minutes,cancellation_window_minutes=excluded.cancellation_window_minutes,
    request_expiry_hours=excluded.request_expiry_hours,client_details=excluded.client_details,door_code_encrypted=coalesce(excluded.door_code_encrypted,existing_policy.door_code_encrypted),updated_at=now();
  return saved_id;
end $$;
revoke all on function public.mova_save_location(uuid,uuid,text,text,text,text,text,text,jsonb,smallint,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.mova_save_location(uuid,uuid,text,text,text,text,text,text,jsonb,smallint,jsonb,jsonb,jsonb) to authenticated;
