-- Task 4.4: SMS policy on top of mova_can_send (0013): a per-client daily cap for non-transactional
-- texts, a send gate that also resolves the recipient and sending identity, and STOP/START/HELP
-- keyword handling that records suppressions and consent changes. No provider is chosen (O4/O5).

-- One server-side setting: `alter database ... set mova.sms_daily_cap = '2'` changes it. Default 1.
create or replace function public.mova_sms_daily_cap() returns integer
language sql stable set search_path = public, pg_temp as $$
  select greatest(0, coalesce(nullif(current_setting('mova.sms_daily_cap', true), '')::integer, 1));
$$;
revoke all on function public.mova_sms_daily_cap() from public, anon, authenticated;
grant execute on function public.mova_sms_daily_cap() to service_role;

create or replace function public.mova_sms_normalize(p_phone text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) = 10 then '1' || regexp_replace(p_phone, '[^0-9]', '', 'g')
    else nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '')
  end;
$$;
revoke all on function public.mova_sms_normalize(text) from public, anon, authenticated;
grant execute on function public.mova_sms_normalize(text) to service_role;

create index if not exists mova_messages_client_sms_recent_idx
  on public.mova_messages (artist_business_id, client_id, created_at desc)
  where direction = 'outbound' and channel = 'sms';

-- Returns {allowed, reason, to, from, locale}. Transactional texts skip consent, quiet hours and the cap
-- (mova_can_send already skips the first two); STOP suppressions always apply.
create or replace function public.mova_sms_send_gate(p_artist_business_id uuid, p_client_id uuid, p_purpose text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare gate jsonb; sent_count integer; client_row public.mova_clients%rowtype; sender text;
begin
  gate := public.mova_can_send(p_artist_business_id, p_client_id, 'sms', p_purpose, p_now);
  if not coalesce((gate->>'allowed')::boolean, false) then return gate; end if;
  select * into client_row from public.mova_clients where id = p_client_id and artist_business_id = p_artist_business_id;
  select address into sender from public.mova_sending_identities
    where artist_business_id = p_artist_business_id and channel = 'sms' and status = 'active' order by created_at limit 1;
  if sender is null then return jsonb_build_object('allowed', false, 'reason', 'no_sending_identity'); end if;
  if p_purpose <> 'transactional' then
    select count(*)::integer into sent_count from public.mova_messages m
      where m.artist_business_id = p_artist_business_id and m.client_id = p_client_id
        and m.direction = 'outbound' and m.channel = 'sms' and m.origin <> 'transactional'
        and m.status in ('queued', 'sent', 'delivered') and m.created_at > p_now - interval '24 hours';
    if sent_count >= public.mova_sms_daily_cap() then return jsonb_build_object('allowed', false, 'reason', 'daily_cap'); end if;
  end if;
  return jsonb_build_object('allowed', true, 'reason', 'eligible',
    'to', '+' || public.mova_sms_normalize(client_row.phone_normalized), 'from', sender, 'locale', client_row.preferred_locale);
end $$;
revoke all on function public.mova_sms_send_gate(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mova_sms_send_gate(uuid, uuid, text, timestamptz) to service_role;

-- Records an inbound text to a stylist's sending identity and applies a carrier keyword.
-- STOP: suppression for that number in that business, plus a revoked SMS consent row for every purpose
--       for each matching client (evidence names the keyword). START: removes the STOP suppression only;
--       consent is not re-granted (the client must opt in again for marketing). HELP: logged only.
create or replace function public.mova_sms_handle_inbound(p_to text, p_from text, p_text text, p_keyword text, p_provider text, p_provider_message_id text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare identity_row record; from_norm text; addr_hash text; matched record; matched_ids uuid[] := '{}'; reply_locale text := 'en-US'; business_name text; result jsonb := '[]'::jsonb; purpose text;
begin
  if p_keyword is not null and p_keyword not in ('stop', 'start', 'help') then raise exception using errcode = '22023', message = 'KEYWORD_INVALID'; end if;
  from_norm := public.mova_sms_normalize(p_from);
  if from_norm is null then raise exception using errcode = '22023', message = 'FROM_INVALID'; end if;
  addr_hash := encode(sha256(convert_to(from_norm, 'UTF8')), 'hex');
  for identity_row in
    select distinct si.artist_business_id from public.mova_sending_identities si
    where si.channel = 'sms' and si.status = 'active' and public.mova_sms_normalize(si.address) = public.mova_sms_normalize(p_to)
  loop
    matched_ids := '{}'; reply_locale := 'en-US';
    for matched in select c.id, c.preferred_locale from public.mova_clients c
      where c.artist_business_id = identity_row.artist_business_id and public.mova_sms_normalize(c.phone_normalized) = from_norm
    loop
      matched_ids := matched_ids || matched.id; reply_locale := matched.preferred_locale;
    end loop;
    insert into public.mova_messages(artist_business_id, client_id, direction, channel, purpose, provider, origin, body, status, provider_message_id, idempotency_key, created_at)
    values (identity_row.artist_business_id, matched_ids[1], 'inbound', 'sms', coalesce('keyword_' || p_keyword, 'inbound'), p_provider, 'transactional', left(coalesce(p_text, ''), 1600), 'received',
      p_provider_message_id, 'inbound:' || coalesce(p_provider, 'unknown') || ':' || coalesce(p_provider_message_id, md5(from_norm || coalesce(p_text, '') || p_now::text)), p_now)
    on conflict do nothing;
    if p_keyword = 'stop' then
      insert into public.mova_suppressions(artist_business_id, channel, address_hash, reason)
      values (identity_row.artist_business_id, 'sms', addr_hash, 'stop') on conflict do nothing;
      foreach purpose in array array['appointment_updates', 'rebooking_reminders', 'offers', 'review_requests'] loop
        insert into public.mova_client_consents(artist_business_id, client_id, purpose, channel, granted, locale, evidence, changed_at)
        select identity_row.artist_business_id, c.id, purpose, 'sms', false, c.preferred_locale,
          jsonb_build_object('source', 'sms_keyword', 'keyword', 'stop', 'provider', p_provider, 'provider_message_id', p_provider_message_id), p_now
        from public.mova_clients c where c.id = any(matched_ids);
      end loop;
    elsif p_keyword = 'start' then
      delete from public.mova_suppressions where artist_business_id = identity_row.artist_business_id and channel = 'sms' and address_hash = addr_hash and reason = 'stop';
    end if;
    select coalesce(p.display_name, b.name) into business_name from public.mova_artist_businesses b
      left join public.mova_artist_profiles p on p.artist_business_id = b.id where b.id = identity_row.artist_business_id;
    result := result || jsonb_build_object('artist_business_id', identity_row.artist_business_id, 'client_ids', to_jsonb(matched_ids),
      'locale', reply_locale, 'business_name', coalesce(business_name, 'Mova'));
  end loop;
  return jsonb_build_object('keyword', p_keyword, 'businesses', result);
end $$;
revoke all on function public.mova_sms_handle_inbound(text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mova_sms_handle_inbound(text, text, text, text, text, text, timestamptz) to service_role;

-- Missed-call text-back gate. Returns one row per business that owns the called number, with whether a
-- text-back may go out: the concierge missed_call channel must be on, the caller must not have sent STOP,
-- it must be outside quiet hours at the business's first location, and only one text-back per caller per
-- 24 hours. Opens (or reuses) a missed_call conversation so the stylist sees it in the inbox.
create or replace function public.mova_missed_call_gate(p_to text, p_from text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare identity_row record; from_norm text; addr_hash text; settings_row public.mova_concierge_settings%rowtype; tz text; conv_id uuid; reason text; out jsonb := '[]'::jsonb; handle_value text; name_value text; locale_value text; client_value uuid;
begin
  from_norm := public.mova_sms_normalize(p_from);
  if from_norm is null then raise exception using errcode = '22023', message = 'FROM_INVALID'; end if;
  addr_hash := encode(sha256(convert_to(from_norm, 'UTF8')), 'hex');
  for identity_row in
    select si.artist_business_id, si.address from public.mova_sending_identities si
    where si.channel = 'sms' and si.status = 'active' and public.mova_sms_normalize(si.address) = public.mova_sms_normalize(p_to)
  loop
    reason := 'eligible';
    select * into settings_row from public.mova_concierge_settings where artist_business_id = identity_row.artist_business_id;
    select time_zone into tz from public.mova_locations where artist_business_id = identity_row.artist_business_id and is_active order by created_at limit 1;
    select c.id, c.preferred_locale into client_value, locale_value from public.mova_clients c
      where c.artist_business_id = identity_row.artist_business_id and public.mova_sms_normalize(c.phone_normalized) = from_norm limit 1;
    select p.handle, p.display_name into handle_value, name_value from public.mova_artist_profiles p where p.artist_business_id = identity_row.artist_business_id;
    insert into public.mova_conversations(artist_business_id, channel, external_thread_id, client_id, contact_hash, locale, status, last_message_at)
    values (identity_row.artist_business_id, 'missed_call', addr_hash, client_value, addr_hash, coalesce(locale_value, 'en-US'), 'needs_you', p_now)
    on conflict (artist_business_id, channel, external_thread_id) do update set last_message_at = excluded.last_message_at, status = 'needs_you'
    returning id into conv_id;
    if settings_row.artist_business_id is null or not coalesce((settings_row.channels->>'missed_call')::boolean, false) then reason := 'disabled';
    elsif exists (select 1 from public.mova_suppressions s where s.channel = 'sms' and s.address_hash = addr_hash
      and (s.artist_business_id = identity_row.artist_business_id or s.artist_business_id is null)) then reason := 'suppressed';
    elsif tz is null then reason := 'time_zone_unresolved';
    elsif (p_now at time zone tz)::time < time '09:00' or (p_now at time zone tz)::time >= time '20:00' then reason := 'quiet_hours';
    elsif exists (select 1 from public.mova_messages m where m.conversation_id = conv_id and m.direction = 'outbound'
      and m.purpose = 'missed_call_textback' and m.status in ('queued', 'sent', 'delivered') and m.created_at > p_now - interval '24 hours') then reason := 'already_texted';
    end if;
    out := out || jsonb_build_object('artist_business_id', identity_row.artist_business_id, 'allowed', reason = 'eligible', 'reason', reason,
      'conversation_id', conv_id, 'client_id', client_value, 'locale', coalesce(locale_value, 'en-US'), 'from', identity_row.address,
      'to', '+' || from_norm, 'handle', handle_value, 'business_name', coalesce(name_value, 'Mova'));
  end loop;
  return jsonb_build_object('businesses', out);
end $$;
revoke all on function public.mova_missed_call_gate(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mova_missed_call_gate(text, text, timestamptz) to service_role;
