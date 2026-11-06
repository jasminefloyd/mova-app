create table public.mova_platform_fee_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  fee_bps integer not null check (fee_bps between 0 and 10000),
  effective_at timestamptz not null,
  created_at timestamptz not null default now()
);
insert into public.mova_platform_fee_versions(version, fee_bps, effective_at)
values (1, 150, now());

create table public.mova_payment_method_settings (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  cash_enabled boolean not null default true,
  zelle_recorded_enabled boolean not null default true,
  other_enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.mova_stripe_connections (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null unique references public.mova_artist_businesses(id) on delete cascade,
  stripe_account_id text unique,
  account_type text check (account_type in ('standard','express','custom','v2_merchant')),
  status text not null default 'not_connected' check (status in ('not_connected','pending','restricted','active','disconnected')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_stripe_connections_account_prefix_check check (stripe_account_id is null or left(stripe_account_id,5)='acct_')
);

create table public.mova_payments (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  appointment_id uuid not null,
  method text not null check (method in ('card_checkout','card_paylink_sms','card_paylink_qr','wallet_checkout','zelle_recorded','cash','other','salon_collected')),
  collector text not null check (collector in ('mova_processed','artist','salon')),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','partially_refunded','refunded')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  platform_fee_bps integer not null default 0 check (platform_fee_bps between 0 and 10000),
  platform_fee_minor bigint not null default 0 check (platform_fee_minor >= 0),
  processor_fee_minor bigint not null default 0 check (processor_fee_minor >= 0),
  recorded_method_label text,
  confirmation_ref text,
  provider text check (provider in ('stripe')),
  provider_payment_id text,
  provider_event_id text,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_payments_appointment_fk foreign key (appointment_id, artist_business_id) references public.mova_appointments(id, artist_business_id) on delete cascade,
  constraint mova_payments_business_idempotency_uq unique (artist_business_id, idempotency_key),
  constraint mova_payments_id_business_uq unique (id,artist_business_id),
  constraint mova_payments_provider_id_uq unique (provider, provider_payment_id),
  constraint mova_payments_method_collector_check check (
    (method in ('card_checkout','card_paylink_sms','card_paylink_qr','wallet_checkout') and collector = 'mova_processed')
    or (method in ('zelle_recorded','cash','other') and collector in ('artist','salon'))
    or (method = 'salon_collected' and collector = 'salon')
  ),
  constraint mova_payments_other_label_check check ((method = 'other' and nullif(trim(recorded_method_label),'') is not null) or (method <> 'other' and recorded_method_label is null))
);
create index mova_payments_business_created_idx on public.mova_payments(artist_business_id, created_at desc);
create index mova_payments_appointment_idx on public.mova_payments(artist_business_id, appointment_id, created_at);

create table public.mova_payment_ledger (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  appointment_id uuid not null,
  payment_id uuid,
  category text not null check (category in ('service_value','mova_processed','recorded_artist','collected_salon','mova_platform_fee','processor_fee','refund')),
  amount_minor bigint not null check (amount_minor <> 0),
  currency text not null default 'USD' check (currency = 'USD'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint mova_payment_ledger_appointment_fk foreign key (appointment_id, artist_business_id) references public.mova_appointments(id, artist_business_id) on delete cascade,
  constraint mova_payment_ledger_payment_fk foreign key (payment_id, artist_business_id) references public.mova_payments(id, artist_business_id) on delete cascade,
  constraint mova_payment_ledger_business_key_uq unique (artist_business_id, idempotency_key)
);
create index mova_payment_ledger_business_created_idx on public.mova_payment_ledger(artist_business_id, created_at desc);
create index mova_payment_ledger_appointment_idx on public.mova_payment_ledger(artist_business_id, appointment_id, created_at);

create table public.mova_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  payment_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  provider_refund_id text unique,
  reason text,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mova_payment_refunds_payment_fk foreign key (payment_id, artist_business_id) references public.mova_payments(id, artist_business_id) on delete cascade,
  constraint mova_payment_refunds_business_key_uq unique (artist_business_id, idempotency_key)
);

create table public.mova_paylinks (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  appointment_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  channel text not null check (channel in ('sms','qr')),
  short_code text not null unique check (length(short_code) between 20 and 96),
  provider_session_id text unique,
  status text not null default 'open' check (status in ('open','paid','expired','cancelled')),
  expires_at timestamptz not null,
  paid_payment_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_paylinks_appointment_fk foreign key (appointment_id, artist_business_id) references public.mova_appointments(id, artist_business_id) on delete cascade,
  constraint mova_paylinks_paid_payment_fk foreign key (paid_payment_id, artist_business_id) references public.mova_payments(id, artist_business_id) on delete set null (paid_payment_id),
  constraint mova_paylinks_business_idempotency_uq unique (artist_business_id,idempotency_key)
);
create unique index mova_paylinks_one_open_per_appointment_uq on public.mova_paylinks(artist_business_id, appointment_id) where status='open';

create table public.mova_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe')),
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint mova_webhook_events_provider_event_uq unique (provider,provider_event_id)
);

create or replace function public.mova_payment_ledger_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception using errcode='55000', message='PAYMENT_LEDGER_IMMUTABLE';
end;
$$;
create trigger mova_payment_ledger_immutable_trigger before update or delete on public.mova_payment_ledger for each row execute function public.mova_payment_ledger_immutable();

create or replace function public.mova_payment_snapshot_platform_fee()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare active_fee_bps integer;
begin
  if new.collector='mova_processed' and new.method in ('card_checkout','card_paylink_sms','card_paylink_qr','wallet_checkout') then
    select fee_bps into active_fee_bps from public.mova_platform_fee_versions
    where effective_at<=coalesce(new.created_at,now()) order by effective_at desc,version desc limit 1;
    if active_fee_bps is null then raise exception using errcode='55000',message='PLATFORM_FEE_NOT_CONFIGURED'; end if;
    new.platform_fee_bps:=active_fee_bps;
    new.platform_fee_minor:=floor((new.amount_minor::numeric*active_fee_bps+5000)/10000)::bigint;
  else
    new.platform_fee_bps:=0;
    new.platform_fee_minor:=0;
  end if;
  return new;
end;
$$;
create trigger mova_payments_snapshot_platform_fee before insert on public.mova_payments for each row execute function public.mova_payment_snapshot_platform_fee();

create or replace function public.mova_payment_post_card_entries()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='succeeded' and new.collector='mova_processed' and new.method in ('card_checkout','card_paylink_sms','card_paylink_qr','wallet_checkout')
    and (tg_op='INSERT' or old.status<>'succeeded') then
    insert into public.mova_payment_ledger(artist_business_id,appointment_id,payment_id,category,amount_minor,currency,idempotency_key)
    values
      (new.artist_business_id,new.appointment_id,new.id,'mova_processed',new.amount_minor,new.currency,'payment_gross:'||new.id::text),
      (new.artist_business_id,new.appointment_id,new.id,'mova_platform_fee',-new.platform_fee_minor,new.currency,'payment_platform_fee:'||new.id::text)
    on conflict (artist_business_id,idempotency_key) do nothing;
    if new.processor_fee_minor>0 then
      insert into public.mova_payment_ledger(artist_business_id,appointment_id,payment_id,category,amount_minor,currency,idempotency_key)
      values(new.artist_business_id,new.appointment_id,new.id,'processor_fee',-new.processor_fee_minor,new.currency,'payment_processor_fee:'||new.id::text)
      on conflict (artist_business_id,idempotency_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;
create trigger mova_payments_post_card_entries after insert or update of status on public.mova_payments for each row execute function public.mova_payment_post_card_entries();

create or replace function public.mova_payment_post_refund_entry()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare payment public.mova_payments%rowtype;
begin
  if new.status='succeeded' and (tg_op='INSERT' or old.status<>'succeeded') then
    select * into payment from public.mova_payments where id=new.payment_id and artist_business_id=new.artist_business_id;
    if not found then raise exception using errcode='23503',message='REFUND_PAYMENT_NOT_FOUND'; end if;
    insert into public.mova_payment_ledger(artist_business_id,appointment_id,payment_id,category,amount_minor,currency,idempotency_key)
    values(new.artist_business_id,payment.appointment_id,new.payment_id,'refund',-new.amount_minor,payment.currency,'refund:'||new.id::text)
    on conflict (artist_business_id,idempotency_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger mova_payment_refunds_post_ledger after insert or update of status on public.mova_payment_refunds for each row execute function public.mova_payment_post_refund_entry();

create or replace function public.mova_payment_sync_appointment_balance()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare target_business uuid; target_appointment uuid;
begin
  target_business := coalesce(new.artist_business_id,old.artist_business_id);
  if tg_table_name='mova_payment_refunds' then
    select p.appointment_id into target_appointment from public.mova_payments p
    where p.id=coalesce(new.payment_id,old.payment_id) and p.artist_business_id=target_business;
  else
    target_appointment := coalesce(new.appointment_id,old.appointment_id);
  end if;
  update public.mova_appointments a set balance_due_minor = greatest(0,
    a.service_price_minor
    - coalesce((select sum(p.amount_minor) from public.mova_payments p where p.artist_business_id=target_business and p.appointment_id=target_appointment and p.status in ('succeeded','partially_refunded','refunded')),0)
    + coalesce((select sum(r.amount_minor) from public.mova_payment_refunds r where r.artist_business_id=target_business and r.payment_id in (select p.id from public.mova_payments p where p.artist_business_id=target_business and p.appointment_id=target_appointment) and r.status='succeeded'),0)
  ) where a.id=target_appointment and a.artist_business_id=target_business;
  return coalesce(new,old);
end;
$$;
create trigger mova_payments_sync_appointment_balance after insert or update of status,amount_minor on public.mova_payments for each row execute function public.mova_payment_sync_appointment_balance();
create trigger mova_payment_refunds_sync_appointment_balance after insert or update of status,amount_minor on public.mova_payment_refunds for each row execute function public.mova_payment_sync_appointment_balance();

create or replace function public.mova_payment_post_service_value()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status in ('confirmed','completed') and (tg_op='INSERT' or (tg_op='UPDATE' and old.status not in ('confirmed','completed'))) then
    insert into public.mova_payment_ledger(artist_business_id,appointment_id,category,amount_minor,currency,idempotency_key)
    values(new.artist_business_id,new.id,'service_value',new.service_price_minor,'USD','service_value:'||new.id::text)
    on conflict (artist_business_id,idempotency_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger mova_appointments_post_service_value after insert or update of status on public.mova_appointments for each row execute function public.mova_payment_post_service_value();
insert into public.mova_payment_ledger(artist_business_id,appointment_id,category,amount_minor,currency,idempotency_key)
select artist_business_id,id,'service_value',service_price_minor,'USD','service_value:'||id::text
from public.mova_appointments where status in ('confirmed','completed')
on conflict (artist_business_id,idempotency_key) do nothing;

create or replace function public.mova_payment_record_manual(
  p_artist_business_id uuid,
  p_appointment_id uuid,
  p_method text,
  p_amount_minor bigint,
  p_collector text,
  p_recorded_method_label text,
  p_confirmation_ref text,
  p_idempotency_key text,
  p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare appointment public.mova_appointments%rowtype; payment public.mova_payments%rowtype; current_balance bigint; existing public.mova_payments%rowtype;
begin
  if p_method is null or p_method not in ('cash','zelle_recorded','other','salon_collected') or p_amount_minor is null or p_amount_minor <= 0 or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 or p_artist_business_id is null or p_appointment_id is null or p_collector is null then
    raise exception using errcode='22023',message='MANUAL_PAYMENT_INVALID';
  end if;
  if exists(select 1 from public.mova_payment_method_settings s where s.artist_business_id=p_artist_business_id and ((p_method='cash' and not s.cash_enabled) or (p_method='zelle_recorded' and not s.zelle_recorded_enabled) or (p_method='other' and not s.other_enabled))) then
    raise exception using errcode='22023',message='PAYMENT_METHOD_DISABLED';
  end if;
  if (p_method='salon_collected' and p_collector<>'salon') or (p_method<>'salon_collected' and p_collector not in ('artist','salon')) then
    raise exception using errcode='22023',message='PAYMENT_COLLECTOR_INVALID';
  end if;
  if (p_method='other' and nullif(trim(p_recorded_method_label),'') is null) or (p_method<>'other' and p_recorded_method_label is not null) then
    raise exception using errcode='22023',message='RECORDED_METHOD_LABEL_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_artist_business_id::text||':'||p_idempotency_key,0));
  select * into existing from public.mova_payments where artist_business_id=p_artist_business_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.appointment_id<>p_appointment_id or existing.method<>p_method or existing.amount_minor<>p_amount_minor or existing.collector<>p_collector then
      raise exception using errcode='23505',message='IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object('id',existing.id,'amount_minor',existing.amount_minor,'status',existing.status,'replayed',true);
  end if;
  select * into appointment from public.mova_appointments where id=p_appointment_id and artist_business_id=p_artist_business_id for update;
  if not found then raise exception using errcode='P0002',message='APPOINTMENT_NOT_FOUND'; end if;
  if appointment.status not in ('confirmed','completed') then raise exception using errcode='22023',message='APPOINTMENT_NOT_PAYABLE'; end if;
  select greatest(0,appointment.service_price_minor
    - coalesce((select sum(amount_minor) from public.mova_payments where artist_business_id=p_artist_business_id and appointment_id=p_appointment_id and status in ('succeeded','partially_refunded','refunded')),0)
    + coalesce((select sum(r.amount_minor) from public.mova_payment_refunds r join public.mova_payments p on p.id=r.payment_id and p.artist_business_id=r.artist_business_id where r.artist_business_id=p_artist_business_id and p.appointment_id=p_appointment_id and r.status='succeeded'),0)
  ) into current_balance;
  if p_amount_minor>current_balance then raise exception using errcode='22023',message='PAYMENT_EXCEEDS_BALANCE'; end if;
  insert into public.mova_payments(artist_business_id,appointment_id,method,collector,status,amount_minor,recorded_method_label,confirmation_ref,idempotency_key,created_by)
  values(p_artist_business_id,p_appointment_id,p_method,p_collector,'succeeded',p_amount_minor,nullif(trim(p_recorded_method_label),''),nullif(trim(p_confirmation_ref),''),p_idempotency_key,p_actor_id)
  returning * into payment;
  insert into public.mova_payment_ledger(artist_business_id,appointment_id,payment_id,category,amount_minor,currency,idempotency_key)
  values(p_artist_business_id,p_appointment_id,payment.id,case when p_collector='salon' then 'collected_salon' else 'recorded_artist' end,p_amount_minor,'USD','payment:'||payment.id::text);
  return jsonb_build_object('id',payment.id,'amount_minor',payment.amount_minor,'status',payment.status,'replayed',false);
end;
$$;

create or replace function public.mova_money_month_summary(p_artist_business_id uuid,p_month date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if p_month is null or extract(day from p_month)<>1 then
    raise exception using errcode='22023',message='MONEY_MONTH_INVALID';
  end if;
  select jsonb_build_object(
    'totals',jsonb_build_object(
      'service_value_minor',coalesce(sum(amount_minor) filter(where category='service_value'),0),
      'mova_processed_minor',coalesce(sum(amount_minor) filter(where category='mova_processed'),0),
      'recorded_by_artist_minor',coalesce(sum(amount_minor) filter(where category='recorded_artist'),0),
      'collected_by_salon_minor',coalesce(sum(amount_minor) filter(where category='collected_salon'),0),
      'mova_platform_fee_minor',coalesce(sum(amount_minor) filter(where category='mova_platform_fee'),0),
      'processor_fee_minor',coalesce(sum(amount_minor) filter(where category='processor_fee'),0),
      'refunds_minor',coalesce(sum(amount_minor) filter(where category='refund'),0),
      'estimated_to_artist_minor',coalesce(sum(amount_minor) filter(where category in ('mova_processed','recorded_artist','mova_platform_fee','processor_fee','refund')),0)
    ),
    'activity',coalesce((
      select jsonb_agg(jsonb_build_object('id',x.id,'category',x.category,'amount_minor',x.amount_minor,'created_at',x.created_at,'client_name',x.client_name,'service_name',x.service_name,'payment_method',x.payment_method) order by x.created_at desc)
      from (
        select l.id,l.category,l.amount_minor,l.created_at,a.client_name,a.service_name_snapshot as service_name,p.method as payment_method
        from public.mova_payment_ledger l
        join public.mova_appointments a on a.id=l.appointment_id and a.artist_business_id=l.artist_business_id
        join public.mova_locations loc on loc.id=a.location_id and loc.artist_business_id=a.artist_business_id
        left join public.mova_payments p on p.id=l.payment_id and p.artist_business_id=l.artist_business_id
        where l.artist_business_id=p_artist_business_id
          and l.category in ('mova_processed','recorded_artist','collected_salon','refund')
          and (l.created_at at time zone loc.time_zone)::date >= p_month
          and (l.created_at at time zone loc.time_zone)::date < (p_month + interval '1 month')::date
        order by l.created_at desc limit 20
      ) x
    ),'[]'::jsonb)
  ) into result
  from public.mova_payment_ledger l
  join public.mova_appointments a on a.id=l.appointment_id and a.artist_business_id=l.artist_business_id
  join public.mova_locations loc on loc.id=a.location_id and loc.artist_business_id=a.artist_business_id
  where l.artist_business_id=p_artist_business_id
    and (l.created_at at time zone loc.time_zone)::date >= p_month
    and (l.created_at at time zone loc.time_zone)::date < (p_month + interval '1 month')::date;
  return result;
end;
$$;

revoke all on function public.mova_payment_ledger_immutable() from public,anon,authenticated;
revoke all on function public.mova_payment_snapshot_platform_fee() from public,anon,authenticated;
revoke all on function public.mova_payment_post_card_entries() from public,anon,authenticated;
revoke all on function public.mova_payment_post_refund_entry() from public,anon,authenticated;
revoke all on function public.mova_payment_sync_appointment_balance() from public,anon,authenticated;
revoke all on function public.mova_payment_post_service_value() from public,anon,authenticated;
revoke all on function public.mova_payment_record_manual(uuid,uuid,text,bigint,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_payment_record_manual(uuid,uuid,text,bigint,text,text,text,text,uuid) to service_role;
revoke all on function public.mova_money_month_summary(uuid,date) from public,anon,authenticated;
grant execute on function public.mova_money_month_summary(uuid,date) to service_role;

alter table public.mova_platform_fee_versions enable row level security;
alter table public.mova_payment_method_settings enable row level security;
alter table public.mova_stripe_connections enable row level security;
alter table public.mova_payments enable row level security;
alter table public.mova_payment_ledger enable row level security;
alter table public.mova_payment_refunds enable row level security;
alter table public.mova_paylinks enable row level security;
alter table public.mova_webhook_events enable row level security;
create policy mova_stripe_connections_artist_select on public.mova_stripe_connections for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_payment_method_settings_artist_select on public.mova_payment_method_settings for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_payments_artist_select on public.mova_payments for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_payment_ledger_artist_select on public.mova_payment_ledger for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_payment_refunds_artist_select on public.mova_payment_refunds for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_paylinks_artist_select on public.mova_paylinks for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
revoke all on public.mova_platform_fee_versions,public.mova_payment_method_settings,public.mova_stripe_connections,public.mova_payments,public.mova_payment_ledger,public.mova_payment_refunds,public.mova_paylinks,public.mova_webhook_events from public,anon,authenticated;
grant select on public.mova_payment_method_settings,public.mova_stripe_connections,public.mova_payments,public.mova_payment_ledger,public.mova_payment_refunds,public.mova_paylinks to authenticated;
grant all on public.mova_platform_fee_versions,public.mova_payment_method_settings,public.mova_stripe_connections,public.mova_payments,public.mova_payment_ledger,public.mova_payment_refunds,public.mova_paylinks,public.mova_webhook_events to service_role;
