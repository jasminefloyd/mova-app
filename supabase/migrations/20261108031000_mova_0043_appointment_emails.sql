-- Task 4.3: transactional appointment emails through the email adapter (fake until O4).

-- Suppressions (bounce, complaint, manual) for one address, in this business or platform-wide.
create or replace function public.mova_email_send_gate(p_artist_business_id uuid, p_email text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare addr text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if addr is null then return jsonb_build_object('allowed', false, 'reason', 'contact_missing'); end if;
  if exists (select 1 from public.mova_suppressions s where s.channel = 'email'
      and s.address_hash = encode(sha256(convert_to(addr, 'UTF8')), 'hex')
      and (s.artist_business_id = p_artist_business_id or s.artist_business_id is null)) then
    return jsonb_build_object('allowed', false, 'reason', 'suppressed');
  end if;
  return jsonb_build_object('allowed', true, 'reason', 'eligible');
end $$;
revoke all on function public.mova_email_send_gate(uuid, text) from public, anon, authenticated;
grant execute on function public.mova_email_send_gate(uuid, text) to service_role;

-- Everything an appointment email needs, and which template an event maps to (null = no email).
create or replace function public.mova_appointment_email_context(p_appointment_id uuid, p_event_type text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.mova_appointments%rowtype; loc public.mova_locations%rowtype; business_name text; template text;
begin
  select * into a from public.mova_appointments where id = p_appointment_id;
  if not found then return null; end if;
  select * into loc from public.mova_locations where id = a.location_id and artist_business_id = a.artist_business_id;
  select coalesce(p.display_name, b.name) into business_name from public.mova_artist_businesses b
    left join public.mova_artist_profiles p on p.artist_business_id = b.id where b.id = a.artist_business_id;
  template := case p_event_type
    when 'appointment.confirmed' then case when exists (select 1 from public.mova_appointment_events e where e.appointment_id = a.id and e.to_status = 'pending_artist')
      then 'request_accepted' else 'booking_confirmation' end
    when 'appointment.pending_artist' then 'request_received'
    when 'appointment.declined' then 'request_declined'
    when 'appointment.reminder' then case when a.status = 'confirmed' then 'appointment_reminder' else null end
    else null end;
  return jsonb_build_object('template_id', template, 'artist_business_id', a.artist_business_id, 'client_id', a.client_id,
    'to', a.client_email, 'locale', a.client_locale, 'client_name', a.client_name, 'business_name', coalesce(business_name, 'Mova'),
    'service_name', a.service_name_snapshot, 'starts_at', a.starts_at, 'time_zone', loc.time_zone, 'location_name', loc.name, 'status', a.status);
end $$;
revoke all on function public.mova_appointment_email_context(uuid, text) from public, anon, authenticated;
grant execute on function public.mova_appointment_email_context(uuid, text) to service_role;

-- Queues one reminder job per confirmed appointment starting 23–25 hours from now (idempotent).
create or replace function public.mova_enqueue_appointment_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare queued integer;
begin
  insert into public.mova_background_jobs(job_type, artist_business_id, payload, idempotency_key)
  select 'appointment_reminder', a.artist_business_id, jsonb_build_object('appointment_id', a.id), 'reminder:' || a.id::text || ':' || to_char(a.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI')
  from public.mova_appointments a
  where a.status = 'confirmed' and a.client_email is not null
    and a.starts_at >= p_now + interval '23 hours' and a.starts_at < p_now + interval '25 hours'
  on conflict (idempotency_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end $$;
revoke all on function public.mova_enqueue_appointment_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.mova_enqueue_appointment_reminders(timestamptz) to service_role;
