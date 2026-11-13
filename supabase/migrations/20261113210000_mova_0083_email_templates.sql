-- Branded transactional email rollout context and stylist request notifications.
-- Proposed message delivery remains controlled by Edge Function flags (all false by default).

create or replace function public.mova_appointment_email_context(p_appointment_id uuid, p_event_type text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a public.mova_appointments%rowtype;
  loc public.mova_locations%rowtype;
  business_name text;
  template text;
begin
  select * into a from public.mova_appointments where id = p_appointment_id;
  if not found then return null; end if;
  select * into loc from public.mova_locations where id = a.location_id and artist_business_id = a.artist_business_id;
  select coalesce(p.display_name, b.name) into business_name from public.mova_artist_businesses b
    left join public.mova_artist_profiles p on p.artist_business_id = b.id where b.id = a.artist_business_id;
  template := case p_event_type
    when 'appointment.confirmed' then case when exists (
      select 1 from public.mova_appointment_events e where e.appointment_id = a.id and e.to_status = 'pending_artist'
    ) then 'request_accepted' else 'booking_confirmation' end
    when 'appointment.pending_artist' then 'request_received'
    when 'appointment.declined' then 'request_declined'
    when 'appointment.cancelled' then 'appointment_cancelled'
    when 'appointment.canceled' then 'appointment_cancelled'
    when 'appointment.rescheduled' then 'appointment_moved'
    when 'appointment.review_request' then 'review_request'
    when 'appointment.reminder' then case when a.status = 'confirmed' then 'appointment_reminder' else null end
    else null
  end;
  return jsonb_build_object(
    'template_id', template, 'artist_business_id', a.artist_business_id, 'client_id', a.client_id,
    'to', a.client_email, 'locale', a.client_locale, 'client_name', a.client_name,
    'business_name', coalesce(business_name, 'Mova'), 'service_name', a.service_name_snapshot,
    'starts_at', a.starts_at, 'time_zone', loc.time_zone, 'location_name', loc.name, 'status', a.status
  );
end $$;

create or replace function public.mova_appointment_stylist_email_context(p_appointment_id uuid)
returns jsonb language sql stable security definer set search_path = public, auth, pg_temp as $$
  select jsonb_build_object(
    'artist_business_id', a.artist_business_id,
    'locale', coalesce(a.client_locale, p.preferred_locale, 'en-US'),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object('email', u.email, 'name', coalesce(u.raw_user_meta_data->>'full_name', p.display_name, b.name)))
      from public.mova_artist_memberships m join auth.users u on u.id = m.user_id
      where m.artist_business_id = a.artist_business_id and m.status = 'active' and u.email is not null
    ), '[]'::jsonb),
    'vars', jsonb_build_object(
      'clientName', a.client_name, 'businessName', coalesce(p.display_name, b.name, 'Mova'),
      'serviceName', a.service_name_snapshot, 'startsAt', a.starts_at, 'timeZone', l.time_zone,
      'locationName', l.name
    )
  )
  from public.mova_appointments a
  join public.mova_artist_businesses b on b.id = a.artist_business_id
  left join public.mova_artist_profiles p on p.artist_business_id = b.id
  join public.mova_locations l on l.id = a.location_id
  where a.id = p_appointment_id;
$$;

create or replace function public.mova_stylist_welcome_email_context(p_artist_business_id uuid)
returns jsonb language sql stable security definer set search_path = public, auth, pg_temp as $$
  select jsonb_build_object(
    'artist_business_id', b.id,
    'locale', coalesce(p.preferred_locale, 'en-US'),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object('email', u.email, 'name', coalesce(u.raw_user_meta_data->>'full_name', p.display_name, b.name)))
      from public.mova_artist_memberships m join auth.users u on u.id = m.user_id
      where m.artist_business_id = b.id and m.status = 'active' and m.role in ('owner', 'admin') and u.email is not null
    ), '[]'::jsonb),
    'vars', jsonb_build_object('clientName', coalesce(p.display_name, b.name), 'businessName', coalesce(p.display_name, b.name, 'Mova'),
      'serviceName', 'Mova', 'startsAt', now(), 'timeZone', 'UTC', 'locationName', 'Mova',
      'bookingUrl', 'https://mova-beauty.co/onboarding/profile')
  )
  from public.mova_artist_businesses b join public.mova_artist_profiles p on p.artist_business_id = b.id
  where b.id = p_artist_business_id;
$$;

create or replace function public.mova_artist_welcome_outbox_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.mova_outbox_events(artist_business_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values(new.artist_business_id, 'artist', new.artist_business_id, 'artist.welcome', '{}', 'artist-welcome:' || new.artist_business_id::text)
  on conflict(idempotency_key) do nothing;
  return new;
end $$;
drop trigger if exists mova_artist_welcome_outbox on public.mova_artist_profiles;
create trigger mova_artist_welcome_outbox after insert on public.mova_artist_profiles
for each row execute function public.mova_artist_welcome_outbox_trigger();

revoke all on function public.mova_appointment_email_context(uuid, text) from public, anon, authenticated;
grant execute on function public.mova_appointment_email_context(uuid, text) to service_role;
revoke all on function public.mova_appointment_stylist_email_context(uuid) from public, anon, authenticated;
grant execute on function public.mova_appointment_stylist_email_context(uuid) to service_role;
revoke all on function public.mova_stylist_welcome_email_context(uuid) from public, anon, authenticated;
grant execute on function public.mova_stylist_welcome_email_context(uuid) to service_role;
revoke all on function public.mova_artist_welcome_outbox_trigger() from public, anon, authenticated;
