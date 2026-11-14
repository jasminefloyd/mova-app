-- Rooted Beauty production demo fixture.
-- All client details are synthetic and use reserved example.invalid / 555-01xx values.
-- Demo reviews are synthetic, private, and never enabled for public display. No sensitive notes, photos, payment data, outbound messages, Google reviews, or public manage tokens are seeded.
do $rooted_beauty_seed$
declare
  demo_user_id uuid;
  business_id constant uuid := 'e2500000-0000-4000-8000-000000000001';
  studio_id constant uuid := 'e2500000-0000-4000-8000-000000000101';
  salon_id constant uuid := 'e2500000-0000-4000-8000-000000000102';
  service_silk constant uuid := 'e2500000-0000-4000-8000-000000000201';
  service_hydration constant uuid := 'e2500000-0000-4000-8000-000000000202';
  service_consult constant uuid := 'e2500000-0000-4000-8000-000000000203';
  client_1 constant uuid := 'e2500000-0000-4000-8000-000000000301';
  client_2 constant uuid := 'e2500000-0000-4000-8000-000000000302';
  client_3 constant uuid := 'e2500000-0000-4000-8000-000000000303';
  client_4 constant uuid := 'e2500000-0000-4000-8000-000000000304';
  client_5 constant uuid := 'e2500000-0000-4000-8000-000000000305';
  appointment_row record;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at)
  values ('e2500000-0000-4000-8000-000000000099', 'authenticated', 'authenticated', 'jasmine@demo.com', now())
  on conflict (id) do nothing;

  select id into strict demo_user_id
  from auth.users
  where lower(email) = 'jasmine@demo.com'
    and email_confirmed_at is not null
    and deleted_at is null;

  if exists (
    select 1 from public.mova_artist_profiles
    where lower(handle) = 'rooted-beauty'
      and artist_business_id <> business_id
  ) then
    raise exception 'The rooted-beauty handle is already assigned to another business';
  end if;

  if exists (
    select 1 from public.mova_artist_businesses
    where id = business_id and name <> 'Rooted Beauty'
  ) then
    raise exception 'The deterministic Rooted Beauty business ID is already in use';
  end if;

  insert into public.mova_artist_businesses (id, name, status)
  values (business_id, 'Rooted Beauty', 'active')
  on conflict (id) do nothing;

  insert into public.mova_artist_memberships (artist_business_id, user_id, role, status)
  values (business_id, demo_user_id, 'owner', 'active')
  on conflict (artist_business_id, user_id) do nothing;

  insert into public.mova_artist_profiles (
    id, artist_business_id, display_name, handle, specialties, bio,
    preferred_locale, is_published, published_at, search_index_enabled
  ) values (
    'e2500000-0000-4000-8000-000000000002', business_id, 'Rooted Beauty',
    'rooted-beauty', array['Natural hair', 'Protective styling'],
    'Demo profile for internal product evaluation. All client records and appointments are fictional.',
    -- Published so local and CI E2E runs can reach the public pages (task 2.8); search indexing stays off.
    'en-US', true, now(), false
  ) on conflict (artist_business_id) do nothing;

  insert into public.mova_onboarding_progress (
    artist_business_id, current_step, completed_steps,
    form_data
  ) values (
    business_id, 'complete', array['profile', 'photo', 'services', 'location'],
    jsonb_build_object('demo_fixture', true)
  ) on conflict (artist_business_id) do nothing;

  insert into public.mova_locations (
    id, artist_business_id, name, location_type, booking_mode,
    calendar_ownership, payment_collector, time_zone, address,
    display_color_index, is_active
  ) values
    (studio_id, business_id, 'Rooted Beauty Studio', 'suite', 'instant', 'mova', 'artist', 'America/New_York', '{}'::jsonb, 2, true),
    (salon_id, business_id, 'Rooted Beauty Salon', 'commission_salon', 'request', 'mova', 'salon', 'America/New_York', '{}'::jsonb, 6, true)
  on conflict (id) do nothing;

  insert into public.mova_location_hours (
    id, artist_business_id, location_id, weekday, opens_at, closes_at
  )
  select
    ('e2500000-0000-4000-8000-' || lpad((1100 + location_number * 10 + day_number)::text, 12, '0'))::uuid,
    business_id, location_id, day_number, time '09:00', time '17:00'
  from (values (1, studio_id), (2, salon_id)) as locations(location_number, location_id)
  cross join generate_series(0, 6) as days(day_number)
  on conflict (id) do nothing;

  insert into public.mova_location_policies (
    location_id, artist_business_id, lead_time_minutes,
    booking_horizon_days, buffer_before_minutes, buffer_after_minutes,
    cancellation_window_minutes, request_expiry_hours
  ) values
    (studio_id, business_id, 60, 60, 10, 10, 1440, 24),
    (salon_id, business_id, 120, 60, 15, 15, 1440, 48)
  on conflict (location_id) do nothing;

  insert into public.mova_services (
    id, artist_business_id, name, category, duration_minutes,
    buffer_minutes, base_price_minor, status, deposit_type, deposit_value
  ) values
    (service_silk, business_id, 'Silk Press', 'Styling', 90, 15, 12000, 'active', 'none', 0),
    (service_hydration, business_id, 'Hydration Treatment', 'Treatment', 60, 10, 8000, 'active', 'fixed', 2000),
    (service_consult, business_id, 'Protective Style Consultation', 'Consultation', 30, 0, 2500, 'active', 'percent', 2500)
  on conflict (id) do nothing;

  insert into public.mova_service_locations (id, artist_business_id, service_id, location_id)
  select
    ('e2500000-0000-4000-8000-' || lpad((1200 + service_number * 10 + location_number)::text, 12, '0'))::uuid,
    business_id, service_id, location_id
  from (values
    (1, service_silk), (2, service_hydration), (3, service_consult)
  ) as services(service_number, service_id)
  cross join (values (1, studio_id), (2, salon_id)) as locations(location_number, location_id)
  on conflict (service_id, location_id) do nothing;

  insert into public.mova_clients (
    id, artist_business_id, display_name, email, email_normalized,
    phone, phone_normalized, preferred_locale, source,
    marketing_opted_out, created_by
  ) values
    (client_1, business_id, 'Demo Guest 01', 'demo-client-01@example.invalid', 'demo-client-01@example.invalid', '+1-202-555-0101', '+12025550101', 'en-US', 'manual', false, demo_user_id),
    (client_2, business_id, 'Demo Guest 02', 'demo-client-02@example.invalid', 'demo-client-02@example.invalid', '+1-202-555-0102', '+12025550102', 'en-US', 'booking', false, demo_user_id),
    (client_3, business_id, 'Demo Guest 03', 'demo-client-03@example.invalid', 'demo-client-03@example.invalid', '+1-202-555-0103', '+12025550103', 'es-US', 'booking', false, demo_user_id),
    (client_4, business_id, 'Demo Guest 04', 'demo-client-04@example.invalid', 'demo-client-04@example.invalid', '+1-202-555-0104', '+12025550104', 'en-US', 'import', false, demo_user_id),
    (client_5, business_id, 'Demo Guest 05', 'demo-client-05@example.invalid', 'demo-client-05@example.invalid', '+1-202-555-0105', '+12025550105', 'es-US', 'manual', true, demo_user_id)
  on conflict (id) do nothing;

  insert into public.mova_client_consents (
    id, artist_business_id, client_id, purpose, channel, granted,
    locale, evidence, changed_by
  ) values
    ('e2500000-0000-4000-8000-000000000801', business_id, client_1, 'appointment_updates', 'sms', true, 'en-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000802', business_id, client_1, 'offers', 'email', false, 'en-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000803', business_id, client_2, 'appointment_updates', 'sms', true, 'en-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000804', business_id, client_2, 'rebooking_reminders', 'email', true, 'en-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000805', business_id, client_2, 'offers', 'email', true, 'en-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000806', business_id, client_3, 'appointment_updates', 'email', true, 'es-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000807', business_id, client_3, 'rebooking_reminders', 'sms', false, 'es-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000808', business_id, client_3, 'offers', 'email', false, 'es-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000809', business_id, client_4, 'appointment_updates', 'sms', true, 'en-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000810', business_id, client_4, 'rebooking_reminders', 'email', true, 'en-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000811', business_id, client_4, 'offers', 'email', false, 'en-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000812', business_id, client_5, 'appointment_updates', 'sms', false, 'es-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000813', business_id, client_5, 'rebooking_reminders', 'email', false, 'es-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id),
    ('e2500000-0000-4000-8000-000000000814', business_id, client_5, 'offers', 'email', false, 'es-US', '{"source":"demo_fixture"}'::jsonb, demo_user_id)
  on conflict (id) do nothing;

  for appointment_row in
    select * from (values
      ('e2500000-0000-4000-8000-000000000401'::uuid, client_2, service_silk, studio_id, 'completed', 3, time '10:00', 12000, 0, null::text),
      ('e2500000-0000-4000-8000-000000000402'::uuid, client_3, service_hydration, studio_id, 'completed', 5, time '10:00', 8000, 2000, null::text),
      ('e2500000-0000-4000-8000-000000000403'::uuid, client_3, service_consult, salon_id, 'completed', 12, time '13:00', 2500, 625, null::text),
      ('e2500000-0000-4000-8000-000000000404'::uuid, client_4, service_silk, studio_id, 'completed', 7, time '10:00', 12000, 0, null::text),
      ('e2500000-0000-4000-8000-000000000405'::uuid, client_4, service_hydration, salon_id, 'completed', 9, time '13:00', 8000, 2000, null::text),
      ('e2500000-0000-4000-8000-000000000406'::uuid, client_4, service_silk, studio_id, 'completed', 14, time '10:00', 12000, 0, null::text),
      ('e2500000-0000-4000-8000-000000000407'::uuid, client_4, service_consult, salon_id, 'completed', 16, time '13:00', 2500, 625, null::text),
      ('e2500000-0000-4000-8000-000000000408'::uuid, client_5, service_hydration, studio_id, 'completed', 11, time '10:00', 8000, 2000, null::text),
      ('e2500000-0000-4000-8000-000000000409'::uuid, client_2, service_silk, studio_id, 'confirmed', -5, time '11:00', 12000, 0, null::text),
      ('e2500000-0000-4000-8000-000000000410'::uuid, client_3, service_hydration, salon_id, 'pending_artist', -7, time '13:00', 8000, 2000, null::text),
      ('e2500000-0000-4000-8000-000000000411'::uuid, client_4, service_consult, studio_id, 'cancelled', 20, time '10:00', 2500, 0, 'demo_cancellation'),
      ('e2500000-0000-4000-8000-000000000412'::uuid, client_5, service_silk, salon_id, 'no_show', 22, time '13:00', 12000, 0, null::text),
      ('e2500000-0000-4000-8000-000000000413'::uuid, client_2, service_silk, studio_id, 'completed', 0, time '09:30', 12000, 0, null::text),
      ('e2500000-0000-4000-8000-000000000414'::uuid, client_3, service_hydration, studio_id, 'completed', 0, time '13:00', 8000, 2000, null::text),
      ('e2500000-0000-4000-8000-000000000415'::uuid, client_4, service_consult, salon_id, 'completed', 0, time '16:00', 2500, 625, null::text),
      ('e2500000-0000-4000-8000-000000000416'::uuid, client_2, service_silk, studio_id, 'confirmed', -1, time '09:30', 12000, 0, null::text),
      ('e2500000-0000-4000-8000-000000000417'::uuid, client_3, service_hydration, salon_id, 'confirmed', -1, time '11:30', 8000, 2000, null::text),
      ('e2500000-0000-4000-8000-000000000418'::uuid, client_4, service_consult, studio_id, 'confirmed', -1, time '14:30', 2500, 625, null::text),
      ('e2500000-0000-4000-8000-000000000419'::uuid, client_1, service_silk, salon_id, 'pending_artist', -2, time '10:00', 12000, 0, null::text),
      ('e2500000-0000-4000-8000-000000000420'::uuid, client_3, service_hydration, salon_id, 'pending_artist', -4, time '13:00', 8000, 2000, null::text),
      ('e2500000-0000-4000-8000-000000000421'::uuid, client_5, service_consult, salon_id, 'pending_artist', -6, time '10:00', 2500, 0, null::text)
    ) as appointments(id, client_id, service_id, location_id, status, day_offset, local_start, price_minor, deposit_minor, cancellation_reason)
  loop
    insert into public.mova_appointments (
      id, artist_business_id, location_id, service_id, client_id, source,
      status, starts_at, ends_at, buffer_after_minutes,
      service_name_snapshot, service_price_minor, deposit_due_minor,
      balance_due_minor, client_name, client_email, client_phone,
      client_locale, request_expires_at, manage_token_hash, idempotency_key,
      cancellation_reason, confirmed_at, cancelled_at
    )
    select
      appointment_row.id, business_id, appointment_row.location_id,
      appointment_row.service_id, appointment_row.client_id, 'showcase',
      appointment_row.status,
      local_start.local_starts_at,
      local_start.local_starts_at + make_interval(mins => service.duration_minutes),
      service.buffer_minutes,
      service.name, appointment_row.price_minor, appointment_row.deposit_minor,
      appointment_row.price_minor - appointment_row.deposit_minor,
      client.display_name, client.email, client.phone, client.preferred_locale,
      case when appointment_row.status = 'pending_artist' then least(now() + interval '48 hours', local_start.local_starts_at - interval '2 hours') else null end,
      decode(md5('rooted-beauty-demo:' || appointment_row.id::text) || md5('rooted-beauty-demo-2:' || appointment_row.id::text), 'hex'),
      'rooted-beauty-demo:' || appointment_row.id::text,
      appointment_row.cancellation_reason,
      case when appointment_row.status in ('completed', 'confirmed', 'no_show') then local_start.local_starts_at - interval '1 day' else null end,
      case when appointment_row.status = 'cancelled' then local_start.local_starts_at - interval '2 days' else null end
    from public.mova_services as service
    join public.mova_clients as client on client.id = appointment_row.client_id
    cross join lateral (
      select (date_trunc('day', now() at time zone 'America/New_York')
        - make_interval(days => appointment_row.day_offset)
        + appointment_row.local_start) at time zone 'America/New_York' as local_starts_at
    ) as local_start
    where service.id = appointment_row.service_id
    on conflict (id) do nothing;

    insert into public.mova_appointment_events (
      id, artist_business_id, appointment_id, from_status, to_status,
      actor_type, actor_id, reason, idempotency_key
    ) values (
      ('e2500000-0000-4000-8000-' || lpad((1300 + (right(appointment_row.id::text, 2))::integer)::text, 12, '0'))::uuid,
      business_id, appointment_row.id, null, appointment_row.status,
      'artist', demo_user_id, 'demo_seed_initial_state',
      'rooted-beauty-demo-event:' || appointment_row.id::text
    ) on conflict (appointment_id, idempotency_key) do nothing;
  end loop;

  insert into public.mova_availability_blocks (
    id, artist_business_id, location_id, starts_at, ends_at, reason
  ) values (
    'e2500000-0000-4000-8000-000000000422', business_id, studio_id,
    (date_trunc('day', now() at time zone 'America/New_York') + time '12:00') at time zone 'America/New_York',
    (date_trunc('day', now() at time zone 'America/New_York') + time '12:45') at time zone 'America/New_York',
    'Personal break'
  ) on conflict (id) do nothing;

  insert into public.mova_client_notes (
    id, artist_business_id, client_id, category, body,
    is_sensitive, is_pinned, show_next_visit, next_appointment_id, created_by
  ) values (
    'e2500000-0000-4000-8000-000000000701', business_id, client_2,
    'preferences', 'Prefers low-heat styling around the ends; avoid relaxer services.',
    false, false, true, null, demo_user_id
  ) on conflict (id) do nothing;

  insert into public.mova_visit_notes (
    id, artist_business_id, client_id, appointment_id, what_was_done,
    products_settings, for_next_time, show_next_visit, next_appointment_id, created_by
  ) values (
    'e2500000-0000-4000-8000-000000000702', business_id, client_2,
    'e2500000-0000-4000-8000-000000000413', 'Completed a silk press.',
    '[]'::jsonb, 'Ends felt dry after the last silk press; add a deep-conditioning step.',
    true, null, demo_user_id
  ) on conflict (appointment_id) do nothing;

  insert into public.mova_client_notes (
    id, artist_business_id, client_id, category, body,
    is_sensitive, is_pinned, show_next_visit, next_appointment_id, created_by
  ) values
    ('e2500000-0000-4000-8000-000000000710', business_id, client_4, 'hair', 'Natural curl pattern; keep ends protected.', false, false, false, null, demo_user_id),
    ('e2500000-0000-4000-8000-000000000711', business_id, client_4, 'color', 'Natural color; no prior color service noted.', false, false, false, null, demo_user_id),
    ('e2500000-0000-4000-8000-000000000712', business_id, client_4, 'products', 'Prefers lightweight, sulfate-free products.', false, false, false, null, demo_user_id),
    ('e2500000-0000-4000-8000-000000000713', business_id, client_4, 'preferences', 'Prefers a quiet appointment when possible.', false, false, false, null, demo_user_id),
    ('e2500000-0000-4000-8000-000000000714', business_id, client_4, 'personal', 'No personal details shared.', false, false, false, null, demo_user_id)
  on conflict (id) do update set category=excluded.category, body=excluded.body, is_pinned=excluded.is_pinned, show_next_visit=excluded.show_next_visit;

  insert into public.mova_client_notes (
    id, artist_business_id, client_id, category, body,
    is_sensitive, is_pinned, show_next_visit, next_appointment_id, created_by
  ) values (
    'e2500000-0000-4000-8000-000000000715', business_id, client_4,
    'preferences', 'No relaxers or harsh lighteners.',
    false, true, false, null, demo_user_id
  ) on conflict (id) do update set body=excluded.body, category=excluded.category, is_pinned=excluded.is_pinned;

  insert into public.mova_client_notes (
    id, artist_business_id, client_id, category, body,
    is_sensitive, is_pinned, show_next_visit, next_appointment_id, created_by
  ) values (
    'e2500000-0000-4000-8000-000000000716', business_id, client_4,
    'preferences', 'Max 400°F; keep heat low on the ends.',
    false, true, false, null, demo_user_id
  ) on conflict (id) do update set body=excluded.body, category=excluded.category, is_pinned=excluded.is_pinned;

  insert into public.mova_visit_notes (
    id, artist_business_id, client_id, appointment_id, what_was_done,
    products_settings, for_next_time, show_next_visit, next_appointment_id, created_by
  ) values
    ('e2500000-0000-4000-8000-000000000720', business_id, client_4, 'e2500000-0000-4000-8000-000000000404', 'Silk press completed; lightly dusted the ends.', '["Heat protectant", "Silk serum"]'::jsonb, '', false, null, demo_user_id),
    ('e2500000-0000-4000-8000-000000000721', business_id, client_4, 'e2500000-0000-4000-8000-000000000405', 'Hydration treatment completed.', '["Deep conditioner"]'::jsonb, 'Check moisture retention at the next visit.', false, null, demo_user_id),
    ('e2500000-0000-4000-8000-000000000722', business_id, client_4, 'e2500000-0000-4000-8000-000000000406', 'Silk press completed with two low-heat passes.', '["Heat protectant"]'::jsonb, '', false, null, demo_user_id),
    ('e2500000-0000-4000-8000-000000000723', business_id, client_4, 'e2500000-0000-4000-8000-000000000415', 'Discussed protective styling options and care.', '[]'::jsonb, 'Bring reference photos for the next appointment.', true, null, demo_user_id)
  on conflict (appointment_id) do nothing;

  -- P14: synthetic review fixtures linked only to completed demo appointments.
  -- They are private even when marked approved; public review display stays off.
  insert into public.mova_review_settings (artist_business_id, ask_after_visit, google_review_url)
  values (business_id, false, null)
  on conflict (artist_business_id) do nothing;

  insert into public.mova_review_requests (
    id, artist_business_id, appointment_id, token_hash, status,
    expires_at, created_at, sent_at, used_at
  ) values
    ('e2500000-0000-4000-8000-000000000901', business_id, 'e2500000-0000-4000-8000-000000000401', decode(md5('rooted-demo-review:901') || md5('rooted-demo-review-2:901'), 'hex'), 'used', now() + interval '12 days', now() - interval '2 days', null, now() - interval '1 day'),
    ('e2500000-0000-4000-8000-000000000902', business_id, 'e2500000-0000-4000-8000-000000000402', decode(md5('rooted-demo-review:902') || md5('rooted-demo-review-2:902'), 'hex'), 'used', now() + interval '11 days', now() - interval '3 days', null, now() - interval '2 days'),
    ('e2500000-0000-4000-8000-000000000903', business_id, 'e2500000-0000-4000-8000-000000000404', decode(md5('rooted-demo-review:903') || md5('rooted-demo-review-2:903'), 'hex'), 'used', now() + interval '10 days', now() - interval '4 days', null, now() - interval '3 days'),
    ('e2500000-0000-4000-8000-000000000904', business_id, 'e2500000-0000-4000-8000-000000000405', decode(md5('rooted-demo-review:904') || md5('rooted-demo-review-2:904'), 'hex'), 'used', now() + interval '9 days', now() - interval '5 days', null, now() - interval '4 days'),
    ('e2500000-0000-4000-8000-000000000905', business_id, 'e2500000-0000-4000-8000-000000000406', decode(md5('rooted-demo-review:905') || md5('rooted-demo-review-2:905'), 'hex'), 'used', now() + interval '5 days', now() - interval '9 days', null, now() - interval '8 days')
  on conflict do nothing;

  insert into public.mova_reviews (
    id, artist_business_id, appointment_id, request_id, rating, tags,
    body, display_name, locale, moderation_status, public_display_enabled,
    artist_reply, artist_replied_at, created_at, updated_at
  )
  select sample.review_id, business_id, sample.appointment_id, sample.request_id,
    sample.rating, sample.tags, sample.body, sample.display_name, sample.locale,
    sample.moderation_status, false, sample.artist_reply,
    case when sample.artist_reply is null then null else sample.created_at + interval '1 day' end,
    sample.created_at, sample.created_at
  from (values
    ('e2500000-0000-4000-8000-000000000911'::uuid, 'e2500000-0000-4000-8000-000000000901'::uuid, 'e2500000-0000-4000-8000-000000000401'::uuid, 5, array['great_results','listened_to_me']::text[], 'She listened to what I wanted and the silk press came out smooth.', 'Demo Guest 02', 'en-US', 'approved', 'Thank you for coming in. I’m glad you love the result!', now() - interval '1 day'),
    ('e2500000-0000-4000-8000-000000000912'::uuid, 'e2500000-0000-4000-8000-000000000902'::uuid, 'e2500000-0000-4000-8000-000000000402'::uuid, 5, array['on_time','clean_space']::text[], 'Me explicó cada paso y mi cabello quedó muy hidratado.', 'Demo Guest 03', 'es-US', 'approved', null::text, now() - interval '2 days'),
    ('e2500000-0000-4000-8000-000000000913'::uuid, 'e2500000-0000-4000-8000-000000000903'::uuid, 'e2500000-0000-4000-8000-000000000404'::uuid, 4, array['great_results']::text[], 'A thoughtful appointment and a beautiful finish.', 'Demo Guest 04', 'en-US', 'approved', null::text, now() - interval '3 days'),
    ('e2500000-0000-4000-8000-000000000914'::uuid, 'e2500000-0000-4000-8000-000000000904'::uuid, 'e2500000-0000-4000-8000-000000000405'::uuid, 5, array['listened_to_me','healthy_hair']::text[], 'The hydration treatment left my hair feeling soft.', 'Demo Guest 04', 'en-US', 'pending', null::text, now() - interval '4 days'),
    ('e2500000-0000-4000-8000-000000000915'::uuid, 'e2500000-0000-4000-8000-000000000905'::uuid, 'e2500000-0000-4000-8000-000000000406'::uuid, 4, array['on_time','great_results']::text[], 'Professional, relaxing, and easy to book.', 'Demo Guest 04', 'en-US', 'approved', null::text, now() - interval '8 days')
  ) as sample(review_id, request_id, appointment_id, rating, tags, body, display_name, locale, moderation_status, artist_reply, created_at)
  join public.mova_review_requests request on request.id=sample.request_id
    and request.artist_business_id=business_id and request.appointment_id=sample.appointment_id
    and request.status='used'
  join public.mova_appointments appointment on appointment.id=sample.appointment_id
    and appointment.artist_business_id=business_id and appointment.status='completed'
  where not exists (select 1 from public.mova_reviews existing where existing.appointment_id=sample.appointment_id)
  on conflict do nothing;

  -- P15: owner-authorized AI + Growth entitlement for the Rooted Beauty demo account.
  -- This is a test plan assignment only; it does not create a Stripe subscription.
  insert into public.mova_business_plan_assignments (artist_business_id, plan_key, assignment_status)
  values (business_id, 'ai_growth', 'current')
  on conflict (artist_business_id) do update
    set plan_key = excluded.plan_key, assignment_status = 'current', updated_at = now();

  -- P14: synthetic report activity for this private demo fixture. These are
  -- illustrative analytics only; the Rooted Beauty profile remains unpublished.
  insert into public.mova_profile_traffic_events (
    artist_business_id, event_type, source, event_key, occurred_at
  ) values
    (business_id, 'page_view', 'instagram', 'e2500000-0000-4000-8000-000000000930', now() - interval '1 day'),
    (business_id, 'page_view', 'instagram', 'e2500000-0000-4000-8000-000000000931', now() - interval '2 days'),
    (business_id, 'page_view', 'instagram', 'e2500000-0000-4000-8000-000000000932', now() - interval '3 days'),
    (business_id, 'page_view', 'instagram', 'e2500000-0000-4000-8000-000000000933', now() - interval '5 days'),
    (business_id, 'page_view', 'qr', 'e2500000-0000-4000-8000-000000000934', now() - interval '1 day'),
    (business_id, 'page_view', 'qr', 'e2500000-0000-4000-8000-000000000935', now() - interval '4 days'),
    (business_id, 'page_view', 'google', 'e2500000-0000-4000-8000-000000000936', now() - interval '2 days'),
    (business_id, 'page_view', 'direct', 'e2500000-0000-4000-8000-000000000937', now() - interval '6 days'),
    (business_id, 'qr_scan', 'qr', 'e2500000-0000-4000-8000-000000000938', now() - interval '1 day'),
    (business_id, 'qr_scan', 'qr', 'e2500000-0000-4000-8000-000000000939', now() - interval '4 days'),
    (business_id, 'booking_started', 'instagram', 'e2500000-0000-4000-8000-000000000940', now() - interval '2 days'),
    (business_id, 'booking_started', 'qr', 'e2500000-0000-4000-8000-000000000941', now() - interval '4 days'),
    (business_id, 'booking_completed', 'qr', 'e2500000-0000-4000-8000-000000000942', now() - interval '4 days')
  on conflict (artist_business_id, event_key) do nothing;

  insert into public.mova_slot_events (
    id, artist_business_id, location_id, starts_at, ends_at, origin, status,
    expires_at, filled_appointment_id, filled_at, value_minor, dedupe_key, created_at
  )
  select 'e2500000-0000-4000-8000-000000000925', business_id, appointment.location_id,
    appointment.starts_at, appointment.ends_at, 'gap_scan', 'filled',
    appointment.starts_at, appointment.id, appointment.starts_at, appointment.service_price_minor,
    'rooted-beauty-demo-report-slot-408', appointment.starts_at - interval '1 day'
  from public.mova_appointments appointment
  where appointment.id='e2500000-0000-4000-8000-000000000408'
    and appointment.artist_business_id=business_id and appointment.status='completed'
  on conflict (artist_business_id, dedupe_key) do nothing;

  insert into public.mova_autopilot_decisions (
    id, artist_business_id, client_id, action, reason_code, value_minor, idempotency_key, created_at
  ) values (
    'e2500000-0000-4000-8000-000000000929', business_id, client_2, 'rebooked',
    'demo_fixture_rebooked', 12000, 'rooted-beauty-demo-report-rebook', now() - interval '5 days'
  ) on conflict (artist_business_id, idempotency_key) do nothing;

  insert into public.mova_social_share_events (id, artist_business_id, initiated_at, target_hint)
  values
    ('e2500000-0000-4000-8000-000000000926', business_id, now() - interval '1 day', 'instagram'),
    ('e2500000-0000-4000-8000-000000000927', business_id, now() - interval '4 days', 'copy_link'),
    ('e2500000-0000-4000-8000-000000000928', business_id, now() - interval '6 days', 'instagram')
  on conflict (id) do nothing;

  -- Additional demo coverage for P08-P17. These records are synthetic and
  -- intentionally leave all outbound channels, Stripe, calendar sync, public
  -- profile visibility, wallet issuance, and AI automation disabled.
  insert into public.mova_payment_method_settings (
    artist_business_id, cash_enabled, zelle_recorded_enabled, other_enabled, updated_by
  ) values (business_id, true, false, true, demo_user_id)
  on conflict (artist_business_id) do update set
    cash_enabled = excluded.cash_enabled,
    zelle_recorded_enabled = false,
    other_enabled = excluded.other_enabled,
    updated_by = excluded.updated_by;

  -- Manual demonstration records only; no payment provider is contacted.
  perform public.mova_payment_record_manual(
    business_id, 'e2500000-0000-4000-8000-000000000413', 'cash', 12000,
    'artist', null, 'DEMO-CASH-413', 'rooted-demo-payment-cash-413', demo_user_id
  );
  perform public.mova_payment_record_manual(
    business_id, 'e2500000-0000-4000-8000-000000000405', 'salon_collected', 8000,
    'salon', null, 'DEMO-SALON-405', 'rooted-demo-payment-salon-405', demo_user_id
  );

  insert into public.mova_notification_preferences (artist_business_id, user_id, preferences)
  values (business_id, demo_user_id, '{"in_app":true,"email":true,"push":false}'::jsonb)
  on conflict (artist_business_id, user_id) do update set preferences = excluded.preferences;

  insert into public.mova_notification_inbox (
    id, artist_business_id, user_id, event_type, title_key, body_key, payload, created_at
  ) values
    ('e2500000-0000-4000-8000-000000000951', business_id, demo_user_id, 'demo_booking_request', 'notifications.appointment.title', 'notifications.appointment.body', '{"appointment_id":"e2500000-0000-4000-8000-000000000410"}'::jsonb, now() - interval '1 hour'),
    ('e2500000-0000-4000-8000-000000000952', business_id, demo_user_id, 'demo_payment_recorded', 'notifications.payment.title', 'notifications.payment.body', '{"appointment_id":"e2500000-0000-4000-8000-000000000413"}'::jsonb, now() - interval '2 days')
  on conflict (id) do nothing;

  insert into public.mova_message_templates (
    artist_business_id, type, locale, body, version, status, source
  ) values
    (business_id, 'rebooking_reminder', 'en-US', 'Hi {{first_name}}, it may be time to plan your next visit. Reply if you would like help finding a time.', 1, 'needs_approval', 'system_default'),
    (business_id, 'rebooking_reminder', 'es-US', 'Hola {{first_name}}, quizá sea momento de planear tu próxima visita. Responde si quieres ayuda para encontrar un horario.', 1, 'needs_approval', 'system_default'),
    (business_id, 'slot_offer', 'en-US', 'An appointment opened on {{date}} at {{time}}. Reply if you would like to request it.', 1, 'needs_approval', 'system_default'),
    (business_id, 'slot_offer', 'es-US', 'Se abrió una cita el {{date}} a las {{time}}. Responde si quieres solicitarla.', 1, 'needs_approval', 'system_default'),
    (business_id, 'slot_taken', 'en-US', 'That opening has been claimed. You can ask us about another time.', 1, 'needs_approval', 'system_default'),
    (business_id, 'slot_taken', 'es-US', 'Ese horario ya se reservó. Puedes consultar otro horario.', 1, 'needs_approval', 'system_default'),
    (business_id, 'win_back', 'en-US', 'Hi {{first_name}}, we would love to see you again. Reply if you would like to hear about available times.', 1, 'needs_approval', 'system_default'),
    (business_id, 'win_back', 'es-US', 'Hola {{first_name}}, nos encantaría verte de nuevo. Responde si quieres conocer los horarios disponibles.', 1, 'needs_approval', 'system_default')
  on conflict (artist_business_id, type, locale, version) do nothing;

  insert into public.mova_autopilot_settings (artist_business_id, enabled, slot_texts_autopilot, updated_by)
  values (business_id, false, false, demo_user_id)
  on conflict (artist_business_id) do update set enabled = false, slot_texts_autopilot = false, updated_by = excluded.updated_by;

  insert into public.mova_growth_opportunities (
    id, artist_business_id, client_id, service_id, service_category,
    last_visit_at, next_due_at, window_end_at, confidence, evidence, model_version, status
  ) values
    ('e2500000-0000-4000-8000-000000000953', business_id, client_2, service_silk, 'Styling', now() - interval '35 days', now() - interval '2 days', now() + interval '12 days', 'medium', '{"typical_days":35,"visit_count":2,"demo_fixture":true}'::jsonb, 'demo-fixture-v1', 'due'),
    ('e2500000-0000-4000-8000-000000000954', business_id, client_3, service_hydration, 'Treatment', now() - interval '42 days', now() - interval '7 days', now() + interval '9 days', 'high', '{"typical_days":35,"visit_count":3,"demo_fixture":true}'::jsonb, 'demo-fixture-v1', 'contacted'),
    ('e2500000-0000-4000-8000-000000000955', business_id, client_4, service_silk, 'Styling', now() - interval '70 days', now() - interval '28 days', now() - interval '7 days', 'high', '{"typical_days":35,"visit_count":4,"demo_fixture":true}'::jsonb, 'demo-fixture-v1', 'no_reply')
  on conflict (artist_business_id, client_id, service_id) do update set
    service_category = excluded.service_category, last_visit_at = excluded.last_visit_at,
    next_due_at = excluded.next_due_at, window_end_at = excluded.window_end_at,
    confidence = excluded.confidence, evidence = excluded.evidence,
    model_version = excluded.model_version, status = excluded.status;

  insert into public.mova_forecasts (
    artist_business_id, period_start, period_end, booked_minor, likely_minor,
    likely_low_minor, likely_high_minor, usual_minor, inputs, method_version
  ) values (
    business_id, date_trunc('month', current_date)::date,
    (date_trunc('month', current_date) + interval '1 month')::date,
    22500, 68400, 41000, 89500, 54200,
    '{"bookedMinor":22500,"remainingHours":[18,16,14,12],"fillRates":[0.55,0.6,0.58,0.62],"avgTicketPerHourMinor":[9000,9000,9000,9000],"openLowMinor":18000,"openHighMinor":46000,"dueClients":3,"rebookConversion":0.35,"averageTicketMinor":9500,"rebookLowMinor":4000,"rebookHighMinor":12000,"usualMonthsMinor":[51000,54800,56800]}'::jsonb,
    'forecast-v1'
  ) on conflict (artist_business_id, period_start, method_version) do update set
    booked_minor = excluded.booked_minor, likely_minor = excluded.likely_minor,
    likely_low_minor = excluded.likely_low_minor, likely_high_minor = excluded.likely_high_minor,
    usual_minor = excluded.usual_minor, inputs = excluded.inputs, computed_at = now();

  insert into public.mova_slot_events (
    id, artist_business_id, location_id, starts_at, ends_at, origin, status,
    wave_plan, expires_at, value_minor, dedupe_key, created_at
  ) values
    ('e2500000-0000-4000-8000-000000000956', business_id, studio_id, now() + interval '12 days', now() + interval '12 days 90 minutes', 'cancellation', 'needs_approval', '[3,2,2]'::jsonb, now() + interval '11 days', 12000, 'rooted-demo-open-slot', now() - interval '3 hours'),
    ('e2500000-0000-4000-8000-000000000957', business_id, salon_id, now() + interval '14 days', now() + interval '14 days 60 minutes', 'gap_scan', 'gap_found', '[3,2,2]'::jsonb, now() + interval '13 days', 8000, 'rooted-demo-gap-scan', now() - interval '2 hours')
  on conflict (artist_business_id, dedupe_key) do nothing;

  insert into public.mova_slot_candidates (
    id, slot_event_id, artist_business_id, client_id, rank, wave, reasons, status
  ) values
    ('e2500000-0000-4000-8000-000000000958', 'e2500000-0000-4000-8000-000000000956', business_id, client_2, 1, 1, '["service_match","location_match"]'::jsonb, 'planned'),
    ('e2500000-0000-4000-8000-000000000959', 'e2500000-0000-4000-8000-000000000956', business_id, client_4, 2, 1, '["service_match"]'::jsonb, 'planned')
  on conflict do nothing;

  insert into public.mova_slot_campaign_copy (
    id, slot_event_id, artist_business_id, sms_example, taken_message, social_caption, ai_used, prompt_version
  ) values (
    'e2500000-0000-4000-8000-000000000960', 'e2500000-0000-4000-8000-000000000956', business_id,
    'A silk press opening is available in 12 days. Reply if you would like to request it.',
    'This opening has been claimed. We can help you find another time.',
    'A new appointment opening is available at Rooted Beauty. Send a message to ask about it.',
    false, 'demo-fixture-v1'
  ) on conflict (slot_event_id) do nothing;

  insert into public.mova_concierge_settings (
    artist_business_id, enabled, channels, permissions, tone, languages, daily_ai_turn_cap, globally_paused
  ) values (
    business_id, false,
    '{"instagram":false,"sms":false,"missed_call":false,"web_chat":false}'::jsonb,
    '{"answer":true,"book_instant":false,"request_salon":false,"reschedule":false,"reply_slot_offers":false}'::jsonb,
    'warm', array['en-US','es-US'], 0, true
  ) on conflict (artist_business_id) do update set enabled = false, globally_paused = true;

  insert into public.mova_concierge_knowledge (
    id, artist_business_id, kind, location_id, question, answer_en, answer_es, status
  ) values
    ('e2500000-0000-4000-8000-000000000961', business_id, 'faq', null, 'Where can I find your appointment options?', 'Available services and request options appear on the Rooted Beauty booking page. A stylist confirms salon requests.', 'Los servicios y las opciones para solicitar una cita aparecen en la página de reservas de Rooted Beauty. La estilista confirma las solicitudes del salón.', 'draft'),
    ('e2500000-0000-4000-8000-000000000962', business_id, 'location_detail', studio_id, 'Where is the studio?', 'The studio address is shared after the appointment is confirmed.', 'La dirección del estudio se comparte después de confirmar la cita.', 'draft')
  on conflict (id) do nothing;

  insert into public.mova_conversations (
    id, artist_business_id, channel, external_thread_id, client_id, locale,
    status, ai_enabled, last_message_at, created_at
  ) values
    ('e2500000-0000-4000-8000-000000000963', business_id, 'web_chat', 'rooted-demo-thread-963', client_3, 'es-US', 'needs_you', false, now() - interval '20 minutes', now() - interval '22 minutes'),
    ('e2500000-0000-4000-8000-000000000964', business_id, 'web_chat', 'rooted-demo-thread-964', client_2, 'en-US', 'handled', false, now() - interval '1 day', now() - interval '1 day 10 minutes')
  on conflict (artist_business_id, channel, external_thread_id) do nothing;

  insert into public.mova_messages (
    id, artist_business_id, client_id, conversation_id, direction, channel, purpose,
    origin, body, status, idempotency_key, created_at
  ) values
    ('e2500000-0000-4000-8000-000000000965', business_id, client_3, 'e2500000-0000-4000-8000-000000000963', 'inbound', 'web_chat', 'transactional', 'system', 'Hola, ¿puedo pedir una cotización para un estilo protector?', 'received', 'rooted-demo-inbound-963', now() - interval '20 minutes'),
    ('e2500000-0000-4000-8000-000000000966', business_id, client_2, 'e2500000-0000-4000-8000-000000000964', 'inbound', 'web_chat', 'transactional', 'system', 'Do you have appointment times next week?', 'received', 'rooted-demo-inbound-964', now() - interval '1 day')
  on conflict (artist_business_id, idempotency_key) do nothing;

  insert into public.mova_handoffs (
    id, artist_business_id, conversation_id, type, status, summary, created_at
  ) values (
    'e2500000-0000-4000-8000-000000000967', business_id, 'e2500000-0000-4000-8000-000000000963',
    'quote', 'open', 'Client asks for a protective-style quote; stylist review is required.', now() - interval '20 minutes'
  ) on conflict (id) do nothing;

  insert into public.mova_quote_requests (
    id, artist_business_id, conversation_id, client_id, service_category,
    details, media, risk_flags, status, created_at
  ) values (
    'e2500000-0000-4000-8000-000000000968', business_id, 'e2500000-0000-4000-8000-000000000963', client_3,
    'Protective style', '{"hair_now":"Natural curls","goal":"Low-tension protective style","budget":"Please discuss","availability":"Weekends","demo_fixture":true}'::jsonb,
    '[]'::jsonb, '[]'::jsonb, 'open', now() - interval '20 minutes'
  ) on conflict (id) do nothing;
end
$rooted_beauty_seed$;
