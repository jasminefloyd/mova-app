-- Task 5.1: seat filler. A cancelled or no-show appointment's slot.opened event becomes a slot campaign;
-- eligible clients (texts about offers allowed, not opted out, due to rebook or lapsed) are ranked into
-- waves; the stylist approves (or autopilot does, O11); texts go out through the Phase 4 SMS gate
-- (consent, STOP, quiet hours, caps); the first client to claim gets the appointment.
alter table public.mova_slot_events add column if not exists service_id uuid;
alter table public.mova_slot_events add column if not exists wave_minutes integer not null default 20 check (wave_minutes between 5 and 240);
alter table public.mova_slot_events add column if not exists current_wave smallint not null default 0 check (current_wave between 0 and 3);
alter table public.mova_slot_events add column if not exists next_wave_at timestamptz;
alter table public.mova_slot_candidates add column if not exists claimed_at timestamptz;
create unique index if not exists mova_slot_candidates_claim_token_uq on public.mova_slot_candidates(claim_token_hash) where claim_token_hash is not null;

-- Consumes one slot.opened outbox event. Returns the slot campaign id, or null when the slot is too
-- soon, already covered, or the source appointment is gone.
create or replace function public.mova_slot_open_from_event(p_outbox_event_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare ev public.mova_outbox_events%rowtype; appt public.mova_appointments%rowtype; slot_id uuid;
begin
  select * into ev from public.mova_outbox_events where id = p_outbox_event_id and event_type = 'slot.opened';
  if not found then return null; end if;
  select * into appt from public.mova_appointments where id = ev.aggregate_id;
  if not found or appt.starts_at < now() + interval '3 hours' then return null; end if;
  select id into slot_id from public.mova_slot_events where artist_business_id = appt.artist_business_id and dedupe_key = 'appointment:' || appt.id;
  if slot_id is not null then return slot_id; end if;
  begin
    insert into public.mova_slot_events(artist_business_id, location_id, starts_at, ends_at, origin, source_appointment_id, status, expires_at, value_minor, dedupe_key, service_id)
    values (appt.artist_business_id, appt.location_id, appt.starts_at, appt.ends_at, case when appt.status = 'no_show' then 'no_show' else 'cancellation' end,
      appt.id, 'drafting', appt.starts_at - interval '2 hours', appt.service_price_minor, 'appointment:' || appt.id, appt.service_id)
    on conflict (artist_business_id, dedupe_key) do nothing
    returning id into slot_id;
  exception when sqlstate '23P01' then return null; -- an open campaign already covers this time
  end;
  if slot_id is null then select id into slot_id from public.mova_slot_events where artist_business_id = appt.artist_business_id and dedupe_key = 'appointment:' || appt.id; end if;
  return slot_id;
end $$;

-- Ranks eligible clients into waves (default 3, 2, 2) and drafts the copy; the campaign then needs
-- approval. Eligible: SMS consent for offers is currently granted, not opted out of marketing, has a
-- phone, is not the client who cancelled, has nothing booked at that time, and is due to rebook
-- (growth opportunity) or lapsed (no visit in 42 days). Due clients for the same service rank first.
create or replace function public.mova_slot_build_campaign(p_slot_event_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare slot public.mova_slot_events%rowtype; waves integer[]; total integer; inserted integer;
  stylist text; service_name text; location_name text;
begin
  select * into slot from public.mova_slot_events where id = p_slot_event_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SLOT_NOT_FOUND'; end if;
  if slot.status not in ('gap_found', 'drafting') then return 0; end if;
  select array_agg(value::int) into waves from jsonb_array_elements_text(slot.wave_plan);
  total := coalesce((select sum(w) from unnest(waves) w), 7);
  with latest_consent as (
    select distinct on (client_id) client_id, granted from public.mova_client_consents
    where artist_business_id = slot.artist_business_id and purpose = 'offers' and channel = 'sms'
    order by client_id, changed_at desc
  ), source as (
    select client_id from public.mova_appointments where id = slot.source_appointment_id
  ), eligible as (
    select c.id as client_id,
      exists (select 1 from public.mova_growth_opportunities g where g.artist_business_id = c.artist_business_id and g.client_id = c.id and g.status = 'due' and g.service_id = slot.service_id) as due_same,
      exists (select 1 from public.mova_growth_opportunities g where g.artist_business_id = c.artist_business_id and g.client_id = c.id and g.status = 'due') as due_any,
      c.last_visit_at
    from public.mova_clients c
    join latest_consent lc on lc.client_id = c.id and lc.granted
    where c.artist_business_id = slot.artist_business_id and not c.marketing_opted_out and c.phone_normalized is not null
      and c.id is distinct from (select client_id from source)
      and not exists (select 1 from public.mova_appointments a where a.artist_business_id = c.artist_business_id and a.client_id = c.id
        and a.status in ('confirmed', 'pending_artist', 'pending_payment') and a.starts_at < slot.ends_at and a.ends_at > slot.starts_at)
  ), ranked as (
    select client_id, row_number() over (order by due_same desc, due_any desc, last_visit_at asc nulls last, client_id) as rank,
      case when due_same then 'due_same_service' when due_any then 'due' else 'lapsed' end as reason
    from eligible where due_any or last_visit_at is null or last_visit_at < now() - interval '42 days'
  )
  insert into public.mova_slot_candidates(slot_event_id, artist_business_id, client_id, rank, wave, reasons)
  select p_slot_event_id, slot.artist_business_id, client_id, rank,
    case when rank <= coalesce(waves[1], 3) then 1 when rank <= coalesce(waves[1], 3) + coalesce(waves[2], 2) then 2 else 3 end,
    jsonb_build_array(reason)
  from ranked where rank <= total
  on conflict (slot_event_id, client_id) do nothing;
  get diagnostics inserted = row_count;

  select display_name into stylist from public.mova_artist_profiles where artist_business_id = slot.artist_business_id;
  select name into service_name from public.mova_services where id = slot.service_id;
  select name into location_name from public.mova_locations where id = slot.location_id;
  insert into public.mova_slot_campaign_copy(slot_event_id, artist_business_id, sms_example, taken_message, social_caption)
  values (p_slot_event_id, slot.artist_business_id,
    left(format('A spot just opened %s at %s%s. First to book gets it: [claim link]. Reply STOP to opt out. — %s',
      to_char(slot.starts_at at time zone coalesce((select time_zone from public.mova_locations where id = slot.location_id), 'UTC'), 'Dy, Mon DD "at" HH12:MI AM'),
      coalesce(location_name, ''), coalesce(' for ' || service_name, ''), coalesce(split_part(stylist, ' ', 1), 'your stylist')), 320),
    'That spot was just taken. Here are other times: [booking link]',
    left(format('Just opened: %s at %s. One spot only, link in bio to grab it.', to_char(slot.starts_at at time zone coalesce((select time_zone from public.mova_locations where id = slot.location_id), 'UTC'), 'Dy HH12:MI AM'), coalesce(location_name, '')), 220))
  on conflict (slot_event_id) do nothing;
  update public.mova_slot_events set status = case when inserted > 0 or exists (select 1 from public.mova_slot_candidates where slot_event_id = p_slot_event_id) then 'needs_approval' else 'gap_found' end, updated_at = now() where id = p_slot_event_id;
  return inserted;
end $$;

-- First claim wins. Locks the slot row, so concurrent claims serialize; only a live, unexpired slot
-- with a matching messaged candidate can be claimed. Creates the appointment from the cancelled one's
-- service, confirmed at instant-booking locations or as a request otherwise.
create or replace function public.mova_slot_claim(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cand public.mova_slot_candidates%rowtype; slot public.mova_slot_events%rowtype; client public.mova_clients%rowtype;
  svc public.mova_services%rowtype; loc public.mova_locations%rowtype; appt_id uuid; manage bytea; new_status text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid'); end if;
  select * into cand from public.mova_slot_candidates where claim_token_hash = p_token_hash;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  select * into slot from public.mova_slot_events where id = cand.slot_event_id for update;
  if slot.status = 'filled' then return jsonb_build_object('status', case when slot.filled_appointment_id is not null and cand.status = 'claimed' then 'claimed' else 'taken' end, 'appointment_id', case when cand.status = 'claimed' then slot.filled_appointment_id end); end if;
  if slot.status <> 'live' or slot.expires_at <= now() or cand.status <> 'messaged' then return jsonb_build_object('status', 'expired'); end if;
  select * into client from public.mova_clients where id = cand.client_id;
  select * into svc from public.mova_services where id = slot.service_id;
  select * into loc from public.mova_locations where id = slot.location_id;
  if svc.id is null or loc.id is null or not loc.is_active then return jsonb_build_object('status', 'expired'); end if;
  if exists (select 1 from public.mova_appointments a where a.artist_business_id = slot.artist_business_id and a.location_id = slot.location_id
      and a.status in ('confirmed', 'pending_artist', 'pending_payment') and a.starts_at < slot.ends_at and a.ends_at > slot.starts_at) then
    update public.mova_slot_events set status = 'expired', updated_at = now() where id = slot.id;
    return jsonb_build_object('status', 'taken');
  end if;
  new_status := case when loc.booking_mode = 'instant' then 'confirmed' else 'pending_artist' end;
  manage := decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex');
  insert into public.mova_appointments(artist_business_id, location_id, service_id, client_id, source, status, starts_at, ends_at, service_name_snapshot,
    service_price_minor, deposit_due_minor, balance_due_minor, client_name, client_email, client_phone, client_locale, manage_token_hash, idempotency_key, confirmed_at)
  values (slot.artist_business_id, slot.location_id, svc.id, client.id, 'seat_filler', new_status, slot.starts_at, slot.ends_at, svc.name,
    svc.base_price_minor, 0, svc.base_price_minor, client.display_name, client.email, client.phone, client.preferred_locale,
    sha256(manage), 'seat-filler:' || slot.id, case when new_status = 'confirmed' then now() end)
  returning id into appt_id;
  insert into public.mova_appointment_services(artist_business_id, appointment_id, service_id, position, service_name_snapshot, duration_minutes_snapshot, price_minor_snapshot, deposit_type_snapshot, deposit_value_snapshot, deposit_due_minor_snapshot)
  values (slot.artist_business_id, appt_id, svc.id, 1, svc.name, svc.duration_minutes, svc.base_price_minor, 'none', 0, 0);
  insert into public.mova_outbox_events(artist_business_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (slot.artist_business_id, 'appointment', appt_id, 'appointment.' || new_status, jsonb_build_object('client_locale', client.preferred_locale, 'source', 'seat_filler'), 'seat-filler:' || slot.id || ':event')
  on conflict (idempotency_key) do nothing;
  update public.mova_slot_candidates set status = 'claimed', claimed_at = now() where id = cand.id;
  update public.mova_slot_events set status = 'filled', filled_appointment_id = appt_id, filled_at = now(), next_wave_at = null, updated_at = now() where id = slot.id;
  return jsonb_build_object('status', 'claimed', 'appointment_id', appt_id, 'appointment_status', new_status, 'manage_token', encode(manage, 'hex'));
end $$;

-- Live campaigns whose next wave is due (for the job dispatcher).
create or replace function public.mova_slot_due_waves(p_now timestamptz default now())
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from public.mova_slot_events e
  where e.status = 'live' and e.next_wave_at <= p_now and e.expires_at > p_now and e.current_wave < 3
    and exists (select 1 from public.mova_slot_candidates c where c.slot_event_id = e.id and c.wave = e.current_wave + 1 and c.status = 'planned');
$$;

-- Closes live campaigns past their end (2 hours before the slot).
create or replace function public.mova_slot_expire(p_now timestamptz default now())
returns integer language sql security definer set search_path = public, pg_temp as $$
  with done as (update public.mova_slot_events set status = 'expired', next_wave_at = null, updated_at = now()
    where status in ('needs_approval', 'live', 'drafting', 'gap_found') and expires_at <= p_now returning 1)
  select count(*)::int from done;
$$;

revoke all on function public.mova_slot_open_from_event(uuid), public.mova_slot_build_campaign(uuid), public.mova_slot_claim(text),
  public.mova_slot_due_waves(timestamptz), public.mova_slot_expire(timestamptz) from public, anon, authenticated;
grant execute on function public.mova_slot_open_from_event(uuid), public.mova_slot_build_campaign(uuid), public.mova_slot_claim(text),
  public.mova_slot_due_waves(timestamptz), public.mova_slot_expire(timestamptz) to service_role;
