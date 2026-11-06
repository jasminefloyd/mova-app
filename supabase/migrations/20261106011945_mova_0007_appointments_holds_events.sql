create table public.mova_appointments (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  location_id uuid not null,
  service_id uuid not null,
  client_id uuid,
  source text not null default 'showcase' check (source in ('showcase','artist','concierge','seat_filler','autopilot','import')),
  status text not null check (status in ('draft','pending_payment','pending_artist','confirmed','completed','cancelled','declined','expired','no_show')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 1440),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 1440),
  service_name_snapshot text not null,
  service_price_minor bigint not null check (service_price_minor >= 0),
  deposit_due_minor bigint not null default 0 check (deposit_due_minor >= 0),
  balance_due_minor bigint not null default 0 check (balance_due_minor >= 0),
  client_name text not null,
  client_email text,
  client_phone text,
  client_locale text not null default 'en-US' check (client_locale in ('en-US','es-US')),
  request_expires_at timestamptz,
  manage_token_hash bytea not null unique,
  idempotency_key text not null,
  cancellation_reason text,
  running_late_minutes integer,
  running_late_sent_at timestamptz,
  reschedule_requested_starts_at timestamptz,
  reschedule_requested_ends_at timestamptz,
  reschedule_requested_at timestamptz,
  artist_suggested_starts_at timestamptz,
  artist_suggested_ends_at timestamptz,
  artist_suggested_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_appointments_location_fk foreign key (artist_business_id, location_id) references public.mova_locations(artist_business_id,id),
  constraint mova_appointments_service_fk foreign key (service_id, artist_business_id) references public.mova_services(id,artist_business_id),
  constraint mova_appointments_positive_span check (starts_at < ends_at),
  constraint mova_appointments_suggested_span check (
    (artist_suggested_starts_at is null and artist_suggested_ends_at is null and artist_suggested_at is null)
    or (artist_suggested_starts_at is not null and artist_suggested_ends_at is not null and artist_suggested_at is not null and artist_suggested_starts_at < artist_suggested_ends_at)
  ),
  constraint mova_appointments_deposit_not_above_price check (deposit_due_minor <= service_price_minor),
  constraint mova_appointments_business_idempotency_uq unique (artist_business_id,idempotency_key)
);
create index mova_appointments_location_starts_idx on public.mova_appointments(location_id,starts_at) where status in ('pending_payment','pending_artist','confirmed','completed');
create index mova_appointments_business_status_idx on public.mova_appointments(artist_business_id,status,starts_at);
create index mova_appointments_manage_hash_idx on public.mova_appointments(manage_token_hash);

create table public.mova_booking_holds (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  appointment_id uuid not null unique references public.mova_appointments(id) on delete cascade,
  location_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','released','consumed','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mova_booking_holds_location_fk foreign key (artist_business_id,location_id) references public.mova_locations(artist_business_id,id),
  constraint mova_booking_holds_positive_span check (starts_at < ends_at)
);
create index mova_booking_holds_live_idx on public.mova_booking_holds(location_id,starts_at,ends_at) where status='active';

create table public.mova_appointment_events (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  appointment_id uuid not null references public.mova_appointments(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_type text not null check (actor_type in ('artist','client','guest','worker','provider')),
  actor_id uuid,
  reason text,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  constraint mova_appointment_events_idempotency_uq unique (appointment_id,idempotency_key)
);

create table public.mova_outbox_events (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid references public.mova_artist_businesses(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index mova_outbox_events_pending_idx on public.mova_outbox_events(occurred_at) where delivered_at is null;

create trigger mova_appointments_touch_updated_at before update on public.mova_appointments for each row execute function public.mova_touch_updated_at();
alter table public.mova_appointments enable row level security;
alter table public.mova_booking_holds enable row level security;
alter table public.mova_appointment_events enable row level security;
alter table public.mova_outbox_events enable row level security;

create policy mova_appointments_artist_select on public.mova_appointments for select to authenticated using (public.mova_has_artist_membership(artist_business_id));
create policy mova_booking_holds_artist_select on public.mova_booking_holds for select to authenticated using (public.mova_has_artist_membership(artist_business_id));
create policy mova_appointment_events_artist_select on public.mova_appointment_events for select to authenticated using (public.mova_has_artist_membership(artist_business_id));
revoke all on public.mova_appointments,public.mova_booking_holds,public.mova_appointment_events,public.mova_outbox_events from anon,authenticated;
grant select on public.mova_appointments,public.mova_booking_holds,public.mova_appointment_events to authenticated;

create or replace function public.mova_location_window_is_open(p_location_id uuid,p_starts_at timestamptz,p_ends_at timestamptz)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
with loc as (select time_zone from public.mova_locations where id=p_location_id and is_active),
local_window as (select time_zone,(p_starts_at at time zone time_zone) as local_start,(p_ends_at at time zone time_zone) as local_end from loc),
schedules as (
  select h.weekday,h.opens_at,h.closes_at from public.mova_location_hours h,local_window w
  where h.location_id=p_location_id and h.weekday in (extract(dow from w.local_start)::int,(extract(dow from w.local_start)::int+6)%7)
    and not exists(select 1 from public.mova_location_exceptions e where e.location_id=p_location_id and e.exception_date=(w.local_start::date - case when h.weekday=(extract(dow from w.local_start)::int+6)%7 then 1 else 0 end))
  union all
  select extract(dow from e.exception_date)::int,(hour->>'opens_at')::time,(hour->>'closes_at')::time
  from public.mova_location_exceptions e
  cross join local_window w
  cross join lateral jsonb_array_elements(e.hours) hour
  where e.location_id=p_location_id and not e.is_closed and e.exception_date in (w.local_start::date,w.local_start::date-1)
)
select exists(select 1 from schedules s,local_window w where
  (s.weekday=extract(dow from w.local_start)::int and s.opens_at<s.closes_at and w.local_start::date=w.local_end::date and w.local_start::time>=s.opens_at and w.local_end::time<=s.closes_at)
  or (s.weekday=extract(dow from w.local_start)::int and s.opens_at>s.closes_at and w.local_start::time>=s.opens_at and w.local_end::date=w.local_start::date+1 and w.local_end::time<=s.closes_at)
  or (s.weekday=(extract(dow from w.local_start)::int+6)%7 and s.opens_at>s.closes_at and w.local_start::time<s.closes_at and w.local_end::date=w.local_start::date and w.local_end::time<=s.closes_at));
$$;
revoke all on function public.mova_location_window_is_open(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.mova_location_window_is_open(uuid,timestamptz,timestamptz) to service_role;

create or replace function public.mova_booking_create(
 p_location_id uuid,p_service_id uuid,p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
 p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare loc public.mova_locations%rowtype; svc public.mova_services%rowtype; pol public.mova_location_policies%rowtype; business_id uuid;
  appointment public.mova_appointments%rowtype; price bigint; duration integer; deposit bigint; finish timestamptz; new_status text;
begin
  select artist_business_id into business_id from public.mova_locations where id=p_location_id and is_active;
  if not found then raise exception using errcode='P0002',message='LOCATION_NOT_BOOKABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(business_id::text||':'||p_idempotency_key,0));
  select * into loc from public.mova_locations where id=p_location_id and is_active for update;
  if not found then raise exception using errcode='P0002',message='LOCATION_NOT_BOOKABLE'; end if;
  select * into svc from public.mova_services where id=p_service_id and artist_business_id=loc.artist_business_id and status='active';
  if not found then raise exception using errcode='P0002',message='SERVICE_NOT_BOOKABLE'; end if;
  select * into pol from public.mova_location_policies where location_id=loc.id;
  select * into appointment from public.mova_appointments where artist_business_id=loc.artist_business_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('id',appointment.id,'status',appointment.status,'replayed',true); end if;
  select coalesce(sl.price_minor_override,svc.base_price_minor),coalesce(sl.duration_minutes_override,svc.duration_minutes)+svc.buffer_minutes
    into price,duration from (select 1) seed left join public.mova_service_locations sl on sl.service_id=svc.id and sl.location_id=loc.id;
  finish:=p_starts_at+make_interval(mins=>duration);
  if p_starts_at < now()+make_interval(mins=>coalesce(pol.lead_time_minutes,60)) or p_starts_at > now()+make_interval(days=>coalesce(pol.booking_horizon_days,60)) then raise exception using errcode='22023',message='SLOT_OUTSIDE_BOOKING_WINDOW'; end if;
  if not public.mova_location_window_is_open(loc.id,p_starts_at,finish) then
    raise exception using errcode='22023',message='SLOT_OUTSIDE_LOCATION_HOURS';
  end if;
  if exists(select 1 from public.mova_availability_blocks b where b.location_id=loc.id and b.starts_at < finish+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and b.ends_at > p_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0)))
    or exists(select 1 from public.mova_appointments a where a.location_id=loc.id and a.status in ('pending_payment','pending_artist','confirmed','completed') and a.starts_at < finish+make_interval(mins=>coalesce(pol.buffer_after_minutes,0))+make_interval(mins=>a.buffer_after_minutes) and a.ends_at > p_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))-make_interval(mins=>a.buffer_before_minutes))
    or exists(select 1 from public.mova_booking_holds h where h.location_id=loc.id and h.status='active' and h.expires_at>now() and h.starts_at<finish+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and h.ends_at>p_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))) then raise exception using errcode='23505',message='SLOT_TAKEN'; end if;
  deposit:=case when loc.payment_collector<>'artist' or svc.deposit_type='none' then 0 when svc.deposit_type='fixed' then least(price,svc.deposit_value) else least(price,(price*svc.deposit_value+5000)/10000) end;
  new_status:=case when deposit>0 then 'pending_payment' when loc.booking_mode='request' then 'pending_artist' else 'confirmed' end;
  insert into public.mova_appointments(artist_business_id,location_id,service_id,source,status,starts_at,ends_at,buffer_before_minutes,buffer_after_minutes,service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,client_name,client_email,client_phone,client_locale,request_expires_at,manage_token_hash,idempotency_key,confirmed_at)
    values(loc.artist_business_id,loc.id,svc.id,'showcase',new_status,p_starts_at,finish,coalesce(pol.buffer_before_minutes,0),coalesce(pol.buffer_after_minutes,0),svc.name,price,deposit,price,trim(p_client_name),nullif(trim(p_client_email),''),nullif(trim(p_client_phone),''),coalesce(p_client_locale,'en-US'),case when loc.booking_mode='request' then now()+make_interval(hours=>coalesce(pol.request_expiry_hours,24)) end,p_manage_token_hash,p_idempotency_key,case when new_status='confirmed' then now() end)
    returning * into appointment;
  insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,reason,idempotency_key)
    values(loc.artist_business_id,appointment.id,null,new_status,'guest','booking_created',p_idempotency_key||':created');
  if new_status='pending_payment' then insert into public.mova_booking_holds(artist_business_id,appointment_id,location_id,starts_at,ends_at,expires_at) values(loc.artist_business_id,appointment.id,loc.id,p_starts_at,finish,now()+interval '10 minutes'); end if;
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values(loc.artist_business_id,'appointment',appointment.id,'appointment.'||new_status,jsonb_build_object('client_locale',coalesce(p_client_locale,'en-US')),p_idempotency_key||':created-event');
  return jsonb_build_object('id',appointment.id,'status',new_status,'deposit_due_minor',deposit,'expires_at',appointment.request_expires_at,'replayed',false);
end $$;
revoke all on function public.mova_booking_create(uuid,uuid,timestamptz,text,text,text,text,text,bytea) from public,anon,authenticated;
grant execute on function public.mova_booking_create(uuid,uuid,timestamptz,text,text,text,text,text,bytea) to service_role;

create or replace function public.mova_booking_transition(p_appointment_id uuid,p_manage_token_hash bytea,p_to_status text,p_actor_type text,p_reason text,p_idempotency_key text,p_deposit_paid boolean default false,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare booking public.mova_appointments%rowtype; pol public.mova_location_policies%rowtype; allowed boolean:=false; old_status text;
begin
  select * into booking from public.mova_appointments where id=p_appointment_id and manage_token_hash=p_manage_token_hash for update;
  if not found then raise exception using errcode='P0002',message='BOOKING_NOT_FOUND'; end if;
  if exists(select 1 from public.mova_appointment_events where appointment_id=booking.id and idempotency_key=p_idempotency_key) then return jsonb_build_object('id',booking.id,'status',booking.status,'replayed',true); end if;
  old_status:=booking.status;
  allowed:=case booking.status when 'pending_payment' then p_to_status in ('confirmed','pending_artist','expired','cancelled') when 'pending_artist' then p_to_status in ('confirmed','declined','expired','cancelled') when 'confirmed' then p_to_status in ('completed','cancelled','no_show') else false end;
  if not allowed then raise exception using errcode='22023',message='BOOKING_TRANSITION_INVALID'; end if;
  if booking.deposit_due_minor>0 and booking.status in ('pending_payment','pending_artist') and p_to_status in ('confirmed','pending_artist') and not p_deposit_paid then raise exception using errcode='42501',message='DEPOSIT_PAYMENT_REQUIRED'; end if;
  if booking.status='pending_artist' and booking.request_expires_at<=now() and p_to_status in ('confirmed','pending_artist') then raise exception using errcode='22023',message='REQUEST_EXPIRED'; end if;
  if booking.status='pending_payment' and p_to_status='confirmed' and not exists(select 1 from public.mova_booking_holds h where h.appointment_id=booking.id and h.status='active' and h.expires_at>now()) then raise exception using errcode='42501',message='PAYMENT_HOLD_EXPIRED'; end if;
  if p_actor_type in ('client','guest') and booking.status='confirmed' and p_to_status='cancelled' then
    select * into pol from public.mova_location_policies where location_id=booking.location_id;
    if now()>booking.starts_at-make_interval(mins=>coalesce(pol.cancellation_window_minutes,1440)) then raise exception using errcode='42501',message='CANCELLATION_WINDOW_CLOSED'; end if;
  end if;
  update public.mova_appointments set status=p_to_status,cancelled_at=case when p_to_status='cancelled' then now() else cancelled_at end,confirmed_at=case when p_to_status='confirmed' then now() else confirmed_at end,cancellation_reason=p_reason,
    artist_suggested_starts_at=case when p_to_status='pending_artist' then artist_suggested_starts_at else null end,
    artist_suggested_ends_at=case when p_to_status='pending_artist' then artist_suggested_ends_at else null end,
    artist_suggested_at=case when p_to_status='pending_artist' then artist_suggested_at else null end
    where id=booking.id returning * into booking;
  update public.mova_booking_holds set status=case when p_to_status in ('confirmed','pending_artist') then 'consumed' when p_to_status in ('cancelled','declined','expired') then 'released' else status end where appointment_id=booking.id and status='active';
  insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,actor_id,reason,idempotency_key) values(booking.artist_business_id,booking.id,old_status,p_to_status,p_actor_type,p_actor_id,p_reason,p_idempotency_key);
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values(booking.artist_business_id,'appointment',booking.id,'appointment.'||p_to_status,jsonb_build_object('client_locale',booking.client_locale),p_idempotency_key||':event') on conflict(idempotency_key) do nothing;
  if p_to_status in ('cancelled','no_show') and exists(select 1 from public.mova_locations where id=booking.location_id and calendar_ownership='mova') then
    insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values(booking.artist_business_id,'appointment',booking.id,'slot.opened',jsonb_build_object('location_id',booking.location_id,'starts_at',booking.starts_at,'ends_at',booking.ends_at),booking.id::text||':slot-opened') on conflict(idempotency_key) do nothing;
  end if;
  return jsonb_build_object('id',booking.id,'status',booking.status,'replayed',false);
end $$;
revoke all on function public.mova_booking_transition(uuid,bytea,text,text,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.mova_booking_transition(uuid,bytea,text,text,text,text,boolean,uuid) to service_role;

create or replace function public.mova_booking_reschedule(p_appointment_id uuid,p_manage_token_hash bytea,p_new_starts_at timestamptz,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare booking public.mova_appointments%rowtype; loc public.mova_locations%rowtype; pol public.mova_location_policies%rowtype; span interval;
begin
  select * into booking from public.mova_appointments where id=p_appointment_id and manage_token_hash=p_manage_token_hash for update;
  if not found or booking.status<>'confirmed' then raise exception using errcode='P0002',message='BOOKING_NOT_RESCHEDULABLE'; end if;
  if exists(select 1 from public.mova_appointment_events where appointment_id=booking.id and idempotency_key=p_idempotency_key) then return jsonb_build_object('id',booking.id,'status',booking.status,'starts_at',booking.starts_at,'replayed',true); end if;
  select * into loc from public.mova_locations where id=booking.location_id and is_active for update;
  select * into pol from public.mova_location_policies where location_id=booking.location_id;
  if now()>booking.starts_at-make_interval(mins=>coalesce(pol.cancellation_window_minutes,1440)) then raise exception using errcode='42501',message='RESCHEDULE_WINDOW_CLOSED'; end if;
  if p_new_starts_at<now()+make_interval(mins=>coalesce(pol.lead_time_minutes,60)) or p_new_starts_at>now()+make_interval(days=>coalesce(pol.booking_horizon_days,60)) then raise exception using errcode='22023',message='SLOT_OUTSIDE_BOOKING_WINDOW'; end if;
  span:=booking.ends_at-booking.starts_at;
  if exists(select 1 from public.mova_availability_blocks b where b.location_id=loc.id and b.starts_at<p_new_starts_at+span+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and b.ends_at>p_new_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0)))
    or exists(select 1 from public.mova_booking_holds h where h.location_id=loc.id and h.status='active' and h.expires_at>now() and h.appointment_id<>booking.id and h.starts_at<p_new_starts_at+span+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and h.ends_at>p_new_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))) then raise exception using errcode='23505',message='SLOT_TAKEN'; end if;
  if not public.mova_location_window_is_open(loc.id,p_new_starts_at,p_new_starts_at+span) then raise exception using errcode='22023',message='SLOT_OUTSIDE_LOCATION_HOURS'; end if;
  if exists(select 1 from public.mova_appointments a where a.location_id=loc.id and a.id<>booking.id and a.status in ('pending_payment','pending_artist','confirmed','completed') and a.starts_at<p_new_starts_at+span+make_interval(mins=>coalesce(pol.buffer_after_minutes,0))+make_interval(mins=>a.buffer_after_minutes) and a.ends_at>p_new_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))-make_interval(mins=>a.buffer_before_minutes)) then raise exception using errcode='23505',message='SLOT_TAKEN'; end if;
  if loc.booking_mode='request' then
    update public.mova_appointments set reschedule_requested_starts_at=p_new_starts_at,reschedule_requested_ends_at=p_new_starts_at+span,reschedule_requested_at=now() where id=booking.id returning * into booking;
  else
    update public.mova_appointments set starts_at=p_new_starts_at,ends_at=p_new_starts_at+span where id=booking.id returning * into booking;
  end if;
  insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,reason,idempotency_key) values(booking.artist_business_id,booking.id,'confirmed','confirmed','guest',case when loc.booking_mode='request' then 'reschedule_request:' else 'client_rescheduled:' end||p_new_starts_at::text,p_idempotency_key);
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(booking.artist_business_id,'appointment',booking.id,case when loc.booking_mode='request' then 'appointment.reschedule_requested' else 'appointment.rescheduled' end,jsonb_build_object('starts_at',case when loc.booking_mode='request' then booking.reschedule_requested_starts_at else booking.starts_at end,'ends_at',case when loc.booking_mode='request' then booking.reschedule_requested_ends_at else booking.ends_at end,'client_locale',booking.client_locale),p_idempotency_key||':rescheduled') on conflict(idempotency_key) do nothing;
  return jsonb_build_object('id',booking.id,'status',booking.status,'starts_at',booking.starts_at,'ends_at',booking.ends_at,'reschedule_pending',loc.booking_mode='request','replayed',false);
end $$;
revoke all on function public.mova_booking_reschedule(uuid,bytea,timestamptz,text) from public,anon,authenticated;
grant execute on function public.mova_booking_reschedule(uuid,bytea,timestamptz,text) to service_role;

create or replace function public.mova_booking_reschedule_review(p_appointment_id uuid,p_action text,p_idempotency_key text,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare booking public.mova_appointments%rowtype; loc public.mova_locations%rowtype;
begin
  select * into booking from public.mova_appointments where id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='RESCHEDULE_REQUEST_NOT_FOUND'; end if;
  if exists(select 1 from public.mova_appointment_events where appointment_id=booking.id and idempotency_key=p_idempotency_key) then return jsonb_build_object('id',booking.id,'status',booking.status,'replayed',true); end if;
  if booking.reschedule_requested_starts_at is null then raise exception using errcode='P0002',message='RESCHEDULE_REQUEST_NOT_FOUND'; end if;
  if p_action not in ('accept','decline') then raise exception using errcode='22023',message='RESCHEDULE_ACTION_INVALID'; end if;
  select * into loc from public.mova_locations where id=booking.location_id and is_active for update;
  if p_action='accept' then
    if exists(select 1 from public.mova_appointments a where a.location_id=loc.id and a.id<>booking.id and a.status in ('pending_payment','pending_artist','confirmed','completed') and a.starts_at<booking.reschedule_requested_ends_at+make_interval(mins=>a.buffer_after_minutes) and a.ends_at>booking.reschedule_requested_starts_at-make_interval(mins=>a.buffer_before_minutes)) then raise exception using errcode='23505',message='SLOT_TAKEN'; end if;
    update public.mova_appointments set starts_at=reschedule_requested_starts_at,ends_at=reschedule_requested_ends_at,reschedule_requested_starts_at=null,reschedule_requested_ends_at=null,reschedule_requested_at=null where id=booking.id returning * into booking;
  else
    update public.mova_appointments set reschedule_requested_starts_at=null,reschedule_requested_ends_at=null,reschedule_requested_at=null where id=booking.id returning * into booking;
  end if;
  insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,actor_id,reason,idempotency_key) values(booking.artist_business_id,booking.id,'confirmed','confirmed','artist',p_actor_id,'reschedule_'||p_action,p_idempotency_key);
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(booking.artist_business_id,'appointment',booking.id,'appointment.reschedule_'||p_action,jsonb_build_object('starts_at',booking.starts_at,'client_locale',booking.client_locale),p_idempotency_key||':event') on conflict(idempotency_key) do nothing;
  return jsonb_build_object('id',booking.id,'status',booking.status,'starts_at',booking.starts_at,'reschedule_pending',booking.reschedule_requested_starts_at is not null,'replayed',false);
end $$;
revoke all on function public.mova_booking_reschedule_review(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_booking_reschedule_review(uuid,text,text,uuid) to service_role;

create or replace function public.mova_booking_suggest_time(p_appointment_id uuid,p_artist_business_id uuid,p_suggested_starts_at timestamptz,p_idempotency_key text,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare booking public.mova_appointments%rowtype; loc public.mova_locations%rowtype; pol public.mova_location_policies%rowtype; span interval; suggested_end timestamptz;
begin
  select * into booking from public.mova_appointments where id=p_appointment_id and artist_business_id=p_artist_business_id for update;
  if not found then raise exception using errcode='P0002',message='REQUEST_NOT_SUGGESTIBLE'; end if;
  if exists(select 1 from public.mova_appointment_events where appointment_id=booking.id and idempotency_key=p_idempotency_key) then return jsonb_build_object('id',booking.id,'status',booking.status,'artist_suggested_starts_at',booking.artist_suggested_starts_at,'replayed',true); end if;
  if booking.status<>'pending_artist' or booking.request_expires_at<=now() then raise exception using errcode='P0002',message='REQUEST_NOT_SUGGESTIBLE'; end if;
  if booking.deposit_due_minor>0 then raise exception using errcode='22023',message='PAYMENT_REQUIRED'; end if;
  select * into loc from public.mova_locations where id=booking.location_id and is_active for update;
  select * into pol from public.mova_location_policies where location_id=booking.location_id;
  span:=booking.ends_at-book.starts_at;
  suggested_end:=p_suggested_starts_at+span;
  if p_suggested_starts_at<now()+make_interval(mins=>coalesce(pol.lead_time_minutes,60)) or p_suggested_starts_at>now()+make_interval(days=>coalesce(pol.booking_horizon_days,60)) then raise exception using errcode='22023',message='SLOT_OUTSIDE_BOOKING_WINDOW'; end if;
  if not public.mova_location_window_is_open(loc.id,p_suggested_starts_at,suggested_end) then raise exception using errcode='22023',message='SLOT_OUTSIDE_LOCATION_HOURS'; end if;
  if exists(select 1 from public.mova_availability_blocks b where b.location_id=loc.id and b.starts_at<suggested_end+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and b.ends_at>p_suggested_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0)))
    or exists(select 1 from public.mova_appointments a where a.location_id=loc.id and a.id<>booking.id and a.status in ('pending_payment','pending_artist','confirmed','completed') and a.starts_at<suggested_end+make_interval(mins=>coalesce(pol.buffer_after_minutes,0))+make_interval(mins=>a.buffer_after_minutes) and a.ends_at>p_suggested_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))-make_interval(mins=>a.buffer_before_minutes))
    or exists(select 1 from public.mova_booking_holds h where h.location_id=loc.id and h.appointment_id<>booking.id and h.status='active' and h.expires_at>now() and h.starts_at<suggested_end+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and h.ends_at>p_suggested_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))) then raise exception using errcode='23505',message='SLOT_TAKEN'; end if;
  update public.mova_appointments set artist_suggested_starts_at=p_suggested_starts_at,artist_suggested_ends_at=suggested_end,artist_suggested_at=now() where id=booking.id returning * into booking;
  insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,actor_id,reason,idempotency_key) values(booking.artist_business_id,booking.id,'pending_artist','pending_artist','artist',p_actor_id,'time_suggested:'||p_suggested_starts_at::text,p_idempotency_key);
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(booking.artist_business_id,'appointment',booking.id,'appointment.time_suggested',jsonb_build_object('starts_at',p_suggested_starts_at,'ends_at',suggested_end,'client_locale',booking.client_locale),p_idempotency_key||':suggested') on conflict(idempotency_key) do nothing;
  return jsonb_build_object('id',booking.id,'status',booking.status,'artist_suggested_starts_at',booking.artist_suggested_starts_at,'replayed',false);
end $$;
revoke all on function public.mova_booking_suggest_time(uuid,uuid,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_booking_suggest_time(uuid,uuid,timestamptz,text,uuid) to service_role;

create or replace function public.mova_booking_suggestion_response(p_appointment_id uuid,p_manage_token_hash bytea,p_action text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare booking public.mova_appointments%rowtype; loc public.mova_locations%rowtype; pol public.mova_location_policies%rowtype;
begin
  select * into booking from public.mova_appointments where id=p_appointment_id and manage_token_hash=p_manage_token_hash for update;
  if not found then raise exception using errcode='P0002',message='TIME_SUGGESTION_NOT_FOUND'; end if;
  if exists(select 1 from public.mova_appointment_events where appointment_id=booking.id and idempotency_key=p_idempotency_key) then return jsonb_build_object('id',booking.id,'status',booking.status,'replayed',true); end if;
  if booking.status<>'pending_artist' or booking.artist_suggested_starts_at is null or booking.request_expires_at<=now() then raise exception using errcode='P0002',message='TIME_SUGGESTION_NOT_FOUND'; end if;
  if p_action not in ('accept','decline') then raise exception using errcode='22023',message='SUGGESTION_ACTION_INVALID'; end if;
  if p_action='accept' then
    if booking.deposit_due_minor>0 then raise exception using errcode='22023',message='PAYMENT_REQUIRED'; end if;
    select * into loc from public.mova_locations where id=booking.location_id and is_active for update;
    select * into pol from public.mova_location_policies where location_id=booking.location_id;
    if booking.artist_suggested_starts_at<now()+make_interval(mins=>coalesce(pol.lead_time_minutes,60)) or booking.artist_suggested_starts_at>now()+make_interval(days=>coalesce(pol.booking_horizon_days,60)) then raise exception using errcode='22023',message='SLOT_OUTSIDE_BOOKING_WINDOW'; end if;
    if not public.mova_location_window_is_open(loc.id,booking.artist_suggested_starts_at,booking.artist_suggested_ends_at) then raise exception using errcode='22023',message='SLOT_OUTSIDE_LOCATION_HOURS'; end if;
    if exists(select 1 from public.mova_availability_blocks b where b.location_id=loc.id and b.starts_at<booking.artist_suggested_ends_at+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and b.ends_at>booking.artist_suggested_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0)))
      or exists(select 1 from public.mova_appointments a where a.location_id=loc.id and a.id<>booking.id and a.status in ('pending_payment','pending_artist','confirmed','completed') and a.starts_at<booking.artist_suggested_ends_at+make_interval(mins=>coalesce(pol.buffer_after_minutes,0))+make_interval(mins=>a.buffer_after_minutes) and a.ends_at>booking.artist_suggested_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))-make_interval(mins=>a.buffer_before_minutes))
      or exists(select 1 from public.mova_booking_holds h where h.location_id=loc.id and h.appointment_id<>booking.id and h.status='active' and h.expires_at>now() and h.starts_at<booking.artist_suggested_ends_at+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and h.ends_at>booking.artist_suggested_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))) then raise exception using errcode='23505',message='SLOT_TAKEN'; end if;
    update public.mova_appointments set starts_at=artist_suggested_starts_at,ends_at=artist_suggested_ends_at,status='confirmed',confirmed_at=now(),request_expires_at=null,artist_suggested_starts_at=null,artist_suggested_ends_at=null,artist_suggested_at=null where id=booking.id returning * into booking;
  else
    update public.mova_appointments set artist_suggested_starts_at=null,artist_suggested_ends_at=null,artist_suggested_at=null where id=booking.id returning * into booking;
  end if;
  insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,reason,idempotency_key) values(booking.artist_business_id,booking.id,'pending_artist',booking.status,'guest','time_suggestion_'||p_action,p_idempotency_key);
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(booking.artist_business_id,'appointment',booking.id,'appointment.time_suggestion_'||p_action,jsonb_build_object('starts_at',booking.starts_at,'client_locale',booking.client_locale),p_idempotency_key||':response') on conflict(idempotency_key) do nothing;
  return jsonb_build_object('id',booking.id,'status',booking.status,'starts_at',booking.starts_at,'replayed',false);
end $$;
revoke all on function public.mova_booking_suggestion_response(uuid,bytea,text,text) from public,anon,authenticated;
grant execute on function public.mova_booking_suggestion_response(uuid,bytea,text,text) to service_role;

create or replace function public.mova_expire_booking_requests(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer;
begin
  with candidates as (
    select a.id,a.status,a.artist_business_id,a.client_locale from public.mova_appointments a
    where a.status in ('pending_payment','pending_artist') and
      (case when a.status='pending_payment' then
        coalesce((select h.expires_at from public.mova_booking_holds h where h.appointment_id=a.id),a.request_expires_at)
      else a.request_expires_at end)<=p_now
    for update
  ), expired as (
    update public.mova_appointments a set status='expired',artist_suggested_starts_at=null,artist_suggested_ends_at=null,artist_suggested_at=null from candidates c where a.id=c.id
    returning a.id,a.artist_business_id,c.status as from_status,a.client_locale
  ), released as (
    update public.mova_booking_holds set status='expired' where appointment_id in (select id from expired) and status='active'
  ), events as (
    insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,reason,idempotency_key)
    select artist_business_id,id,from_status,'expired','worker','request_expired',id::text||':expired' from expired
    on conflict(appointment_id,idempotency_key) do nothing returning appointment_id,artist_business_id
  )
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  select artist_business_id,'appointment',id,'appointment.expired',jsonb_build_object('client_locale',client_locale),id::text||':request-expired'
  from expired on conflict(idempotency_key) do nothing;
  get diagnostics changed=row_count;
  return changed;
end $$;
revoke all on function public.mova_expire_booking_requests(timestamptz) from public,anon,authenticated;
grant execute on function public.mova_expire_booking_requests(timestamptz) to service_role;
