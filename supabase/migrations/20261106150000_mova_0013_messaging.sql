create table public.mova_sending_identities (
  id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  channel text not null check(channel in ('sms','email','instagram')), address text not null,
  provider text not null, registration_status text not null default 'unverified' check(registration_status in ('unverified','pending','approved','rejected')),
  status text not null default 'inactive' check(status in ('active','inactive','suspended')), created_at timestamptz not null default now(),
  unique(artist_business_id,channel,address)
);
create table public.mova_message_templates (
  id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  type text not null, locale text not null check(locale in ('en-US','es-US')), body text not null check(length(body) between 1 and 2000), variables jsonb not null default '[]',
  version integer not null check(version>0), status text not null default 'needs_approval' check(status in ('needs_approval','approved','paused')),
  approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz,
  source text not null default 'artist_edit' check(source in ('system_default','artist_edit','ai_draft')), created_at timestamptz not null default now(),
  unique(artist_business_id,type,locale,version)
);
create table public.mova_messages (
  id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  client_id uuid, conversation_id uuid, direction text not null check(direction in ('outbound','inbound')),
  channel text not null check(channel in ('sms','email','instagram','push','in_app')), purpose text not null,
  template_id uuid references public.mova_message_templates(id) on delete set null, provider text,
  origin text not null default 'transactional' check(origin in ('artist','system','transactional','autopilot','seat_filler','concierge')),
  body text not null default '', media jsonb not null default '[]',
  status text not null check(status in ('queued','sent','delivered','failed','received','read','suppressed')),
  provider_message_id text, error_code text, idempotency_key text not null, cost_micros bigint check(cost_micros is null or cost_micros>=0),
  created_at timestamptz not null default now(), sent_at timestamptz, delivered_at timestamptz,
  unique(artist_business_id,idempotency_key),
  foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete set null (client_id)
);
create index mova_messages_inbox_idx on public.mova_messages(artist_business_id,created_at desc) where direction='inbound';
create unique index mova_messages_provider_id_uq on public.mova_messages(provider,provider_message_id) where provider is not null and provider_message_id is not null;
create table public.mova_suppressions (
  id uuid primary key default gen_random_uuid(), artist_business_id uuid references public.mova_artist_businesses(id) on delete cascade,
  channel text not null check(channel in ('sms','email','instagram','push')), address_hash text not null,
  reason text not null check(reason in ('stop','bounce','complaint','manual')), created_at timestamptz not null default now(),
  unique(artist_business_id,channel,address_hash,reason)
);
create table public.mova_notification_preferences (
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, preferences jsonb not null default '{"in_app":true,"email":true,"push":false}'::jsonb,
  updated_at timestamptz not null default now(), primary key(artist_business_id,user_id)
);
create table public.mova_notification_inbox (
  id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, event_type text not null, title_key text not null,
  body_key text not null, payload jsonb not null default '{}', read_at timestamptz, created_at timestamptz not null default now(),
  unique(artist_business_id,user_id,event_type,payload)
);
create index mova_notification_inbox_unread_idx on public.mova_notification_inbox(user_id,created_at desc) where read_at is null;
create table public.mova_push_subscriptions (
  id uuid primary key default gen_random_uuid(), artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, endpoint_hash text not null, endpoint_encrypted bytea not null,
  key_material_encrypted bytea not null, user_agent_family text, created_at timestamptz not null default now(), revoked_at timestamptz,
  unique(artist_business_id,user_id,endpoint_hash)
);

create or replace function public.mova_can_send(p_artist_business_id uuid,p_client_id uuid,p_channel text,p_purpose text,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.mova_clients%rowtype; latest_consent record; channel_address text; client_time_zone text; addr_hash text; quiet jsonb; local_now timestamp;
begin
  select * into c from public.mova_clients where id=p_client_id and artist_business_id=p_artist_business_id;
  if not found then return jsonb_build_object('allowed',false,'reason','client_not_found'); end if;
  if p_purpose not in ('appointment_updates','rebooking_reminders','offers','review_requests','transactional') then return jsonb_build_object('allowed',false,'reason','purpose_invalid'); end if;
  if p_purpose <> 'transactional' then
    select granted into latest_consent from public.mova_client_consents where artist_business_id=p_artist_business_id and client_id=p_client_id and purpose=p_purpose and channel=p_channel order by changed_at desc,id desc limit 1;
    if not found or not latest_consent.granted or c.marketing_opted_out then return jsonb_build_object('allowed',false,'reason','consent_missing'); end if;
  end if;
  channel_address:=case p_channel when 'sms' then nullif(regexp_replace(c.phone_normalized,'[^0-9]','','g'),'') when 'email' then nullif(lower(btrim(c.email_normalized)),'') else null end;
  if p_channel='sms' and length(channel_address)=10 then channel_address:='1'||channel_address; end if;
  if channel_address is null and p_channel in ('sms','email') then return jsonb_build_object('allowed',false,'reason','contact_missing'); end if;
  if channel_address is not null then
    addr_hash:=encode(sha256(convert_to(channel_address,'UTF8')),'hex');
    if exists(select 1 from public.mova_suppressions s where s.channel=p_channel and s.address_hash=addr_hash and (s.artist_business_id=p_artist_business_id or s.artist_business_id is null)) then return jsonb_build_object('allowed',false,'reason','suppressed'); end if;
  end if;
  if p_purpose <> 'transactional' then
    select l.time_zone into client_time_zone from public.mova_appointments a join public.mova_locations l on l.id=a.location_id and l.artist_business_id=a.artist_business_id where a.client_id=p_client_id and a.artist_business_id=p_artist_business_id order by a.starts_at desc limit 1;
    if client_time_zone is null or not exists(select 1 from pg_timezone_names z where z.name=client_time_zone) then return jsonb_build_object('allowed',false,'reason','time_zone_unresolved'); end if;
    local_now:=p_now at time zone client_time_zone;
    if local_now::time < time '09:00' or local_now::time >= time '20:00' then return jsonb_build_object('allowed',false,'reason','quiet_hours'); end if;
  end if;
  return jsonb_build_object('allowed',true,'reason','eligible');
end $$;
revoke all on function public.mova_can_send(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mova_can_send(uuid,uuid,text,text,timestamptz) to service_role;

create or replace function public.mova_save_message_template_version(p_artist_business_id uuid,p_type text,p_locale text,p_body text)
returns public.mova_message_templates language plpgsql security definer set search_path=public,pg_temp as $$
declare current_row public.mova_message_templates%rowtype; saved public.mova_message_templates%rowtype; next_version integer;
begin
 if p_type not in ('rebooking_reminder','slot_offer','slot_taken','win_back','review_request','running_late','transactional_confirmation','transactional_change','transactional_request_outcome') or p_locale not in ('en-US','es-US') or length(trim(p_body)) not between 1 and 2000 then raise exception using errcode='22023',message='INVALID_TEMPLATE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_artist_business_id::text||':'||p_type||':'||p_locale,0));
 select * into current_row from public.mova_message_templates where artist_business_id=p_artist_business_id and type=p_type and locale=p_locale order by version desc limit 1 for update;
 next_version:=coalesce(current_row.version,0)+1;
 if current_row.id is not null and current_row.status='approved' then update public.mova_message_templates set status='paused' where id=current_row.id; end if;
 insert into public.mova_message_templates(artist_business_id,type,locale,body,version,status,source)
 values(p_artist_business_id,p_type,p_locale,trim(p_body),next_version,'needs_approval','artist_edit') returning * into saved;
 return saved;
end $$;
revoke all on function public.mova_save_message_template_version(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.mova_save_message_template_version(uuid,text,text,text) to service_role;

do $$ declare t text; begin
  foreach t in array array['mova_sending_identities','mova_message_templates','mova_messages','mova_suppressions','mova_notification_preferences','mova_notification_inbox','mova_push_subscriptions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
end $$;
create policy mova_sending_identities_member_select on public.mova_sending_identities for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_message_templates_member_select on public.mova_message_templates for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_messages_member_select on public.mova_messages for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_notification_preferences_owner_all on public.mova_notification_preferences for all to authenticated using(user_id=auth.uid() and public.mova_has_artist_membership(artist_business_id)) with check(user_id=auth.uid() and public.mova_has_artist_membership(artist_business_id));
create policy mova_notification_inbox_owner_all on public.mova_notification_inbox for all to authenticated using(user_id=auth.uid() and public.mova_has_artist_membership(artist_business_id)) with check(user_id=auth.uid() and public.mova_has_artist_membership(artist_business_id));

