create table public.mova_customer_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 160),
  preferred_locale text not null default 'en-US' check (preferred_locale in ('en-US','es-US')),
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint mova_customer_accounts_deleted_state check ((status='active' and deleted_at is null) or (status='deleted' and deleted_at is not null))
);

create table public.mova_customer_contact_methods (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.mova_customer_accounts(id) on delete cascade,
  contact_type text not null check (contact_type in ('phone','email')),
  value_normalized text not null check (length(value_normalized) between 3 and 320),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mova_customer_contact_methods_account_type_value_uq unique(customer_account_id,contact_type,value_normalized)
);
create unique index mova_customer_contact_methods_verified_uq on public.mova_customer_contact_methods(contact_type,value_normalized) where verified_at is not null;

create table public.mova_client_customer_links (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  client_id uuid not null,
  customer_account_id uuid not null references public.mova_customer_accounts(id) on delete cascade,
  linked_via text not null check (linked_via in ('booking_signed_in','claim_verified')),
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  constraint mova_client_customer_links_client_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade
);
create unique index mova_client_customer_links_active_business_uq on public.mova_client_customer_links(artist_business_id,customer_account_id) where unlinked_at is null;
create index mova_client_customer_links_customer_idx on public.mova_client_customer_links(customer_account_id,linked_at desc) where unlinked_at is null;

create table public.mova_client_link_suggestions (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  client_id uuid not null,
  customer_account_id uuid not null references public.mova_customer_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint mova_client_link_suggestions_client_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade,
  constraint mova_client_link_suggestions_account_client_uq unique(customer_account_id,client_id)
);

alter table public.mova_appointments add column customer_account_id uuid references public.mova_customer_accounts(id) on delete set null;
alter table public.mova_appointments add column client_email_normalized text;
alter table public.mova_appointments add column client_phone_normalized text;
update public.mova_appointments set
  client_email_normalized=nullif(lower(trim(client_email)),''),
  client_phone_normalized=case
    when length(regexp_replace(coalesce(client_phone,''),'[^0-9]','','g'))=10 then '1'||regexp_replace(client_phone,'[^0-9]','','g')
    else nullif(regexp_replace(coalesce(client_phone,''),'[^0-9]','','g'),'') end;
create index mova_appointments_email_claim_idx on public.mova_appointments(client_email_normalized,starts_at desc) where client_email_normalized is not null;
create index mova_appointments_phone_claim_idx on public.mova_appointments(client_phone_normalized,starts_at desc) where client_phone_normalized is not null;
create index mova_appointments_customer_upcoming_idx on public.mova_appointments(customer_account_id,starts_at) where customer_account_id is not null;

create or replace function public.mova_normalize_appointment_contacts()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare phone_digits text;
begin
  new.client_email_normalized:=nullif(lower(trim(coalesce(new.client_email,''))), '');
  phone_digits:=regexp_replace(coalesce(new.client_phone,''),'[^0-9]','','g');
  new.client_phone_normalized:=case when length(phone_digits)=10 then '1'||phone_digits else nullif(phone_digits,'') end;
  return new;
end;
$$;
revoke all on function public.mova_normalize_appointment_contacts() from public,anon,authenticated;
create trigger mova_appointments_normalize_contacts before insert or update of client_email,client_phone on public.mova_appointments for each row execute function public.mova_normalize_appointment_contacts();

create or replace function public.mova_link_signed_in_booking(p_appointment_id uuid,p_customer_account_id uuid,p_manage_token_hash bytea)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  booking public.mova_appointments%rowtype;
  account public.mova_customer_accounts%rowtype;
  verified_match boolean;
  selected_client_id uuid;
  matched_client_ids uuid[];
begin
  select * into account from public.mova_customer_accounts where id=p_customer_account_id and status='active';
  if not found then raise exception using errcode='P0002',message='CUSTOMER_ACCOUNT_NOT_FOUND'; end if;
  select * into booking from public.mova_appointments where id=p_appointment_id and (p_manage_token_hash is null or manage_token_hash=p_manage_token_hash) for update;
  if not found then raise exception using errcode='P0002',message='BOOKING_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(booking.artist_business_id::text||':'||account.id::text,0));

  select exists (
    select 1 from public.mova_customer_contact_methods cm
    where cm.customer_account_id=account.id and cm.verified_at is not null and (
      (cm.contact_type='email' and lower(trim(coalesce(booking.client_email,'')))=cm.value_normalized)
      or (cm.contact_type='phone' and case
        when length(regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g'))=10 then '1'||regexp_replace(booking.client_phone,'[^0-9]','','g')
        else regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g') end=cm.value_normalized)
    )
  ) into verified_match;
  if not verified_match then raise exception using errcode='42501',message='VERIFIED_CONTACT_MISMATCH'; end if;

  select client_id into selected_client_id from public.mova_client_customer_links
    where artist_business_id=booking.artist_business_id and customer_account_id=account.id and unlinked_at is null limit 1;
  if selected_client_id is null then
    select array_agg(distinct c.id) into matched_client_ids from public.mova_clients c
      join public.mova_customer_contact_methods cm on cm.customer_account_id=account.id and cm.verified_at is not null
      where c.artist_business_id=booking.artist_business_id and (
        (cm.contact_type='email' and c.email_normalized=cm.value_normalized)
        or (cm.contact_type='phone' and c.phone_normalized=cm.value_normalized)
      );
    if coalesce(cardinality(matched_client_ids),0)=1 and not exists (
      select 1 from public.mova_client_customer_links l where l.artist_business_id=booking.artist_business_id
        and l.client_id=matched_client_ids[1] and l.unlinked_at is null and l.customer_account_id<>account.id
    ) then
      selected_client_id:=matched_client_ids[1];
    else
      insert into public.mova_clients(artist_business_id,display_name,email,email_normalized,phone,phone_normalized,preferred_locale,source)
      values(
        booking.artist_business_id,left(trim(booking.client_name),160),nullif(trim(booking.client_email),''),nullif(lower(trim(booking.client_email)),''),
        nullif(trim(booking.client_phone),''),case when length(regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g'))=10 then '1'||regexp_replace(booking.client_phone,'[^0-9]','','g') else nullif(regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g'),'') end,
        booking.client_locale,'booking'
      ) returning id into selected_client_id;
      if coalesce(cardinality(matched_client_ids),0)>0 then
        insert into public.mova_client_link_suggestions(artist_business_id,client_id,customer_account_id)
        select booking.artist_business_id,matched_id,account.id from unnest(matched_client_ids) matched_id
        on conflict(customer_account_id,client_id) do nothing;
      end if;
    end if;
    insert into public.mova_client_customer_links(artist_business_id,client_id,customer_account_id,linked_via)
    values(booking.artist_business_id,selected_client_id,account.id,'booking_signed_in');
  end if;
  update public.mova_appointments set client_id=selected_client_id,customer_account_id=account.id where id=booking.id;
  return jsonb_build_object('linked',true);
end;
$$;
revoke all on function public.mova_link_signed_in_booking(uuid,uuid,bytea) from public,anon,authenticated;
grant execute on function public.mova_link_signed_in_booking(uuid,uuid,bytea) to service_role;

alter table public.mova_customer_accounts enable row level security;
alter table public.mova_customer_contact_methods enable row level security;
alter table public.mova_client_customer_links enable row level security;
alter table public.mova_client_link_suggestions enable row level security;
revoke all on public.mova_customer_accounts,public.mova_customer_contact_methods,public.mova_client_customer_links,public.mova_client_link_suggestions from public,anon,authenticated;
