do $polish$
declare
  target constant uuid := 'e2500000-0000-4000-8000-000000000001';
  studio constant uuid := 'e2500000-0000-4000-8000-000000000101';
  salon constant uuid := 'e2500000-0000-4000-8000-000000000102';
  owner_id uuid;
  today date := (now() at time zone 'America/New_York')::date;
  starts timestamptz;
  fixture record;
  chosen_service public.mova_services%rowtype;
  chosen_client public.mova_clients%rowtype;
  appointment_id uuid;
  recorded_amount bigint;
begin
  select m.user_id into strict owner_id
  from public.mova_artist_memberships m join auth.users u on u.id=m.user_id
  where m.artist_business_id=target and m.role='owner' and m.status='active' and u.email_confirmed_at is not null and u.deleted_at is null;

  -- Retain the showcase identity, avatar and existing portfolio objects.
  update public.mova_artist_profiles
  set bio='Rooted Beauty is a demo studio for healthy hair, soft silk presses, defined curls and low-tension protective styling. This showcase uses fictional clients, appointments and imagery.',
      search_index_enabled=false
  where artist_business_id=target;

  update public.mova_services set status='inactive'
  where artist_business_id=target and lower(btrim(name)) in ('test','testing');
  update public.mova_services s set description=v.description
  from (values
      ('Silk Press','A gentle cleanse, conditioning and a smooth silk finish, with heat protection throughout.'),
      ('Hydration Treatment','A moisture-focused wash and conditioning treatment finished with gentle styling.'),
      ('Protective Style Consultation','Talk through your goals, current routine and tension preferences before choosing a protective style.'),
      ('Curl Definition & Diffusion','A curl-by-curl styling session with a soft, diffused finish.'),
      ('Wash, Trim & Style','A fresh wash, shape maintenance and a finish tailored to your texture.'),
      ('Medium Knotless Braids','Medium knotless braids with a low-tension foundation. Book a consultation to discuss length and prep.'),
      ('Flat Twist Protective Set','A low-tension flat-twist set with a polished finish and maintenance guidance.'),
      ('Scalp Detox & Steam','A clarifying scalp service and warm steam to prepare hair for moisture.'),
      ('Trim & Shape','A maintenance trim that preserves length while refreshing shape.')
  ) as v(name,description) where s.artist_business_id=target and s.name=v.name;

  for fixture in select * from (values
      (1,'Amara Bennett','en-US'),(2,'Jade Monroe','en-US'),(3,'Sofía Reyes','es-US'),
      (4,'Nia Carter','en-US'),(5,'Daniela Cruz','es-US'),(6,'Imani Brooks','en-US'),
      (7,'Avery Jordan','en-US'),(8,'Valeria Morales','es-US'),(9,'Maya Ellis','en-US'),
      (10,'Noelle Price','en-US'),(11,'Gabriela Luna','es-US'),(12,'Zoe Parker','en-US')
  ) as clients(n,name,locale) loop
    if fixture.n <= 5 then
      update public.mova_clients set display_name=fixture.name,preferred_locale=fixture.locale
      where artist_business_id=target and id=('e2500000-0000-4000-8000-'||lpad((300+fixture.n)::text,12,'0'))::uuid;
    else
      insert into public.mova_clients(id,artist_business_id,display_name,email,email_normalized,phone,phone_normalized,preferred_locale,source,marketing_opted_out,created_by)
      values(('e2510000-0000-4000-8000-'||lpad(fixture.n::text,12,'0'))::uuid,target,fixture.name,
             'rooted-guest-'||fixture.n||'@example.invalid','rooted-guest-'||fixture.n||'@example.invalid',
             '+120255501'||lpad(fixture.n::text,2,'0'),'+120255501'||lpad(fixture.n::text,2,'0'),
             fixture.locale,'manual',fixture.n in (8,11),owner_id);
    end if;
  end loop;

  -- Update the names copied into the base seed's appointment and review snapshots.
  update public.mova_appointments a set client_name=c.display_name
  from public.mova_clients c where a.artist_business_id=target and c.artist_business_id=target and a.client_id=c.id;
  update public.mova_reviews r set display_name=c.display_name
  from public.mova_appointments a join public.mova_clients c on c.id=a.client_id and c.artist_business_id=a.artist_business_id
  where r.artist_business_id=target and a.artist_business_id=target and r.appointment_id=a.id;

  -- Seeded contacts show opted-out consent states. No fixture enqueues live delivery.
  update public.mova_client_consents set granted=false
  where artist_business_id=target;
  update public.mova_notification_preferences set preferences='{"in_app":true,"email":false,"push":false}'::jsonb
  where artist_business_id=target and user_id=owner_id;

  for fixture in select * from (values
      (1, 6,201,studio,-36,time '10:00','completed','cash'),
      (2, 7,202,studio,-32,time '13:30','completed','cash'),
      (3, 8,203,salon, -28,time '11:00','completed','salon_collected'),
      (4, 9,201,studio,-25,time '10:00','completed','cash'),
      (5,10,202,salon, -21,time '13:00','completed','salon_collected'),
      (6,11,201,studio,-18,time '14:30','no_show',null),
      (7,12,201,studio,-15,time '10:00','completed','cash'),
      (8, 6,203,salon, -13,time '11:30','completed','salon_collected'),
      (9, 7,201,studio,-10,time '14:30','completed','other'),
      (10,8,202,studio, -6,time '14:00','completed','cash'),
      (11,9,201,studio, -4,time '10:00','completed','cash'),
      (12,10,203,salon, -2,time '13:00','completed','salon_collected'),
      (13,11,201,studio, 0,time '11:15','confirmed',null),
      (14,12,203,salon,  0,time '14:00','confirmed',null),
      (15,6,201,studio,  3,time '10:00','confirmed',null),
      (16,7,201,studio,  8,time '11:00','confirmed',null),
      (17,8,203,salon,   8,time '14:00','pending_artist',null),
      (18,9,202,studio, 11,time '14:15','confirmed',null),
      (19,10,201,salon, 15,time '10:00','pending_artist',null),
      (20,11,201,studio,19,time '14:30','confirmed',null)
  ) as schedule(n,client_n,service_n,location_id,day_offset,local_time,status,method) loop
    select * into strict chosen_client from public.mova_clients
      where artist_business_id=target and id=('e2510000-0000-4000-8000-'||lpad(fixture.client_n::text,12,'0'))::uuid;
    select * into strict chosen_service from public.mova_services
      where artist_business_id=target and id=('e2500000-0000-4000-8000-'||lpad(fixture.service_n::text,12,'0'))::uuid;
    starts:=((today + fixture.day_offset) + fixture.local_time) at time zone 'America/New_York';
    appointment_id:=('e2510000-0000-4000-8000-'||lpad((400+fixture.n)::text,12,'0'))::uuid;
    insert into public.mova_appointments(id,artist_business_id,location_id,service_id,client_id,source,status,
      starts_at,ends_at,service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,
      client_name,client_email,client_phone,client_locale,request_expires_at,manage_token_hash,idempotency_key,confirmed_at)
    values(appointment_id,target,fixture.location_id,chosen_service.id,chosen_client.id,'artist',fixture.status,
      starts, starts+make_interval(mins=>chosen_service.duration_minutes+chosen_service.buffer_minutes),chosen_service.name,
      chosen_service.base_price_minor,0,chosen_service.base_price_minor,chosen_client.display_name,chosen_client.email,
      chosen_client.phone,chosen_client.preferred_locale,case when fixture.status='pending_artist' then now()+interval '48 hours' end,
      decode(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),'hex'),
      'rooted-polished-demo:'||fixture.n,case when fixture.status <> 'pending_artist' then starts-interval '1 day' end);

    if fixture.method is not null then
      recorded_amount := chosen_service.base_price_minor;
      perform public.mova_payment_record_manual(target,appointment_id,fixture.method,recorded_amount,
        case when fixture.method='salon_collected' then 'salon' else 'artist' end,
        case when fixture.method='other' then 'Recorded transfer' end,'DEMO-'||fixture.n,
        'rooted-demo-payment-polished-'||fixture.n,owner_id);
    end if;
  end loop;

  -- Populate snapshots for both the base and expanded appointment history.
  insert into public.mova_appointment_services(artist_business_id,appointment_id,service_id,position,service_name_snapshot,
      duration_minutes_snapshot,price_minor_snapshot,deposit_type_snapshot,deposit_value_snapshot,deposit_due_minor_snapshot)
  select a.artist_business_id,a.id,a.service_id,1,a.service_name_snapshot,
      ceil(extract(epoch from a.ends_at-a.starts_at)/60)::int,a.service_price_minor,
      case when a.deposit_due_minor=0 then 'none' else s.deposit_type end,
      case when a.deposit_due_minor=0 then 0 else s.deposit_value end,a.deposit_due_minor
  from public.mova_appointments a join public.mova_services s on s.id=a.service_id and s.artist_business_id=a.artist_business_id
  where a.artist_business_id=target and a.service_id is not null
  on conflict on constraint mova_appointment_services_position_uq do nothing;

  insert into public.mova_marketing_campaigns(id,artist_business_id,created_by,name,goal,audience,status)
  values
    ('e2510000-0000-4000-8000-000000000701',target,owner_id,'December curl care check-in','rebook','{"segment":"due_rebook"}','draft'),
    ('e2510000-0000-4000-8000-000000000702',target,owner_id,'Protective styles for the season','showcase','{"segment":"all_opted_in"}','draft');
  insert into public.mova_marketing_campaign_channels(campaign_id,artist_business_id,channel,content,status)
  values
    ('e2510000-0000-4000-8000-000000000701',target,'email',
      '{"subject":"Ready for a fresh curl day?","body":"A hydration visit and simple styling reset can help your curls carry you through the season. See the available times at Rooted Beauty."}','draft'),
    ('e2510000-0000-4000-8000-000000000702',target,'social',
      '{"caption":"Low-tension twists, knotless braids and a routine that fits your week. Explore the Rooted Beauty looks and start with a consultation."}','draft');

  -- Admin assignments exclude this business from the free trial permanently.
  insert into public.mova_business_plan_assignments(artist_business_id,plan_key,assignment_status,assignment_source)
  values(target,'ai_growth','current','admin')
  on conflict (artist_business_id) do update set plan_key='ai_growth',assignment_status='current',assignment_source='admin',updated_at=now();
  delete from public.mova_business_feature_overrides where artist_business_id=target and enabled=false;
  perform public.mova_reports_refresh_daily(target, d::date)
    from generate_series(today-40,today+1,interval '1 day') d;

  -- The seed inserts representative reviews and inbound messages. Those
  -- triggers create notifications for normal writes. Discard the synthetic
  -- outbox entries within this transaction before dispatchers can see them.
  delete from public.mova_outbox_events
  where artist_business_id=target and event_type in ('message.received','review.created') and delivered_at is null;

  if exists (select 1 from public.mova_outbox_events where artist_business_id=target and delivered_at is null) then
    raise exception 'The demo seed created pending outbound activity: %', (select string_agg(distinct event_type, ', ') from public.mova_outbox_events where artist_business_id=target and delivered_at is null);
  end if;
  if (select count(*) from public.mova_clients where artist_business_id=target) <> 12
    or (select count(*) from public.mova_appointments where artist_business_id=target) <> 41 then
    raise exception 'The demo fixture counts do not match';
  end if;
end
$polish$;
