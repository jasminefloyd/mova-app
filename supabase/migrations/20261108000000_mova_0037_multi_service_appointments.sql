-- O12 approved 2026-11-08: ordered multi-service appointments.
-- Duration snapshots include each service's service buffer; location buffers
-- remain on the appointment and surround the combined interval.
create table public.mova_appointment_services (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  appointment_id uuid not null,
  service_id uuid not null,
  position smallint not null check (position between 1 and 8),
  service_name_snapshot text not null check (length(trim(service_name_snapshot)) > 0),
  duration_minutes_snapshot integer not null check (duration_minutes_snapshot between 5 and 2880),
  price_minor_snapshot bigint not null check (price_minor_snapshot >= 0),
  deposit_type_snapshot text not null check (deposit_type_snapshot in ('none','fixed','percent')),
  deposit_value_snapshot integer not null check (deposit_value_snapshot >= 0),
  deposit_due_minor_snapshot bigint not null check (deposit_due_minor_snapshot >= 0),
  created_at timestamptz not null default now(),
  constraint mova_appointment_services_appointment_fk foreign key (appointment_id, artist_business_id)
    references public.mova_appointments(id, artist_business_id) on delete cascade,
  constraint mova_appointment_services_service_fk foreign key (service_id, artist_business_id)
    references public.mova_services(id, artist_business_id),
  constraint mova_appointment_services_position_uq unique (appointment_id, position),
  constraint mova_appointment_services_distinct_uq unique (appointment_id, service_id)
);
create index mova_appointment_services_business_appointment_idx
  on public.mova_appointment_services(artist_business_id, appointment_id, position);
alter table public.mova_appointment_services enable row level security;
create policy mova_appointment_services_member_select on public.mova_appointment_services
  for select to authenticated using (public.mova_has_artist_membership(artist_business_id));
revoke all on public.mova_appointment_services from anon, authenticated;
grant select on public.mova_appointment_services to authenticated;
grant all on public.mova_appointment_services to service_role;

-- Preserve every existing appointment as a single-service appointment. The
-- booked interval is the authoritative legacy duration snapshot.
insert into public.mova_appointment_services(
  artist_business_id, appointment_id, service_id, position,
  service_name_snapshot, duration_minutes_snapshot, price_minor_snapshot,
  deposit_type_snapshot, deposit_value_snapshot, deposit_due_minor_snapshot
)
select a.artist_business_id, a.id, a.service_id, 1,
       a.service_name_snapshot,
       greatest(5, ceil(extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer),
       a.service_price_minor, coalesce(s.deposit_type, 'none'), coalesce(s.deposit_value, 0),
       a.deposit_due_minor
from public.mova_appointments a
left join public.mova_services s on s.id = a.service_id and s.artist_business_id = a.artist_business_id;

create or replace function public.mova_booking_create_multi(
 p_location_id uuid,p_service_ids uuid[],p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
 p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare loc public.mova_locations%rowtype; pol public.mova_location_policies%rowtype; appointment public.mova_appointments%rowtype;
  business_id uuid; first_service_id uuid; first_service_name text; total_price bigint:=0; total_duration integer:=0;
  total_deposit bigint:=0; finish timestamptz; new_status text; row_service record; row_price bigint; row_duration integer; row_deposit bigint;
begin
  if p_service_ids is null or cardinality(p_service_ids)<1 or cardinality(p_service_ids)>8
    or array_position(p_service_ids,null) is not null
    or cardinality(p_service_ids)<>(select count(distinct service_id) from unnest(p_service_ids) as requested(service_id)) then
    raise exception using errcode='22023',message='SERVICES_INVALID';
  end if;
  select artist_business_id into business_id from public.mova_locations where id=p_location_id and is_active;
  if not found then raise exception using errcode='P0002',message='LOCATION_NOT_BOOKABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(business_id::text||':'||p_idempotency_key,0));
  select * into loc from public.mova_locations where id=p_location_id and is_active for update;
  if not found then raise exception using errcode='P0002',message='LOCATION_NOT_BOOKABLE'; end if;
  select * into pol from public.mova_location_policies where location_id=loc.id;
  select * into appointment from public.mova_appointments where artist_business_id=loc.artist_business_id and idempotency_key=p_idempotency_key;
  if found then
    if appointment.deposit_due_minor>0 and coalesce(current_setting('mova.allow_deposit_bookings',true),'off')<>'on' then raise exception using errcode='22023',message='DEPOSIT_PAYMENT_UNAVAILABLE'; end if;
    return jsonb_build_object('id',appointment.id,'status',appointment.status,'replayed',true);
  end if;
  if (select count(*) from unnest(p_service_ids) with ordinality q(service_id,position)
      join public.mova_services s on s.id=q.service_id and s.artist_business_id=loc.artist_business_id and s.status='active')<>cardinality(p_service_ids) then
    raise exception using errcode='P0002',message='SERVICE_NOT_BOOKABLE';
  end if;
  for row_service in
    select q.service_id,q.position,s.name,s.deposit_type,s.deposit_value,
      coalesce(sl.price_minor_override,s.base_price_minor)::bigint as effective_price,
      coalesce(sl.duration_minutes_override,s.duration_minutes)+s.buffer_minutes as effective_duration
    from unnest(p_service_ids) with ordinality q(service_id,position)
    join public.mova_services s on s.id=q.service_id and s.artist_business_id=loc.artist_business_id and s.status='active'
    left join public.mova_service_locations sl on sl.service_id=s.id and sl.location_id=loc.id
    order by q.position
  loop
    if row_service.position=1 then first_service_id:=row_service.service_id; first_service_name:=row_service.name; end if;
    row_price:=row_service.effective_price; row_duration:=row_service.effective_duration;
    row_deposit:=case when loc.payment_collector<>'artist' or row_service.deposit_type='none' then 0
      when row_service.deposit_type='fixed' then least(row_price,row_service.deposit_value)
      else least(row_price,(row_price*row_service.deposit_value+5000)/10000) end;
    total_price:=total_price+row_price; total_duration:=total_duration+row_duration; total_deposit:=total_deposit+row_deposit;
  end loop;
  total_deposit:=least(total_price,total_deposit);
  finish:=p_starts_at+make_interval(mins=>total_duration);
  if p_starts_at<now()+make_interval(mins=>coalesce(pol.lead_time_minutes,60)) or p_starts_at>now()+make_interval(days=>coalesce(pol.booking_horizon_days,60)) then raise exception using errcode='22023',message='SLOT_OUTSIDE_BOOKING_WINDOW'; end if;
  if not public.mova_location_window_is_open(loc.id,p_starts_at,finish) then raise exception using errcode='22023',message='SLOT_OUTSIDE_LOCATION_HOURS'; end if;
  if exists(select 1 from public.mova_availability_blocks b where b.location_id=loc.id and b.starts_at<finish+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and b.ends_at>p_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0)))
    or exists(select 1 from public.mova_appointments a where a.location_id=loc.id and a.status in ('pending_payment','pending_artist','confirmed','completed') and a.starts_at<finish+make_interval(mins=>coalesce(pol.buffer_after_minutes,0))+make_interval(mins=>a.buffer_after_minutes) and a.ends_at>p_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))-make_interval(mins=>a.buffer_before_minutes))
    or exists(select 1 from public.mova_booking_holds h where h.location_id=loc.id and h.status='active' and h.expires_at>now() and h.starts_at<finish+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and h.ends_at>p_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))) then raise exception using errcode='23505',message='SLOT_TAKEN'; end if;
  if total_deposit>0 and coalesce(current_setting('mova.allow_deposit_bookings',true),'off')<>'on' then raise exception using errcode='22023',message='DEPOSIT_PAYMENT_UNAVAILABLE'; end if;
  new_status:=case when total_deposit>0 then 'pending_payment' when loc.booking_mode='request' then 'pending_artist' else 'confirmed' end;
  insert into public.mova_appointments(artist_business_id,location_id,service_id,source,status,starts_at,ends_at,buffer_before_minutes,buffer_after_minutes,service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,client_name,client_email,client_phone,client_locale,request_expires_at,manage_token_hash,idempotency_key,confirmed_at)
    values(loc.artist_business_id,loc.id,first_service_id,'showcase',new_status,p_starts_at,finish,coalesce(pol.buffer_before_minutes,0),coalesce(pol.buffer_after_minutes,0),first_service_name,total_price,total_deposit,total_price,trim(p_client_name),nullif(trim(p_client_email),''),nullif(trim(p_client_phone),''),coalesce(p_client_locale,'en-US'),case when new_status='pending_artist' then now()+make_interval(hours=>coalesce(pol.request_expiry_hours,24)) end,p_manage_token_hash,p_idempotency_key,case when new_status='confirmed' then now() end)
    returning * into appointment;
  for row_service in
    select q.service_id,q.position,s.name,s.deposit_type,s.deposit_value,
      coalesce(sl.price_minor_override,s.base_price_minor)::bigint as effective_price,
      coalesce(sl.duration_minutes_override,s.duration_minutes)+s.buffer_minutes as effective_duration
    from unnest(p_service_ids) with ordinality q(service_id,position)
    join public.mova_services s on s.id=q.service_id and s.artist_business_id=loc.artist_business_id and s.status='active'
    left join public.mova_service_locations sl on sl.service_id=s.id and sl.location_id=loc.id order by q.position
  loop
    row_deposit:=case when loc.payment_collector<>'artist' or row_service.deposit_type='none' then 0
      when row_service.deposit_type='fixed' then least(row_service.effective_price,row_service.deposit_value)
      else least(row_service.effective_price,(row_service.effective_price*row_service.deposit_value+5000)/10000) end;
    insert into public.mova_appointment_services(artist_business_id,appointment_id,service_id,position,service_name_snapshot,duration_minutes_snapshot,price_minor_snapshot,deposit_type_snapshot,deposit_value_snapshot,deposit_due_minor_snapshot)
      values(loc.artist_business_id,appointment.id,row_service.service_id,row_service.position,row_service.name,row_service.effective_duration,row_service.effective_price,row_service.deposit_type,row_service.deposit_value,row_deposit);
  end loop;
  insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,reason,idempotency_key)
    values(loc.artist_business_id,appointment.id,null,new_status,'guest','booking_created',p_idempotency_key||':created');
  if new_status='pending_payment' then insert into public.mova_booking_holds(artist_business_id,appointment_id,location_id,starts_at,ends_at,expires_at) values(loc.artist_business_id,appointment.id,loc.id,p_starts_at,finish,now()+interval '10 minutes'); end if;
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values(loc.artist_business_id,'appointment',appointment.id,'appointment.'||new_status,jsonb_build_object('client_locale',coalesce(p_client_locale,'en-US')),p_idempotency_key||':created-event');
  return jsonb_build_object('id',appointment.id,'status',new_status,'deposit_due_minor',total_deposit,'service_price_minor',total_price,'service_ids',p_service_ids,'expires_at',appointment.request_expires_at,'replayed',false);
end $$;
revoke all on function public.mova_booking_create_multi(uuid,uuid[],timestamptz,text,text,text,text,text,bytea) from public,anon,authenticated;
grant execute on function public.mova_booking_create_multi(uuid,uuid[],timestamptz,text,text,text,text,text,bytea) to service_role;

-- Old callers remain supported and create a one-row service snapshot.
create or replace function public.mova_booking_create(
 p_location_id uuid,p_service_id uuid,p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
 p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea
) returns jsonb language sql security definer set search_path=public,auth,pg_temp as $$
  select public.mova_booking_create_multi(p_location_id,array[p_service_id],p_starts_at,p_client_name,p_client_email,p_client_phone,p_client_locale,p_idempotency_key,p_manage_token_hash);
$$;
revoke all on function public.mova_booking_create(uuid,uuid,timestamptz,text,text,text,text,text,bytea) from public,anon,authenticated;
grant execute on function public.mova_booking_create(uuid,uuid,timestamptz,text,text,text,text,text,bytea) to service_role;

create or replace function public.mova_booking_create_multi_with_options(
 p_location_id uuid,p_service_ids uuid[],p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
 p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea,p_alternate_starts_at timestamptz default null,
 p_client_note text default null,p_portfolio_item_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare result jsonb; appointment public.mova_appointments%rowtype; location public.mova_locations%rowtype; policies public.mova_location_policies%rowtype; alternate_ends_at timestamptz;
begin
  if p_client_note is not null and char_length(trim(p_client_note))>1000 then raise exception using errcode='22023',message='CLIENT_NOTE_TOO_LONG'; end if;
  if p_alternate_starts_at is not null and p_alternate_starts_at=p_starts_at then raise exception using errcode='22023',message='ALTERNATE_TIME_MUST_DIFFER'; end if;
  result:=public.mova_booking_create_multi(p_location_id,p_service_ids,p_starts_at,p_client_name,p_client_email,p_client_phone,p_client_locale,p_idempotency_key,p_manage_token_hash);
  select * into appointment from public.mova_appointments where id=(result->>'id')::uuid;
  if not found then raise exception using errcode='P0002',message='BOOKING_NOT_FOUND'; end if;
  if coalesce((result->>'replayed')::boolean,false) then return result; end if;
  if p_portfolio_item_id is not null and not exists(select 1 from public.mova_portfolio_items p join public.mova_portfolio_service_links l on l.portfolio_item_id=p.id where p.id=p_portfolio_item_id and p.artist_business_id=appointment.artist_business_id and p.is_published and l.service_id=any(p_service_ids)) then
    raise exception using errcode='22023',message='PORTFOLIO_LOOK_NOT_AVAILABLE_FOR_SERVICE'; end if;
  if p_alternate_starts_at is not null then
    select * into location from public.mova_locations where id=appointment.location_id and artist_business_id=appointment.artist_business_id;
    if not found or location.booking_mode<>'request' then raise exception using errcode='22023',message='ALTERNATE_TIME_REQUIRES_REQUEST_MODE'; end if;
    select * into policies from public.mova_location_policies where location_id=location.id;
    alternate_ends_at:=p_alternate_starts_at+(appointment.ends_at-appointment.starts_at);
    if p_alternate_starts_at<now()+make_interval(mins=>coalesce(policies.lead_time_minutes,60)) or p_alternate_starts_at>now()+make_interval(days=>coalesce(policies.booking_horizon_days,60)) then raise exception using errcode='22023',message='ALTERNATE_TIME_OUTSIDE_BOOKING_WINDOW'; end if;
    if not public.mova_location_window_is_open(location.id,p_alternate_starts_at,alternate_ends_at) then raise exception using errcode='22023',message='ALTERNATE_TIME_OUTSIDE_LOCATION_HOURS'; end if;
    if exists(select 1 from public.mova_availability_blocks b where b.location_id=location.id and b.starts_at<alternate_ends_at+make_interval(mins=>coalesce(policies.buffer_after_minutes,0)) and b.ends_at>p_alternate_starts_at-make_interval(mins=>coalesce(policies.buffer_before_minutes,0)))
      or exists(select 1 from public.mova_appointments a where a.location_id=location.id and a.id<>appointment.id and a.status in ('pending_payment','pending_artist','confirmed','completed') and a.starts_at<alternate_ends_at+make_interval(mins=>coalesce(policies.buffer_after_minutes,0))+make_interval(mins=>a.buffer_after_minutes) and a.ends_at>p_alternate_starts_at-make_interval(mins=>coalesce(policies.buffer_before_minutes,0))-make_interval(mins=>a.buffer_before_minutes))
      or exists(select 1 from public.mova_booking_holds h where h.location_id=location.id and h.status='active' and h.expires_at>now() and h.starts_at<alternate_ends_at+make_interval(mins=>coalesce(policies.buffer_after_minutes,0)) and h.ends_at>p_alternate_starts_at-make_interval(mins=>coalesce(policies.buffer_before_minutes,0))) then raise exception using errcode='23505',message='ALTERNATE_SLOT_TAKEN'; end if;
  end if;
  update public.mova_appointments set alternate_starts_at=p_alternate_starts_at,client_note=nullif(trim(p_client_note),''),portfolio_item_id=p_portfolio_item_id where id=appointment.id;
  return result;
end $$;
revoke all on function public.mova_booking_create_multi_with_options(uuid,uuid[],timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_booking_create_multi_with_options(uuid,uuid[],timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid) to service_role;

create or replace function public.mova_booking_create_multi_with_consent(
 p_location_id uuid,p_service_ids uuid[],p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
 p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea,p_alternate_starts_at timestamptz,
 p_client_note text,p_portfolio_item_id uuid,p_consent_choices jsonb
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare result jsonb; appointment public.mova_appointments%rowtype; purpose_choice record; channel_choice record;
begin
  if p_consent_choices is null or jsonb_typeof(p_consent_choices)<>'object' then raise exception using errcode='22023',message='BOOKING_CONSENTS_INVALID'; end if;
  for purpose_choice in select key,value from jsonb_each(p_consent_choices) loop
    if purpose_choice.key not in ('rebooking_reminders','offers','review_requests') or jsonb_typeof(purpose_choice.value)<>'object' then raise exception using errcode='22023',message='BOOKING_CONSENTS_INVALID'; end if;
    for channel_choice in select key,value from jsonb_each(purpose_choice.value) loop
      if channel_choice.key not in ('email','sms') or (purpose_choice.key='review_requests' and channel_choice.key<>'email') or jsonb_typeof(channel_choice.value)<>'boolean' then raise exception using errcode='22023',message='BOOKING_CONSENTS_INVALID'; end if;
    end loop;
  end loop;
  result:=public.mova_booking_create_multi_with_options(p_location_id,p_service_ids,p_starts_at,p_client_name,p_client_email,p_client_phone,p_client_locale,p_idempotency_key,p_manage_token_hash,p_alternate_starts_at,p_client_note,p_portfolio_item_id);
  if coalesce((result->>'replayed')::boolean,false) then return result; end if;
  select * into appointment from public.mova_appointments where id=(result->>'id')::uuid;
  if appointment.client_id is not null then
    for purpose_choice in select key,value from jsonb_each(p_consent_choices) loop
      for channel_choice in select key,value from jsonb_each(purpose_choice.value) loop
        if (channel_choice.key='email' and appointment.client_email is not null) or (channel_choice.key='sms' and appointment.client_phone is not null) then
          insert into public.mova_client_consents(artist_business_id,client_id,purpose,channel,granted,locale,evidence,changed_at)
          values(appointment.artist_business_id,appointment.client_id,purpose_choice.key,channel_choice.key,(channel_choice.value#>>'{}')::boolean,coalesce(appointment.client_locale,'en-US'),jsonb_build_object('source','booking_checkout','copy_version','f04-checkout-v1','appointment_id',appointment.id),clock_timestamp());
        end if;
      end loop;
    end loop;
  end if;
  return result;
end $$;
revoke all on function public.mova_booking_create_multi_with_consent(uuid,uuid[],timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mova_booking_create_multi_with_consent(uuid,uuid[],timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) to service_role;

create or replace function public.mova_booking_create_multi_with_consent_checkout(
 p_location_id uuid,p_service_ids uuid[],p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
 p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea,p_alternate_starts_at timestamptz,
 p_client_note text,p_portfolio_item_id uuid,p_consent_choices jsonb
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare result jsonb; appointment public.mova_appointments%rowtype;
begin
  perform set_config('mova.allow_deposit_bookings','on',true);
  result:=public.mova_booking_create_multi_with_consent(p_location_id,p_service_ids,p_starts_at,p_client_name,p_client_email,p_client_phone,p_client_locale,p_idempotency_key,p_manage_token_hash,p_alternate_starts_at,p_client_note,p_portfolio_item_id,p_consent_choices);
  select * into appointment from public.mova_appointments where id=(result->>'id')::uuid;
  if not found then raise exception using errcode='P0002',message='BOOKING_NOT_FOUND'; end if;
  if appointment.deposit_due_minor>0 and not exists(select 1 from public.mova_stripe_connections where artist_business_id=appointment.artist_business_id and status='active' and charges_enabled and stripe_account_id is not null) then raise exception using errcode='22023',message='STRIPE_ACCOUNT_NOT_READY'; end if;
  result:=result||jsonb_build_object('deposit_due_minor',appointment.deposit_due_minor,'service_price_minor',appointment.service_price_minor);
  perform set_config('mova.allow_deposit_bookings','off',true); return result;
exception when others then perform set_config('mova.allow_deposit_bookings','off',true); raise;
end $$;
revoke all on function public.mova_booking_create_multi_with_consent_checkout(uuid,uuid[],timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mova_booking_create_multi_with_consent_checkout(uuid,uuid[],timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) to service_role;

-- Preserve the deployed single-service RPC contracts while routing every
-- legacy call through the child-row writer.
create or replace function public.mova_booking_create_with_options(
 p_location_id uuid,p_service_id uuid,p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
 p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea,p_alternate_starts_at timestamptz default null,
 p_client_note text default null,p_portfolio_item_id uuid default null
) returns jsonb language sql security definer set search_path=public,auth,pg_temp as $$
  select public.mova_booking_create_multi_with_options(p_location_id,array[p_service_id],p_starts_at,p_client_name,p_client_email,p_client_phone,p_client_locale,p_idempotency_key,p_manage_token_hash,p_alternate_starts_at,p_client_note,p_portfolio_item_id);
$$;
revoke all on function public.mova_booking_create_with_options(uuid,uuid,timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_booking_create_with_options(uuid,uuid,timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid) to service_role;

create or replace function public.mova_booking_create_with_consent(
 p_location_id uuid,p_service_id uuid,p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
 p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea,p_alternate_starts_at timestamptz,
 p_client_note text,p_portfolio_item_id uuid,p_consent_choices jsonb
) returns jsonb language sql security definer set search_path=public,auth,pg_temp as $$
  select public.mova_booking_create_multi_with_consent(p_location_id,array[p_service_id],p_starts_at,p_client_name,p_client_email,p_client_phone,p_client_locale,p_idempotency_key,p_manage_token_hash,p_alternate_starts_at,p_client_note,p_portfolio_item_id,p_consent_choices);
$$;
revoke all on function public.mova_booking_create_with_consent(uuid,uuid,timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mova_booking_create_with_consent(uuid,uuid,timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) to service_role;

create or replace function public.mova_booking_create_with_consent_checkout(
 p_location_id uuid,p_service_id uuid,p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
 p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea,p_alternate_starts_at timestamptz,
 p_client_note text,p_portfolio_item_id uuid,p_consent_choices jsonb
) returns jsonb language sql security definer set search_path=public,auth,pg_temp as $$
  select public.mova_booking_create_multi_with_consent_checkout(p_location_id,array[p_service_id],p_starts_at,p_client_name,p_client_email,p_client_phone,p_client_locale,p_idempotency_key,p_manage_token_hash,p_alternate_starts_at,p_client_note,p_portfolio_item_id,p_consent_choices);
$$;
revoke all on function public.mova_booking_create_with_consent_checkout(uuid,uuid,timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mova_booking_create_with_consent_checkout(uuid,uuid,timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) to service_role;
