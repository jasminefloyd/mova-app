create or replace function public.mova_booking_reschedule_artist(
  p_appointment_id uuid,
  p_artist_business_id uuid,
  p_new_starts_at timestamptz,
  p_idempotency_key text,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare
  booking public.mova_appointments%rowtype;
  loc public.mova_locations%rowtype;
  pol public.mova_location_policies%rowtype;
  duration interval;
  new_ends_at timestamptz;
begin
  select * into booking
  from public.mova_appointments
  where id=p_appointment_id and artist_business_id=p_artist_business_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='APPOINTMENT_NOT_FOUND';
  end if;

  if exists(
    select 1 from public.mova_appointment_events
    where appointment_id=booking.id and idempotency_key=p_idempotency_key
  ) then
    return jsonb_build_object('id',booking.id,'status',booking.status,'starts_at',booking.starts_at,'ends_at',booking.ends_at,'replayed',true);
  end if;
  if booking.status<>'confirmed' or booking.starts_at<=now() then
    raise exception using errcode='P0002',message='APPOINTMENT_NOT_RESCHEDULABLE';
  end if;
  if booking.reschedule_requested_starts_at is not null then
    raise exception using errcode='22023',message='RESCHEDULE_REQUEST_PENDING';
  end if;
  if p_new_starts_at<=now() then
    raise exception using errcode='22023',message='INVALID_RESCHEDULE_TIME';
  end if;
  if p_new_starts_at=booking.starts_at then
    raise exception using errcode='22023',message='SAME_RESCHEDULE_TIME';
  end if;

  select * into loc from public.mova_locations
  where id=booking.location_id and artist_business_id=p_artist_business_id and is_active
  for update;
  if not found then
    raise exception using errcode='P0002',message='LOCATION_NOT_AVAILABLE';
  end if;
  select * into pol from public.mova_location_policies where location_id=booking.location_id;
  duration:=booking.ends_at-booking.starts_at;
  new_ends_at:=p_new_starts_at+duration;

  if p_new_starts_at<now()+make_interval(mins=>coalesce(pol.lead_time_minutes,60))
    or p_new_starts_at>now()+make_interval(days=>coalesce(pol.booking_horizon_days,60)) then
    raise exception using errcode='22023',message='SLOT_OUTSIDE_BOOKING_WINDOW';
  end if;
  if not public.mova_location_window_is_open(loc.id,p_new_starts_at,new_ends_at) then
    raise exception using errcode='22023',message='SLOT_OUTSIDE_LOCATION_HOURS';
  end if;
  if exists(
    select 1 from public.mova_availability_blocks b
    where b.location_id=loc.id
      and b.starts_at<new_ends_at+make_interval(mins=>coalesce(pol.buffer_after_minutes,0))
      and b.ends_at>p_new_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))
  ) or exists(
    select 1 from public.mova_booking_holds h
    where h.location_id=loc.id and h.appointment_id<>booking.id
      and h.status='active' and h.expires_at>now()
      and h.starts_at<new_ends_at+make_interval(mins=>coalesce(pol.buffer_after_minutes,0))
      and h.ends_at>p_new_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))
  ) or exists(
    select 1 from public.mova_appointments a
    where a.location_id=loc.id and a.id<>booking.id
      and a.status in ('pending_payment','pending_artist','confirmed','completed')
      and a.starts_at<new_ends_at+make_interval(mins=>coalesce(pol.buffer_after_minutes,0))+make_interval(mins=>a.buffer_after_minutes)
      and a.ends_at>p_new_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))-make_interval(mins=>a.buffer_before_minutes)
  ) then
    raise exception using errcode='23505',message='SLOT_TAKEN';
  end if;

  update public.mova_appointments
  set starts_at=p_new_starts_at,ends_at=new_ends_at
  where id=booking.id returning * into booking;

  insert into public.mova_appointment_events(
    artist_business_id,appointment_id,from_status,to_status,actor_type,actor_id,reason,idempotency_key
  ) values(
    booking.artist_business_id,booking.id,'confirmed','confirmed','artist',p_actor_id,
    'artist_rescheduled:'||p_new_starts_at::text,p_idempotency_key
  );
  insert into public.mova_outbox_events(
    artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key
  ) values(
    booking.artist_business_id,'appointment',booking.id,'appointment.rescheduled',
    jsonb_build_object('starts_at',booking.starts_at,'ends_at',booking.ends_at,'client_locale',booking.client_locale),
    p_idempotency_key||':rescheduled'
  ) on conflict(idempotency_key) do nothing;
  return jsonb_build_object('id',booking.id,'status',booking.status,'starts_at',booking.starts_at,'ends_at',booking.ends_at,'replayed',false);
end $$;

revoke all on function public.mova_booking_reschedule_artist(uuid,uuid,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_booking_reschedule_artist(uuid,uuid,timestamptz,text,uuid) to service_role;
