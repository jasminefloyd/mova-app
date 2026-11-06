create table public.mova_clients (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 160),
  email text,
  email_normalized text,
  phone text,
  phone_normalized text,
  preferred_locale text not null default 'en-US' check (preferred_locale in ('en-US','es-US')),
  source text not null default 'manual' check (source in ('manual','booking','import')),
  marketing_opted_out boolean not null default false,
  last_visit_at timestamptz,
  visit_count integer not null default 0 check (visit_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_clients_id_business_uq unique (id,artist_business_id)
);
create index mova_clients_business_name_idx on public.mova_clients(artist_business_id,lower(display_name));
create index mova_clients_business_email_idx on public.mova_clients(artist_business_id,email_normalized) where email_normalized is not null;
create index mova_clients_business_phone_idx on public.mova_clients(artist_business_id,phone_normalized) where phone_normalized is not null;
create index mova_clients_business_last_visit_idx on public.mova_clients(artist_business_id,last_visit_at desc nulls last);
create trigger mova_clients_touch_updated_at before update on public.mova_clients for each row execute function public.mova_touch_updated_at();

create table public.mova_client_consents (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null,
  client_id uuid not null,
  purpose text not null check (purpose in ('appointment_updates','rebooking_reminders','offers','review_requests')),
  channel text not null check (channel in ('sms','email','instagram','push')),
  granted boolean not null,
  locale text not null default 'en-US' check (locale in ('en-US','es-US')),
  evidence jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint mova_client_consents_client_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade
);
create index mova_client_consents_latest_idx on public.mova_client_consents(artist_business_id,client_id,purpose,channel,changed_at desc,id desc);

create table public.mova_client_import_batches (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  idempotency_key text not null check(length(idempotency_key) between 8 and 200),
  payload_hash bytea not null,
  created_by uuid references auth.users(id) on delete set null,
  imported_count integer not null default 0,
  merged_count integer not null default 0,
  kept_both_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint mova_client_import_batches_business_key_uq unique(artist_business_id,idempotency_key)
);
alter table public.mova_appointments add constraint mova_appointments_id_business_uq unique(id,artist_business_id);
alter table public.mova_appointments add constraint mova_appointments_client_business_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id);

alter table public.mova_clients enable row level security;
alter table public.mova_client_consents enable row level security;
alter table public.mova_client_import_batches enable row level security;
create policy mova_clients_artist_select on public.mova_clients for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_client_consents_artist_select on public.mova_client_consents for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_client_import_batches_artist_select on public.mova_client_import_batches for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
revoke all on public.mova_clients,public.mova_client_consents,public.mova_client_import_batches from public,anon,authenticated;

create or replace function public.mova_refresh_client_visit_stats(p_client_id uuid,p_artist_business_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.mova_clients c set visit_count=(select count(*)::int from public.mova_appointments a where a.client_id=c.id and a.artist_business_id=c.artist_business_id and a.status='completed'),
    last_visit_at=(select max(a.starts_at) from public.mova_appointments a where a.client_id=c.id and a.artist_business_id=c.artist_business_id and a.status='completed')
  where c.id=p_client_id and c.artist_business_id=p_artist_business_id;
end $$;
revoke all on function public.mova_refresh_client_visit_stats(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mova_refresh_client_visit_stats(uuid,uuid) to service_role;

create or replace function public.mova_client_appointment_stats_trigger() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.client_id is not null and (old.client_id is distinct from new.client_id or old.status is distinct from new.status) then
    perform public.mova_refresh_client_visit_stats(old.client_id,old.artist_business_id);
  end if;
  if new.client_id is not null then perform public.mova_refresh_client_visit_stats(new.client_id,new.artist_business_id); end if;
  return new;
end $$;
create trigger mova_appointments_client_stats after insert or update of client_id,status on public.mova_appointments for each row execute function public.mova_client_appointment_stats_trigger();
revoke all on function public.mova_client_appointment_stats_trigger() from public,anon,authenticated;

create or replace function public.mova_client_capture_booking(p_appointment_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.mova_appointments%rowtype; matched_id uuid; matched_count integer; phone_key text; email_key text; marketing_opted_out boolean; review_consent boolean; review_consent_exists boolean;
begin
  select * into a from public.mova_appointments where id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='APPOINTMENT_NOT_FOUND'; end if;
  if a.client_id is not null then return a.client_id; end if;
  phone_key:=nullif(regexp_replace(coalesce(a.client_phone,''),'[^0-9]','','g'),'');
  if length(phone_key)=10 then phone_key:='1'||phone_key; end if;
  email_key:=nullif(lower(trim(coalesce(a.client_email,''))),'');
  select count(*)::integer,(array_agg(candidate.id))[1] into matched_count,matched_id from (select distinct c.id from public.mova_clients c where c.artist_business_id=a.artist_business_id and ((email_key is not null and c.email_normalized=email_key) or (phone_key is not null and c.phone_normalized=phone_key))) candidate;
  if matched_count=1 then
    update public.mova_appointments set client_id=matched_id where id=a.id;
  elsif matched_count>1 or (phone_key is null and email_key is null) then
    return null;
  else
    insert into public.mova_clients(artist_business_id,display_name,email,email_normalized,phone,phone_normalized,preferred_locale,source)
      values(a.artist_business_id,coalesce(nullif(trim(a.client_name),''),'Client'),nullif(trim(a.client_email),''),email_key,nullif(trim(a.client_phone),''),phone_key,coalesce(a.client_locale,'en-US'),'booking') returning id into matched_id;
    update public.mova_appointments set client_id=matched_id where id=a.id;
  end if;
  if phone_key is not null then insert into public.mova_client_consents(artist_business_id,client_id,purpose,channel,granted,locale,evidence) values(a.artist_business_id,matched_id,'appointment_updates','sms',true,coalesce(a.client_locale,'en-US'),jsonb_build_object('source','booking_contact_provided','appointment_id',a.id)); end if;
  if email_key is not null then
    insert into public.mova_client_consents(artist_business_id,client_id,purpose,channel,granted,locale,evidence) values(a.artist_business_id,matched_id,'appointment_updates','email',true,coalesce(a.client_locale,'en-US'),jsonb_build_object('source','booking_contact_provided','appointment_id',a.id));
    select c.marketing_opted_out into marketing_opted_out from public.mova_clients c where c.id=matched_id and c.artist_business_id=a.artist_business_id;
    select cc.granted into review_consent from public.mova_client_consents cc where cc.artist_business_id=a.artist_business_id and cc.client_id=matched_id and cc.purpose='review_requests' and cc.channel='email' order by cc.changed_at desc,cc.id desc limit 1;
    review_consent_exists:=found;
    if not coalesce(marketing_opted_out,false) and not review_consent_exists then insert into public.mova_client_consents(artist_business_id,client_id,purpose,channel,granted,locale,evidence) values(a.artist_business_id,matched_id,'review_requests','email',true,coalesce(a.client_locale,'en-US'),jsonb_build_object('source','booking_default_a29','appointment_id',a.id)); end if;
  end if;
  return matched_id;
end $$;
revoke all on function public.mova_client_capture_booking(uuid) from public,anon,authenticated;
grant execute on function public.mova_client_capture_booking(uuid) to service_role;

do $$
declare appointment_row record;
begin
  for appointment_row in select id from public.mova_appointments where client_id is null order by created_at,id loop
    perform public.mova_client_capture_booking(appointment_row.id);
  end loop;
end $$;

create or replace function public.mova_appointments_capture_client_trigger() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.mova_client_capture_booking(new.id);
  return new;
end $$;
create trigger mova_appointments_capture_client after insert on public.mova_appointments for each row when (new.client_id is null) execute function public.mova_appointments_capture_client_trigger();
revoke all on function public.mova_appointments_capture_client_trigger() from public,anon,authenticated;

create or replace function public.mova_set_client_marketing_opt_out(p_artist_business_id uuid,p_client_id uuid,p_opted_out boolean,p_locale text,p_actor_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare purpose_name text; channel_name text;
begin
  update public.mova_clients set marketing_opted_out=p_opted_out where id=p_client_id and artist_business_id=p_artist_business_id;
  if not found then raise exception using errcode='P0002',message='CLIENT_NOT_FOUND'; end if;
  if p_opted_out then
    foreach purpose_name in array array['rebooking_reminders','offers','review_requests'] loop
      foreach channel_name in array array['sms','email','instagram','push'] loop
        insert into public.mova_client_consents(artist_business_id,client_id,purpose,channel,granted,locale,evidence,changed_by)
          values(p_artist_business_id,p_client_id,purpose_name,channel_name,false,coalesce(p_locale,'en-US'),jsonb_build_object('source','artist_opt_out','copy_version','p07-v1'),p_actor_id);
      end loop;
    end loop;
  end if;
end $$;
revoke all on function public.mova_set_client_marketing_opt_out(uuid,uuid,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_set_client_marketing_opt_out(uuid,uuid,boolean,text,uuid) to service_role;

create or replace function public.mova_client_import_commit(p_artist_business_id uuid,p_actor_id uuid,p_idempotency_key text,p_payload_hash_hex text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare batch public.mova_client_import_batches%rowtype; item jsonb; new_id uuid; imported integer:=0; merged integer:=0; kept integer:=0; hash_value bytea;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 then raise exception using errcode='22023',message='IMPORT_ROWS_INVALID'; end if;
  hash_value:=decode(p_payload_hash_hex,'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_artist_business_id::text||':'||p_idempotency_key,0));
  select * into batch from public.mova_client_import_batches where artist_business_id=p_artist_business_id and idempotency_key=p_idempotency_key for update;
  if found then
    if batch.payload_hash<>hash_value then raise exception using errcode='23505',message='IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('batch_id',batch.id,'imported',batch.imported_count,'merged',batch.merged_count,'kept_both',batch.kept_both_count,'replayed',true);
  end if;
  insert into public.mova_client_import_batches(artist_business_id,idempotency_key,payload_hash,created_by) values(p_artist_business_id,p_idempotency_key,hash_value,p_actor_id) returning * into batch;
  for item in select value from jsonb_array_elements(p_rows) loop
    if item->>'decision'='merge' then
      new_id:=nullif(item->>'target_client_id','')::uuid;
      if new_id is null then raise exception using errcode='22023',message='IMPORT_MERGE_TARGET_REQUIRED'; end if;
      update public.mova_clients c set display_name=case when c.display_name='' then item->>'name' else c.display_name end,
        email=coalesce(c.email,nullif(item->>'email','')),email_normalized=coalesce(c.email_normalized,nullif(item->>'email_normalized','')),
        phone=coalesce(c.phone,nullif(item->>'phone','')),phone_normalized=coalesce(c.phone_normalized,nullif(item->>'phone_normalized','')),
        preferred_locale=coalesce(nullif(item->>'preferred_locale',''),c.preferred_locale)
      where c.id=new_id and c.artist_business_id=p_artist_business_id;
      if not found then raise exception using errcode='P0002',message='IMPORT_TARGET_NOT_FOUND'; end if;
      merged:=merged+1;
    elsif item->>'decision' in ('new','keep_both') then
      insert into public.mova_clients(artist_business_id,display_name,email,email_normalized,phone,phone_normalized,preferred_locale,source,created_by)
      values(p_artist_business_id,trim(item->>'name'),nullif(item->>'email',''),nullif(item->>'email_normalized',''),nullif(item->>'phone',''),nullif(item->>'phone_normalized',''),coalesce(nullif(item->>'preferred_locale',''),'en-US'),'import',p_actor_id);
      imported:=imported+1;
      if item->>'decision'='keep_both' then kept:=kept+1; end if;
    else
      raise exception using errcode='22023',message='IMPORT_DECISION_REQUIRED';
    end if;
  end loop;
  update public.mova_client_import_batches set imported_count=imported,merged_count=merged,kept_both_count=kept where id=batch.id;
  return jsonb_build_object('batch_id',batch.id,'imported',imported,'merged',merged,'kept_both',kept,'replayed',false);
end $$;
revoke all on function public.mova_client_import_commit(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.mova_client_import_commit(uuid,uuid,text,text,jsonb) to service_role;
