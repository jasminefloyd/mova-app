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
  if found then
    if appointment.deposit_due_minor>0 then raise exception using errcode='22023',message='DEPOSIT_PAYMENT_UNAVAILABLE'; end if;
    return jsonb_build_object('id',appointment.id,'status',appointment.status,'replayed',true);
  end if;
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
  if deposit>0 then raise exception using errcode='22023',message='DEPOSIT_PAYMENT_UNAVAILABLE'; end if;
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
