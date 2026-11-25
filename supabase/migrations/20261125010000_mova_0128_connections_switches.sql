-- 0128 Connections (CN1–CN8): the stylist switches behind Settings › Connections.
-- Needs 0102. Owner applies by hand; then redeploy payment-settings, paylink-create, public-artist,
-- calendar-google-connect, review-management, google-reviews-sync, job-dispatch and job-worker.

-- 1. Stripe page: "Ask for deposits" and "Pay links and pay QR". Both start on, so nothing changes until a
--    stylist turns one off. Deposits stay set per service; the switch only pauses asking for them.
alter table public.mova_payment_method_settings add column if not exists deposits_enabled boolean not null default true;
alter table public.mova_payment_method_settings add column if not exists pay_links_enabled boolean not null default true;

create or replace function public.mova_deposits_enabled(p_artist_business_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.deposits_enabled from public.mova_payment_method_settings s where s.artist_business_id = p_artist_business_id), true);
$$;
revoke all on function public.mova_deposits_enabled(uuid) from public, anon, authenticated;
grant execute on function public.mova_deposits_enabled(uuid) to service_role;

-- Same as 0037 except that a stylist who turned deposits off is never asked for one.
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
    row_deposit:=case when loc.payment_collector<>'artist' or row_service.deposit_type='none' or not public.mova_deposits_enabled(loc.artist_business_id) then 0
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
    row_deposit:=case when loc.payment_collector<>'artist' or row_service.deposit_type='none' or not public.mova_deposits_enabled(loc.artist_business_id) then 0
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

-- 2. Google page › Google reviews. The import switch already exists (mova_review_settings.google_import_enabled,
--    0053, default on); the stylist can now change it. New Google reviews become a stylist alert
--    ("Tell me about new reviews"), but never on the first import, which brings in old reviews.
create or replace function public.mova_google_review_created_outbox_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.mova_review_settings s where s.artist_business_id = new.artist_business_id and s.google_synced_at is not null) then
    insert into public.mova_outbox_events(artist_business_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
    values (new.artist_business_id, 'google_review', new.id, 'google_review.created', jsonb_build_object('rating', new.rating), 'google-review-created:' || new.id::text)
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.mova_google_review_created_outbox_trigger() from public, anon, authenticated;
drop trigger if exists mova_google_review_created_outbox on public.mova_google_reviews;
create trigger mova_google_review_created_outbox after insert on public.mova_google_reviews
  for each row execute function public.mova_google_review_created_outbox_trigger();

-- Same as 0102, plus Google reviews.
create or replace function public.mova_stylist_alert_context(p_event_type text, p_aggregate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare
  v_business uuid; v_appointment uuid; v_client uuid; v_message text; v_rating int; v_review_name text; v_review_body text;
  v_cancelled_by text; v_result jsonb;
begin
  if p_event_type = 'message.received' then
    select m.artist_business_id, m.client_id, left(m.body, 160) into v_business, v_client, v_message from public.mova_messages m where m.id = p_aggregate_id;
  elsif p_event_type = 'review.created' then
    select r.artist_business_id, r.appointment_id, r.rating, r.display_name, left(r.body, 160)
      into v_business, v_appointment, v_rating, v_review_name, v_review_body from public.mova_reviews r where r.id = p_aggregate_id;
  elsif p_event_type = 'google_review.created' then
    select g.artist_business_id, g.rating, coalesce(nullif(g.display_name, ''), 'Google reviewer'), left(g.body, 160)
      into v_business, v_rating, v_review_name, v_review_body from public.mova_google_reviews g where g.id = p_aggregate_id;
  else
    select a.artist_business_id, a.id into v_business, v_appointment from public.mova_appointments a where a.id = p_aggregate_id;
    if p_event_type in ('appointment.cancelled', 'appointment.canceled') then
      select e.actor_type into v_cancelled_by from public.mova_appointment_events e
      where e.appointment_id = p_aggregate_id and e.to_status = 'cancelled' order by e.occurred_at desc limit 1;
    end if;
  end if;
  if v_business is null then return null; end if;

  select jsonb_build_object(
    'artist_business_id', b.id,
    'business_number', b.business_number,
    'locale', coalesce(p.preferred_locale, 'en-US'),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email,
        'first_name', coalesce(nullif(trim(n.first_name), ''), nullif(trim(u.raw_user_meta_data->>'first_name'), ''), p.display_name, b.name)))
      from public.mova_artist_memberships mm join auth.users u on u.id = mm.user_id
      left join public.mova_account_names n on n.user_id = u.id
      where mm.artist_business_id = b.id and mm.status = 'active'
    ), '[]'::jsonb),
    'appointment', (select jsonb_build_object('id', a.id, 'client_name', a.client_name, 'service_name', a.service_name_snapshot,
        'starts_at', a.starts_at, 'time_zone', l.time_zone, 'location_name', l.name, 'status', a.status)
      from public.mova_appointments a join public.mova_locations l on l.id = a.location_id where a.id = v_appointment),
    'client', (select jsonb_build_object('id', c.id, 'name', c.display_name) from public.mova_clients c where c.id = v_client),
    'message', v_message,
    'review', case when v_rating is null then null else jsonb_build_object('rating', v_rating, 'name', v_review_name, 'body', v_review_body) end,
    'cancelled_by', v_cancelled_by,
    'needs_count', (select count(*) from public.mova_appointments x where x.artist_business_id = b.id and x.status = 'pending_artist')
  ) into v_result
  from public.mova_artist_businesses b left join public.mova_artist_profiles p on p.artist_business_id = b.id
  where b.id = v_business;
  return v_result;
end $$;
revoke all on function public.mova_stylist_alert_context(text, uuid) from public, anon, authenticated;
grant execute on function public.mova_stylist_alert_context(text, uuid) to service_role;

-- 3. Stylists whose Google reviews are due for a check (job-dispatch, every 6 hours each): import on,
--    Google connected with a Business Profile chosen.
create or replace function public.mova_google_review_sync_due(p_now timestamptz default now(), p_limit integer default 20)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select c.artist_business_id
  from public.mova_google_connections c
  left join public.mova_review_settings s on s.artist_business_id = c.artist_business_id
  where c.status = 'active' and c.business_profile_enabled and c.business_location_id is not null
    and coalesce(s.google_import_enabled, true)
    and (s.google_synced_at is null or s.google_synced_at < p_now - interval '6 hours')
  order by s.google_synced_at nulls first
  limit greatest(1, least(p_limit, 100));
$$;
revoke all on function public.mova_google_review_sync_due(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.mova_google_review_sync_due(timestamptz, integer) to service_role;
