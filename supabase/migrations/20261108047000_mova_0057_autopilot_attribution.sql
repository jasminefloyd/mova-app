-- Task 5.2: attribute rebookings to the autopilot. A contacted opportunity counts as rebooked when the
-- client books a new appointment after the reminder and within the stylist's attribution window
-- (rules.attribution_days, default 14). Each attribution is logged once on Activity (36).
create or replace function public.mova_autopilot_attribute(p_artist_business_id uuid, p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare days integer; hit record; total integer := 0;
begin
  select coalesce(nullif(rules->>'attribution_days', '')::int, 14) into days from public.mova_autopilot_settings where artist_business_id = p_artist_business_id;
  days := least(greatest(coalesce(days, 14), 1), 60);
  for hit in
    select distinct on (o.id) o.id as opportunity_id, o.client_id, a.id as appointment_id, a.service_price_minor, d.created_at as sent_at
    from public.mova_growth_opportunities o
    join public.mova_autopilot_decisions d on d.opportunity_id = o.id and d.action = 'sent'
    join public.mova_appointments a on a.artist_business_id = o.artist_business_id and a.client_id = o.client_id
      and a.created_at > d.created_at and a.created_at <= d.created_at + make_interval(days => days) and a.created_at <= p_now
      and a.status in ('confirmed', 'pending_artist', 'pending_payment', 'completed')
    where o.artist_business_id = p_artist_business_id and o.status = 'contacted'
    order by o.id, a.created_at
  loop
    update public.mova_growth_opportunities set status = 'rebooked', updated_at = p_now where id = hit.opportunity_id;
    insert into public.mova_autopilot_decisions(artist_business_id, client_id, opportunity_id, action, reason_code, value_minor, idempotency_key)
    values (p_artist_business_id, hit.client_id, hit.opportunity_id, 'rebooked', 'booked_after_reminder', hit.service_price_minor, 'rebooked:' || hit.opportunity_id)
    on conflict (artist_business_id, idempotency_key) do nothing;
    total := total + 1;
  end loop;
  return total;
end $$;
revoke all on function public.mova_autopilot_attribute(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.mova_autopilot_attribute(uuid, timestamptz) to service_role;
