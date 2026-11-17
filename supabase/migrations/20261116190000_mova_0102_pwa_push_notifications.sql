-- PWA: install flag, push subscriptions, and the five stylist alerts (email + push).
-- Requires 0098 (mova_account_names). Owner runs manually; redeploy push-subscription, messaging-settings,
-- job-worker and job-dispatch with it.

-- 1. "Installed" flag per account. Set the first time Mova is opened from the Home Screen,
--    so the install banner stops showing in every browser for that stylist.
create table if not exists public.mova_user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  installed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mova_user_app_state enable row level security;
drop policy if exists mova_user_app_state_select_own on public.mova_user_app_state;
create policy mova_user_app_state_select_own on public.mova_user_app_state for select to authenticated using (user_id = auth.uid());
drop policy if exists mova_user_app_state_insert_own on public.mova_user_app_state;
create policy mova_user_app_state_insert_own on public.mova_user_app_state for insert to authenticated with check (user_id = auth.uid());
drop policy if exists mova_user_app_state_update_own on public.mova_user_app_state;
create policy mova_user_app_state_update_own on public.mova_user_app_state for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.mova_user_app_state from anon;
revoke delete, truncate on public.mova_user_app_state from authenticated;
grant select, insert, update on public.mova_user_app_state to authenticated;
drop trigger if exists mova_user_app_state_touch_updated_at on public.mova_user_app_state;
create trigger mova_user_app_state_touch_updated_at before update on public.mova_user_app_state
  for each row execute function public.mova_touch_updated_at();

-- 2. Push subscriptions (table from 0013). Endpoint and keys stay encrypted; edge functions only.
alter table public.mova_push_subscriptions add column if not exists last_success_at timestamptz;
alter table public.mova_push_subscriptions add column if not exists failure_count integer not null default 0;
alter table public.mova_push_subscriptions enable row level security;
revoke all on public.mova_push_subscriptions from anon, authenticated;
create index if not exists mova_push_subscriptions_active_idx on public.mova_push_subscriptions(artist_business_id, user_id) where revoked_at is null;

-- 3. New outbox events for two of the five alerts.
create or replace function public.mova_review_created_outbox_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.mova_outbox_events(artist_business_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (new.artist_business_id, 'review', new.id, 'review.created', jsonb_build_object('rating', new.rating), 'review-created:' || new.id::text)
  on conflict (idempotency_key) do nothing;
  return new;
end $$;
revoke all on function public.mova_review_created_outbox_trigger() from public, anon, authenticated;
drop trigger if exists mova_review_created_outbox on public.mova_reviews;
create trigger mova_review_created_outbox after insert on public.mova_reviews
  for each row execute function public.mova_review_created_outbox_trigger();

create or replace function public.mova_message_received_outbox_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.direction = 'inbound' then
    insert into public.mova_outbox_events(artist_business_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
    values (new.artist_business_id, 'message', new.id, 'message.received', jsonb_build_object('channel', new.channel), 'message-received:' || new.id::text)
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.mova_message_received_outbox_trigger() from public, anon, authenticated;
drop trigger if exists mova_message_received_outbox on public.mova_messages;
create trigger mova_message_received_outbox after insert on public.mova_messages
  for each row execute function public.mova_message_received_outbox_trigger();

-- 4. Stylist reminder ~1 hour before each confirmed appointment (job-dispatch calls this every run).
create or replace function public.mova_enqueue_stylist_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare queued integer;
begin
  insert into public.mova_outbox_events(artist_business_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  select a.artist_business_id, 'appointment', a.id, 'appointment.stylist_reminder', '{}'::jsonb,
         'stylist-reminder:' || a.id::text || ':' || to_char(a.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI')
  from public.mova_appointments a
  where a.status = 'confirmed'
    and a.starts_at >= p_now + interval '45 minutes' and a.starts_at < p_now + interval '75 minutes'
  on conflict (idempotency_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end $$;
revoke all on function public.mova_enqueue_stylist_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.mova_enqueue_stylist_reminders(timestamptz) to service_role;

-- 5. Everything an alert needs: recipients (with locale and private first name), the business number for
--    links, and the details of the appointment, message or review it is about.
create or replace function public.mova_stylist_alert_context(p_event_type text, p_aggregate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare
  v_business uuid; v_appointment uuid; v_client uuid; v_message text; v_rating int; v_review_name text; v_review_body text;
  v_cancelled_by text; v_result jsonb;
begin
  if p_event_type = 'message.received' then
    select m.artist_business_id, m.client_id, left(m.body, 160) into v_business, v_client, v_message from public.mova_messages m where m.id = p_aggregate_id;
  elsif p_event_type = 'review.created' then
    select r.artist_business_id, r.appointment_id, r.rating, r.display_name, left(r.body, 160)
      into v_business, v_appointment, v_rating, v_review_name, v_review_body from public.mova_reviews r where r.id = p_aggregate_id;
  else
    select a.artist_business_id, a.id into v_business, v_appointment from public.mova_appointments a where a.id = p_aggregate_id;
    if p_event_type in ('appointment.cancelled', 'appointment.canceled') then
      select e.actor_type into v_cancelled_by from public.mova_appointment_events e
      where e.appointment_id = p_aggregate_id and e.to_status = 'cancelled' order by e.occurred_at desc limit 1;
    end if;
  end if;
  if v_business is null then return null; end if;

  select jsonb_build_object(
    'artist_business_id', b.id,
    'business_number', b.business_number,
    'locale', coalesce(p.preferred_locale, 'en-US'),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email,
        'first_name', coalesce(nullif(trim(n.first_name), ''), nullif(trim(u.raw_user_meta_data->>'first_name'), ''), p.display_name, b.name)))
      from public.mova_artist_memberships mm join auth.users u on u.id = mm.user_id
      left join public.mova_account_names n on n.user_id = u.id
      where mm.artist_business_id = b.id and mm.status = 'active'
    ), '[]'::jsonb),
    'appointment', (select jsonb_build_object('id', a.id, 'client_name', a.client_name, 'service_name', a.service_name_snapshot,
        'starts_at', a.starts_at, 'time_zone', l.time_zone, 'location_name', l.name, 'status', a.status)
      from public.mova_appointments a join public.mova_locations l on l.id = a.location_id where a.id = v_appointment),
    'client', (select jsonb_build_object('id', c.id, 'name', c.display_name) from public.mova_clients c where c.id = v_client),
    'message', v_message,
    'review', case when v_rating is null then null else jsonb_build_object('rating', v_rating, 'name', v_review_name, 'body', v_review_body) end,
    'cancelled_by', v_cancelled_by,
    'needs_count', (select count(*) from public.mova_appointments x where x.artist_business_id = b.id and x.status = 'pending_artist')
  ) into v_result
  from public.mova_artist_businesses b left join public.mova_artist_profiles p on p.artist_business_id = b.id
  where b.id = v_business;
  return v_result;
end $$;
revoke all on function public.mova_stylist_alert_context(text, uuid) from public, anon, authenticated;
grant execute on function public.mova_stylist_alert_context(text, uuid) to service_role;

-- 6. The booking-request email (EM12) is addressed by email; this finds that member's notification choices.
create or replace function public.mova_member_preferences_by_email(p_artist_business_id uuid, p_email text)
returns jsonb language sql stable security definer set search_path = public, auth, pg_temp as $$
  select jsonb_build_object('user_id', u.id, 'preferences', coalesce(np.preferences, '{}'::jsonb))
  from public.mova_artist_memberships m
  join auth.users u on u.id = m.user_id
  left join public.mova_notification_preferences np on np.artist_business_id = m.artist_business_id and np.user_id = u.id
  where m.artist_business_id = p_artist_business_id and m.status = 'active' and lower(u.email) = lower(p_email)
  limit 1;
$$;
revoke all on function public.mova_member_preferences_by_email(uuid, text) from public, anon, authenticated;
grant execute on function public.mova_member_preferences_by_email(uuid, text) to service_role;
