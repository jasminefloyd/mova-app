alter table public.mova_payments
  add column checkout_session_id text unique,
  add column checkout_session_url text,
  add column checkout_kind text check (checkout_kind in ('deposit','balance','paylink'));
create unique index mova_payments_one_pending_deposit_uq on public.mova_payments(appointment_id)
  where checkout_kind='deposit' and status='pending';
alter table public.mova_paylinks add column checkout_session_url text;
alter table public.mova_paylinks add column payment_id uuid references public.mova_payments(id) on delete set null;
drop index if exists public.mova_paylinks_one_open_per_appointment_uq;
create unique index mova_paylinks_one_open_per_appointment_channel_uq on public.mova_paylinks(artist_business_id,appointment_id,channel) where status='open';

create table public.mova_stripe_oauth_states (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  state_hash text not null unique,
  return_path text not null default '/settings/payments' check (left(return_path, 1) = '/' and left(return_path, 2) <> '//'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.mova_stripe_oauth_states enable row level security;
revoke all on public.mova_stripe_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.mova_stripe_oauth_states to service_role;

-- Forward replacement for the already-applied safe deposit gate in 0031.
-- Deposit booking is allowed only inside the service-role checkout wrapper below.
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
    if appointment.deposit_due_minor>0 and coalesce(current_setting('mova.allow_deposit_bookings',true),'off')<>'on' then raise exception using errcode='22023',message='DEPOSIT_PAYMENT_UNAVAILABLE'; end if;
    return jsonb_build_object('id',appointment.id,'status',appointment.status,'replayed',true);
  end if;
  select coalesce(sl.price_minor_override,svc.base_price_minor),coalesce(sl.duration_minutes_override,svc.duration_minutes)+svc.buffer_minutes
    into price,duration from (select 1) seed left join public.mova_service_locations sl on sl.service_id=svc.id and sl.location_id=loc.id;
  finish:=p_starts_at+make_interval(mins=>duration);
  if p_starts_at < now()+make_interval(mins=>coalesce(pol.lead_time_minutes,60)) or p_starts_at > now()+make_interval(days=>coalesce(pol.booking_horizon_days,60)) then raise exception using errcode='22023',message='SLOT_OUTSIDE_BOOKING_WINDOW'; end if;
  if not public.mova_location_window_is_open(loc.id,p_starts_at,finish) then raise exception using errcode='22023',message='SLOT_OUTSIDE_LOCATION_HOURS'; end if;
  if exists(select 1 from public.mova_availability_blocks b where b.location_id=loc.id and b.starts_at < finish+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and b.ends_at > p_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0)))
    or exists(select 1 from public.mova_appointments a where a.location_id=loc.id and a.status in ('pending_payment','pending_artist','confirmed','completed') and a.starts_at < finish+make_interval(mins=>coalesce(pol.buffer_after_minutes,0))+make_interval(mins=>a.buffer_after_minutes) and a.ends_at > p_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))-make_interval(mins=>a.buffer_before_minutes))
    or exists(select 1 from public.mova_booking_holds h where h.location_id=loc.id and h.status='active' and h.expires_at>now() and h.starts_at<finish+make_interval(mins=>coalesce(pol.buffer_after_minutes,0)) and h.ends_at>p_starts_at-make_interval(mins=>coalesce(pol.buffer_before_minutes,0))) then raise exception using errcode='23505',message='SLOT_TAKEN'; end if;
  deposit:=case when loc.payment_collector<>'artist' or svc.deposit_type='none' then 0 when svc.deposit_type='fixed' then least(price,svc.deposit_value) else least(price,(price*svc.deposit_value+5000)/10000) end;
  if deposit>0 and coalesce(current_setting('mova.allow_deposit_bookings',true),'off')<>'on' then raise exception using errcode='22023',message='DEPOSIT_PAYMENT_UNAVAILABLE'; end if;
  new_status:=case when deposit>0 then 'pending_payment' when loc.booking_mode='request' then 'pending_artist' else 'confirmed' end;
  insert into public.mova_appointments(artist_business_id,location_id,service_id,source,status,starts_at,ends_at,buffer_before_minutes,buffer_after_minutes,service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,client_name,client_email,client_phone,client_locale,request_expires_at,manage_token_hash,idempotency_key,confirmed_at)
    values(loc.artist_business_id,loc.id,svc.id,'showcase',new_status,p_starts_at,finish,coalesce(pol.buffer_before_minutes,0),coalesce(pol.buffer_after_minutes,0),svc.name,price,deposit,price,trim(p_client_name),nullif(trim(p_client_email),''),nullif(trim(p_client_phone),''),coalesce(p_client_locale,'en-US'),case when new_status='pending_artist' then now()+make_interval(hours=>coalesce(pol.request_expiry_hours,24)) end,p_manage_token_hash,p_idempotency_key,case when new_status='confirmed' then now() end)
    returning * into appointment;
  insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,reason,idempotency_key)
    values(loc.artist_business_id,appointment.id,null,new_status,'guest','booking_created',p_idempotency_key||':created');
  if new_status='pending_payment' then insert into public.mova_booking_holds(artist_business_id,appointment_id,location_id,starts_at,ends_at,expires_at) values(loc.artist_business_id,appointment.id,loc.id,p_starts_at,finish,now()+interval '10 minutes'); end if;
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values(loc.artist_business_id,'appointment',appointment.id,'appointment.'||new_status,jsonb_build_object('client_locale',coalesce(p_client_locale,'en-US')),p_idempotency_key||':created-event');
  return jsonb_build_object('id',appointment.id,'status',new_status,'deposit_due_minor',deposit,'expires_at',appointment.request_expires_at,'replayed',false);
end $$;

create or replace function public.mova_booking_create_with_consent_checkout(
  p_location_id uuid,p_service_id uuid,p_starts_at timestamptz,p_client_name text,p_client_email text,p_client_phone text,
  p_client_locale text,p_idempotency_key text,p_manage_token_hash bytea,p_alternate_starts_at timestamptz,
  p_client_note text,p_portfolio_item_id uuid,p_consent_choices jsonb
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare result jsonb; appointment public.mova_appointments%rowtype;
begin
  perform set_config('mova.allow_deposit_bookings','on',true);
  result:=public.mova_booking_create_with_consent(
    p_location_id,p_service_id,p_starts_at,p_client_name,p_client_email,p_client_phone,p_client_locale,
    p_idempotency_key,p_manage_token_hash,p_alternate_starts_at,p_client_note,p_portfolio_item_id,p_consent_choices
  );
  select * into appointment from public.mova_appointments where id=(result->>'id')::uuid;
  if not found then raise exception using errcode='P0002',message='BOOKING_NOT_FOUND'; end if;
  if appointment.deposit_due_minor>0 and not exists(
    select 1 from public.mova_stripe_connections where artist_business_id=appointment.artist_business_id
      and status='active' and charges_enabled and stripe_account_id is not null
  ) then raise exception using errcode='22023',message='STRIPE_ACCOUNT_NOT_READY'; end if;
  result:=result||jsonb_build_object('deposit_due_minor',appointment.deposit_due_minor,'service_price_minor',appointment.service_price_minor);
  perform set_config('mova.allow_deposit_bookings','off',true);
  return result;
exception when others then
  perform set_config('mova.allow_deposit_bookings','off',true);
  raise;
end $$;
revoke all on function public.mova_booking_create_with_consent_checkout(uuid,uuid,timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mova_booking_create_with_consent_checkout(uuid,uuid,timestamptz,text,text,text,text,text,bytea,timestamptz,text,uuid,jsonb) to service_role;

create or replace function public.mova_stripe_checkout_prepare(p_appointment_id uuid,p_manage_token_hash bytea,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare appointment public.mova_appointments%rowtype; location public.mova_locations%rowtype; connection public.mova_stripe_connections%rowtype; payment_id uuid;
begin
  select * into appointment from public.mova_appointments where id=p_appointment_id and manage_token_hash=p_manage_token_hash for update;
  if not found then raise exception using errcode='P0002',message='BOOKING_NOT_FOUND'; end if;
  if appointment.status<>'pending_payment' or appointment.deposit_due_minor<=0 then raise exception using errcode='22023',message='CHECKOUT_NOT_REQUIRED'; end if;
  select * into location from public.mova_locations where id=appointment.location_id and artist_business_id=appointment.artist_business_id;
  if not found or location.payment_collector<>'artist' then raise exception using errcode='42501',message='ONLINE_PAYMENT_UNAVAILABLE'; end if;
  if not exists(select 1 from public.mova_booking_holds where appointment_id=appointment.id and status='active' and expires_at>now()) then raise exception using errcode='22023',message='PAYMENT_HOLD_EXPIRED'; end if;
  select * into connection from public.mova_stripe_connections where artist_business_id=appointment.artist_business_id and status='active' and charges_enabled;
  if not found or connection.stripe_account_id is null then raise exception using errcode='22023',message='STRIPE_ACCOUNT_NOT_READY'; end if;
  select id into payment_id from public.mova_payments where artist_business_id=appointment.artist_business_id
    and appointment_id=appointment.id and checkout_kind='deposit' and status='pending' for update;
  if payment_id is null then
    insert into public.mova_payments(artist_business_id,appointment_id,method,collector,status,amount_minor,idempotency_key,provider,checkout_kind)
    values(appointment.artist_business_id,appointment.id,'card_checkout','mova_processed','pending',appointment.deposit_due_minor,p_idempotency_key,'stripe','deposit')
    on conflict(artist_business_id,idempotency_key) do nothing returning id into payment_id;
    if payment_id is null then
      select id into payment_id from public.mova_payments where artist_business_id=appointment.artist_business_id and idempotency_key=p_idempotency_key;
    end if;
  end if;
  if not exists(select 1 from public.mova_payments where id=payment_id and artist_business_id=appointment.artist_business_id
      and appointment_id=appointment.id and checkout_kind='deposit' and amount_minor=appointment.deposit_due_minor) then
    raise exception using errcode='22023',message='CHECKOUT_IDEMPOTENCY_MISMATCH';
  end if;
  return jsonb_build_object('payment_id',payment_id,'appointment_id',appointment.id,'artist_business_id',appointment.artist_business_id,
    'stripe_account_id',connection.stripe_account_id,'amount_minor',appointment.deposit_due_minor,'fee_minor',
    (select platform_fee_minor from public.mova_payments where id=payment_id),'client_email',appointment.client_email,
    'client_locale',appointment.client_locale,'service_name',appointment.service_name_snapshot,
    'hold_expires_at',(select expires_at from public.mova_booking_holds where appointment_id=appointment.id));
end $$;

create or replace function public.mova_stripe_checkout_attach(p_payment_id uuid,p_session_id text,p_session_url text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_session_id !~ '^cs_test_[A-Za-z0-9_]+$' or p_session_url !~ '^https://checkout\.stripe\.com/' then return false; end if;
  update public.mova_payments set checkout_session_id=p_session_id,checkout_session_url=p_session_url,updated_at=now()
  where id=p_payment_id and status='pending' and (checkout_session_id is null or checkout_session_id=p_session_id);
  return found;
end $$;

create or replace function public.mova_stripe_checkout_fail(p_payment_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare payment public.mova_payments%rowtype;
begin
  select * into payment from public.mova_payments where id=p_payment_id for update;
  if not found or payment.status<>'pending' then return false; end if;
  update public.mova_payments set status='failed',updated_at=now() where id=payment.id;
  update public.mova_appointments set status='expired',updated_at=now() where id=payment.appointment_id and status='pending_payment';
  update public.mova_booking_holds set status='expired' where appointment_id=payment.appointment_id and status='active';
  return true;
end $$;

create or replace function public.mova_stripe_paylink_prepare(p_artist_business_id uuid,p_appointment_id uuid,p_channel text,p_short_code text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare appointment public.mova_appointments%rowtype; location public.mova_locations%rowtype; connection public.mova_stripe_connections%rowtype;
  link public.mova_paylinks%rowtype; payment public.mova_payments%rowtype; expiry timestamptz;
begin
  if p_channel not in ('sms','qr') or p_short_code !~ '^[A-Za-z0-9_-]{40,96}$' or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode='22023',message='PAYLINK_REQUEST_INVALID';
  end if;
  select * into appointment from public.mova_appointments where id=p_appointment_id and artist_business_id=p_artist_business_id for update;
  if not found or appointment.status not in ('confirmed','completed') or appointment.balance_due_minor<=0 then
    raise exception using errcode='22023',message='PAYLINK_NOT_AVAILABLE';
  end if;
  select * into location from public.mova_locations where id=appointment.location_id and artist_business_id=appointment.artist_business_id;
  if not found or location.payment_collector<>'artist' then raise exception using errcode='22023',message='ONLINE_PAYMENT_UNAVAILABLE'; end if;
  select * into connection from public.mova_stripe_connections where artist_business_id=appointment.artist_business_id and status='active' and charges_enabled;
  if not found or connection.stripe_account_id is null then raise exception using errcode='22023',message='STRIPE_ACCOUNT_NOT_READY'; end if;
  select * into link from public.mova_paylinks where artist_business_id=appointment.artist_business_id and appointment_id=appointment.id and channel=p_channel and status='open' for update;
  if found then
    select * into payment from public.mova_payments where id=link.payment_id;
    if not found or payment.amount_minor<>link.amount_minor or payment.status<>'pending' then raise exception using errcode='22023',message='PAYLINK_PAYMENT_STATE_INVALID'; end if;
  else
    expiry:=now()+interval '23 hours';
    insert into public.mova_paylinks(artist_business_id,appointment_id,amount_minor,channel,short_code,status,expires_at,idempotency_key)
      values(appointment.artist_business_id,appointment.id,appointment.balance_due_minor,p_channel,p_short_code,'open',expiry,p_idempotency_key)
      returning * into link;
    insert into public.mova_payments(artist_business_id,appointment_id,method,collector,status,amount_minor,idempotency_key,provider,checkout_kind)
      values(appointment.artist_business_id,appointment.id,case p_channel when 'sms' then 'card_paylink_sms' else 'card_paylink_qr' end,
        'mova_processed','pending',appointment.balance_due_minor,'paylink:'||link.id::text,'stripe','paylink') returning * into payment;
    update public.mova_paylinks set payment_id=payment.id where id=link.id returning * into link;
  end if;
  return jsonb_build_object('link_id',link.id,'payment_id',payment.id,'short_code',link.short_code,'amount_minor',payment.amount_minor,
    'fee_minor',payment.platform_fee_minor,'stripe_account_id',connection.stripe_account_id,'client_email',appointment.client_email,
    'client_locale',appointment.client_locale,'service_name',appointment.service_name_snapshot,'expires_at',link.expires_at,
    'checkout_session_id',link.provider_session_id,'checkout_url',link.checkout_session_url);
end $$;

create or replace function public.mova_stripe_paylink_attach(p_link_id uuid,p_session_id text,p_session_url text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare link public.mova_paylinks%rowtype;
begin
  if p_session_id !~ '^cs_test_[A-Za-z0-9_]+$' or p_session_url !~ '^https://checkout\.stripe\.com/' then return false; end if;
  update public.mova_paylinks set provider_session_id=p_session_id,checkout_session_url=p_session_url,updated_at=now()
    where id=p_link_id and status='open' and expires_at>now() and (provider_session_id is null or provider_session_id=p_session_id);
  if not found then return false; end if;
  select * into link from public.mova_paylinks where id=p_link_id;
  update public.mova_payments set checkout_session_id=p_session_id,checkout_session_url=p_session_url,updated_at=now()
    where id=link.payment_id and status='pending' and (checkout_session_id is null or checkout_session_id=p_session_id);
  return found;
end $$;

create or replace function public.mova_stripe_paylink_resolve(p_short_code text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare link public.mova_paylinks%rowtype; client_locale text;
begin
  if p_short_code is null or p_short_code !~ '^[A-Za-z0-9_-]{40,96}$' then return null; end if;
  select * into link from public.mova_paylinks where short_code=p_short_code;
  if not found then return null; end if;
  select a.client_locale into client_locale from public.mova_appointments a where a.id=link.appointment_id and a.artist_business_id=link.artist_business_id;
  if link.status='open' and link.expires_at<=now() then
    update public.mova_paylinks set status='expired',updated_at=now() where id=link.id and status='open' returning * into link;
    update public.mova_payments set status='failed',updated_at=now() where id=link.payment_id and status='pending';
  end if;
  return jsonb_build_object('status',link.status,'expires_at',link.expires_at,'checkout_url',link.checkout_session_url,'locale',coalesce(client_locale,'en-US'));
end $$;

create or replace function public.mova_stripe_webhook_apply(
  p_event_id text,p_event_type text,p_account_id text,p_session_id text,p_payment_intent_id text,
  p_payment_status text,p_amount_total bigint,p_livemode boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare event_row_id uuid; payment public.mova_payments%rowtype; appointment public.mova_appointments%rowtype; location public.mova_locations%rowtype; target_status text;
begin
  if coalesce(p_livemode,true) then raise exception using errcode='22023',message='STRIPE_LIVE_EVENT_REJECTED'; end if;
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$' then raise exception using errcode='22023',message='STRIPE_EVENT_INVALID'; end if;
  insert into public.mova_webhook_events(provider,provider_event_id,event_type,payload,status)
  values('stripe',p_event_id,p_event_type,jsonb_build_object('session_id',p_session_id,'payment_intent_id',p_payment_intent_id), 'received')
  on conflict(provider,provider_event_id) do nothing returning id into event_row_id;
  if event_row_id is null then
    select id into event_row_id from public.mova_webhook_events
      where provider='stripe' and provider_event_id=p_event_id and status='failed' for update;
    if event_row_id is null then return jsonb_build_object('duplicate',true); end if;
    update public.mova_webhook_events set status='received',processed_at=null where id=event_row_id;
  end if;
  if p_event_type not in ('checkout.session.completed','checkout.session.expired') then
    update public.mova_webhook_events set status='ignored',processed_at=now() where id=event_row_id;
    return jsonb_build_object('ignored',true);
  end if;
  select * into payment from public.mova_payments where checkout_session_id=p_session_id and provider='stripe' for update;
  if not found then update public.mova_webhook_events set status='failed' where id=event_row_id; raise exception using errcode='P0002',message='STRIPE_CHECKOUT_NOT_FOUND'; end if;
  if not exists(select 1 from public.mova_stripe_connections c where c.artist_business_id=payment.artist_business_id and c.stripe_account_id=p_account_id) then
    update public.mova_webhook_events set status='failed' where id=event_row_id;
    raise exception using errcode='42501',message='STRIPE_ACCOUNT_MISMATCH';
  end if;
  select * into appointment from public.mova_appointments where id=payment.appointment_id for update;
  if p_event_type='checkout.session.expired' or p_payment_status<>'paid' then
    update public.mova_payments set status='failed',updated_at=now() where id=payment.id and status='pending';
    update public.mova_appointments set status='expired',updated_at=now() where id=appointment.id and status='pending_payment';
    update public.mova_booking_holds set status='expired' where appointment_id=appointment.id and status='active';
    update public.mova_paylinks set status='expired',updated_at=now() where provider_session_id=p_session_id and status='open';
    update public.mova_webhook_events set status='processed',processed_at=now() where id=event_row_id;
    return jsonb_build_object('expired',true);
  end if;
  if p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$' or p_amount_total<>payment.amount_minor then
    update public.mova_webhook_events set status='failed' where id=event_row_id;
    raise exception using errcode='22023',message='STRIPE_PAYMENT_MISMATCH';
  end if;
  if payment.checkout_kind='paylink' then
    if appointment.status not in ('confirmed','completed') then
      update public.mova_webhook_events set status='failed' where id=event_row_id;
      raise exception using errcode='22023',message='PAYLINK_APPOINTMENT_UNAVAILABLE';
    end if;
    update public.mova_payments set status='succeeded',provider_payment_id=p_payment_intent_id,provider_event_id=p_event_id,updated_at=now()
      where id=payment.id and status='pending';
    update public.mova_paylinks set status='paid',paid_payment_id=payment.id,updated_at=now()
      where provider_session_id=p_session_id and status='open';
    insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
      values(payment.artist_business_id,'payment',payment.id,'payment.succeeded',jsonb_build_object('appointment_id',appointment.id,'checkout_kind','paylink'),'stripe:'||p_event_id||':payment')
      on conflict(idempotency_key) do nothing;
    update public.mova_webhook_events set status='processed',processed_at=now() where id=event_row_id;
    return jsonb_build_object('processed',true,'payment_id',payment.id,'checkout_kind','paylink');
  end if;
  if appointment.status<>'pending_payment' or not exists(select 1 from public.mova_booking_holds h where h.appointment_id=appointment.id and h.status='active' and h.expires_at>now()) then
    update public.mova_payments set status='succeeded',provider_payment_id=p_payment_intent_id,provider_event_id=p_event_id,updated_at=now()
      where id=payment.id and status='pending';
    update public.mova_paylinks set status='paid',paid_payment_id=payment.id,updated_at=now()
      where provider_session_id=p_session_id and status='open';
    insert into public.mova_payment_refunds(artist_business_id,payment_id,amount_minor,status,reason,idempotency_key)
      values(payment.artist_business_id,payment.id,payment.amount_minor,'pending','late_checkout_after_hold','stripe-late-refund:'||payment.id::text)
      on conflict(artist_business_id,idempotency_key) do nothing;
    insert into public.mova_background_jobs(job_type,artist_business_id,payload,idempotency_key)
      select 'stripe_refund',payment.artist_business_id,jsonb_build_object('refund_id',r.id,'payment_intent_id',p_payment_intent_id,
        'account_id',p_account_id,'amount_minor',r.amount_minor),'stripe-refund:'||r.id::text
      from public.mova_payment_refunds r where r.artist_business_id=payment.artist_business_id and r.idempotency_key='stripe-late-refund:'||payment.id::text
      on conflict(idempotency_key) do nothing;
    update public.mova_webhook_events set status='processed',processed_at=now() where id=event_row_id;
    return jsonb_build_object('late_payment_refund_queued',true,'payment_id',payment.id);
  end if;
  select * into location from public.mova_locations where id=appointment.location_id and artist_business_id=appointment.artist_business_id;
  target_status:=case when location.booking_mode='request' then 'pending_artist' else 'confirmed' end;
  update public.mova_payments set status='succeeded',provider_payment_id=p_payment_intent_id,provider_event_id=p_event_id,updated_at=now() where id=payment.id;
  update public.mova_paylinks set status='paid',paid_payment_id=payment.id,updated_at=now()
    where provider_session_id=p_session_id and status='open';
  update public.mova_appointments set status=target_status,deposit_due_minor=0,balance_due_minor=greatest(0,service_price_minor-payment.amount_minor),confirmed_at=case when target_status='confirmed' then now() else null end,updated_at=now() where id=appointment.id;
  update public.mova_booking_holds set status='consumed' where appointment_id=appointment.id and status='active';
  insert into public.mova_appointment_events(artist_business_id,appointment_id,from_status,to_status,actor_type,reason,idempotency_key)
  values(appointment.artist_business_id,appointment.id,'pending_payment',target_status,'provider','stripe_checkout_succeeded','stripe:'||p_event_id||':booking') on conflict(appointment_id,idempotency_key) do nothing;
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values(appointment.artist_business_id,'appointment',appointment.id,'appointment.'||target_status,jsonb_build_object('client_locale',appointment.client_locale,'payment_id',payment.id),'stripe:'||p_event_id||':booking') on conflict(idempotency_key) do nothing;
  insert into public.mova_outbox_events(artist_business_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values(appointment.artist_business_id,'payment',payment.id,'payment.succeeded',jsonb_build_object('appointment_id',appointment.id),'stripe:'||p_event_id||':payment') on conflict(idempotency_key) do nothing;
  update public.mova_webhook_events set status='processed',processed_at=now() where id=event_row_id;
  return jsonb_build_object('processed',true,'appointment_id',appointment.id,'status',target_status);
end $$;

create or replace function public.mova_stripe_refund_webhook_apply(p_event_id text,p_refund_id text,p_status text,p_account_id text,p_livemode boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare event_row_id uuid; refund public.mova_payment_refunds%rowtype; payment public.mova_payments%rowtype;
begin
  if coalesce(p_livemode,true) then raise exception using errcode='22023',message='STRIPE_LIVE_EVENT_REJECTED'; end if;
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$' or p_refund_id is null or p_refund_id !~ '^re_[A-Za-z0-9_]+$'
    or p_status not in ('succeeded','pending','failed') then raise exception using errcode='22023',message='STRIPE_REFUND_EVENT_INVALID'; end if;
  insert into public.mova_webhook_events(provider,provider_event_id,event_type,payload,status)
    values('stripe',p_event_id,'refund.updated',jsonb_build_object('refund_id',p_refund_id,'status',p_status),'received')
    on conflict(provider,provider_event_id) do nothing returning id into event_row_id;
  if event_row_id is null then return jsonb_build_object('duplicate',true); end if;
  select * into refund from public.mova_payment_refunds where provider_refund_id=p_refund_id for update;
  if not found then update public.mova_webhook_events set status='ignored',processed_at=now() where id=event_row_id; return jsonb_build_object('ignored',true); end if;
  select * into payment from public.mova_payments where id=refund.payment_id and artist_business_id=refund.artist_business_id;
  if not exists(select 1 from public.mova_stripe_connections where artist_business_id=refund.artist_business_id and stripe_account_id=p_account_id) then
    update public.mova_webhook_events set status='failed' where id=event_row_id;
    raise exception using errcode='42501',message='STRIPE_ACCOUNT_MISMATCH';
  end if;
  update public.mova_payment_refunds set status=p_status where id=refund.id and status<>'succeeded';
  update public.mova_webhook_events set status='processed',processed_at=now() where id=event_row_id;
  return jsonb_build_object('processed',true,'refund_id',refund.id,'status',p_status);
end $$;

create or replace function public.mova_payment_post_refund_entry()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare payment public.mova_payments%rowtype; refunded_total bigint; refunded_before bigint; fee_before bigint; fee_after bigint;
begin
  if new.status='succeeded' and (tg_op='INSERT' or old.status<>'succeeded') then
    select * into payment from public.mova_payments where id=new.payment_id and artist_business_id=new.artist_business_id for update;
    if not found then raise exception using errcode='23503',message='REFUND_PAYMENT_NOT_FOUND'; end if;
    select coalesce(sum(amount_minor),0) into refunded_total from public.mova_payment_refunds
      where payment_id=new.payment_id and artist_business_id=new.artist_business_id and status='succeeded';
    refunded_before:=greatest(0,refunded_total-new.amount_minor);
    fee_before:=floor((payment.platform_fee_minor::numeric*refunded_before/payment.amount_minor)+0.5)::bigint;
    fee_after:=floor((payment.platform_fee_minor::numeric*refunded_total/payment.amount_minor)+0.5)::bigint;
    insert into public.mova_payment_ledger(artist_business_id,appointment_id,payment_id,category,amount_minor,currency,idempotency_key)
    values(new.artist_business_id,payment.appointment_id,new.payment_id,'refund',-new.amount_minor,payment.currency,'refund:'||new.id::text)
    on conflict(artist_business_id,idempotency_key) do nothing;
    if fee_after>fee_before then
      insert into public.mova_payment_ledger(artist_business_id,appointment_id,payment_id,category,amount_minor,currency,idempotency_key)
      values(new.artist_business_id,payment.appointment_id,new.payment_id,'mova_platform_fee',fee_after-fee_before,payment.currency,'refund_platform_fee:'||new.id::text)
      on conflict(artist_business_id,idempotency_key) do nothing;
    end if;
    update public.mova_payments set status=case when refunded_total>=payment.amount_minor then 'refunded' else 'partially_refunded' end,updated_at=now()
      where id=new.payment_id and artist_business_id=new.artist_business_id and status in ('succeeded','partially_refunded');
  end if;
  return new;
end $$;

create or replace function public.mova_stripe_refund_prepare(p_artist_business_id uuid,p_payment_id uuid,p_amount_minor bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare payment public.mova_payments%rowtype; connection public.mova_stripe_connections%rowtype; saved public.mova_payment_refunds%rowtype; reserved bigint;
begin
  if p_amount_minor is null or p_amount_minor<=0 or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode='22023',message='REFUND_REQUEST_INVALID';
  end if;
  select * into payment from public.mova_payments where id=p_payment_id and artist_business_id=p_artist_business_id for update;
  if not found or payment.provider<>'stripe' or payment.collector<>'mova_processed' or payment.provider_payment_id is null
    or payment.status not in ('succeeded','partially_refunded') then raise exception using errcode='22023',message='REFUND_PAYMENT_UNAVAILABLE'; end if;
  select * into connection from public.mova_stripe_connections where artist_business_id=payment.artist_business_id and status='active' and charges_enabled;
  if not found then raise exception using errcode='22023',message='STRIPE_ACCOUNT_NOT_READY'; end if;
  select * into saved from public.mova_payment_refunds where artist_business_id=payment.artist_business_id and idempotency_key=p_idempotency_key;
  if found then
    if saved.payment_id<>payment.id or saved.amount_minor<>p_amount_minor then raise exception using errcode='22023',message='REFUND_IDEMPOTENCY_MISMATCH'; end if;
    return jsonb_build_object('refund_id',saved.id,'payment_id',payment.id,'payment_intent_id',payment.provider_payment_id,
      'account_id',connection.stripe_account_id,'amount_minor',saved.amount_minor,'status',saved.status,'idempotency_key',saved.idempotency_key);
  end if;
  select coalesce(sum(amount_minor),0) into reserved from public.mova_payment_refunds
    where artist_business_id=payment.artist_business_id and payment_id=payment.id and status in ('pending','succeeded');
  if reserved+p_amount_minor>payment.amount_minor then raise exception using errcode='22023',message='REFUND_AMOUNT_EXCEEDS_REMAINING'; end if;
  insert into public.mova_payment_refunds(artist_business_id,payment_id,amount_minor,status,reason,idempotency_key)
    values(payment.artist_business_id,payment.id,p_amount_minor,'pending','requested_by_artist',p_idempotency_key) returning * into saved;
  return jsonb_build_object('refund_id',saved.id,'payment_id',payment.id,'payment_intent_id',payment.provider_payment_id,
    'account_id',connection.stripe_account_id,'amount_minor',saved.amount_minor,'status',saved.status,'idempotency_key',saved.idempotency_key);
end $$;

create or replace function public.mova_stripe_refund_finish(p_refund_id uuid,p_provider_refund_id text,p_status text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_status not in ('succeeded','pending','failed')
    or (p_provider_refund_id is not null and p_provider_refund_id !~ '^re_[A-Za-z0-9_]+$')
    or (p_status<>'failed' and p_provider_refund_id is null) then return false; end if;
  update public.mova_payment_refunds set provider_refund_id=p_provider_refund_id,status=p_status
    where id=p_refund_id and (provider_refund_id is null or provider_refund_id=p_provider_refund_id) and status<>'succeeded';
  return found;
end $$;

revoke all on function public.mova_stripe_checkout_prepare(uuid,bytea,text) from public,anon,authenticated;
revoke all on function public.mova_stripe_checkout_attach(uuid,text,text) from public,anon,authenticated;
revoke all on function public.mova_stripe_checkout_fail(uuid) from public,anon,authenticated;
revoke all on function public.mova_stripe_paylink_prepare(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.mova_stripe_paylink_attach(uuid,text,text) from public,anon,authenticated;
revoke all on function public.mova_stripe_paylink_resolve(text) from public,anon,authenticated;
revoke all on function public.mova_stripe_webhook_apply(text,text,text,text,text,text,bigint,boolean) from public,anon,authenticated;
revoke all on function public.mova_stripe_refund_webhook_apply(text,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.mova_stripe_refund_prepare(uuid,uuid,bigint,text) from public,anon,authenticated;
revoke all on function public.mova_stripe_refund_finish(uuid,text,text) from public,anon,authenticated;
grant execute on function public.mova_stripe_checkout_prepare(uuid,bytea,text) to service_role;
grant execute on function public.mova_stripe_checkout_attach(uuid,text,text) to service_role;
grant execute on function public.mova_stripe_checkout_fail(uuid) to service_role;
grant execute on function public.mova_stripe_paylink_prepare(uuid,uuid,text,text,text) to service_role;
grant execute on function public.mova_stripe_paylink_attach(uuid,text,text) to service_role;
grant execute on function public.mova_stripe_paylink_resolve(text) to service_role;
grant execute on function public.mova_stripe_webhook_apply(text,text,text,text,text,text,bigint,boolean) to service_role;
grant execute on function public.mova_stripe_refund_webhook_apply(text,text,text,text,boolean) to service_role;
grant execute on function public.mova_stripe_refund_prepare(uuid,uuid,bigint,text) to service_role;
grant execute on function public.mova_stripe_refund_finish(uuid,text,text) to service_role;
