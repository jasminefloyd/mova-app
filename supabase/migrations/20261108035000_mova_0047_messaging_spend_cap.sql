-- Owner decision O4 (Nov 8): one hard-stop spend cap of $50 per calendar month (UTC), shared by email and
-- SMS across the platform. Every outbound message reserves its estimated cost before the provider is
-- called; at the cap, sending pauses (the message is suppressed with reason 'spend_cap_reached').
-- Real costs from delivery receipts replace the estimate in cost_micros (messaging-events).

create or replace function public.mova_messaging_spend_cap_micros() returns bigint
language sql stable set search_path = public, pg_temp as $$
  select greatest(0, coalesce(nullif(current_setting('mova.messaging_spend_cap_micros', true), '')::bigint, 50000000));
$$;
revoke all on function public.mova_messaging_spend_cap_micros() from public, anon, authenticated;
grant execute on function public.mova_messaging_spend_cap_micros() to service_role;

create or replace function public.mova_messaging_month_spend_micros(p_now timestamptz default now()) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(m.cost_micros), 0)::bigint from public.mova_messages m
  where m.direction = 'outbound' and m.channel in ('sms', 'email') and m.cost_micros is not null
    and m.status not in ('failed', 'suppressed')
    and m.created_at >= date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'
    and m.created_at < (date_trunc('month', p_now at time zone 'UTC') + interval '1 month') at time zone 'UTC';
$$;
revoke all on function public.mova_messaging_month_spend_micros(timestamptz) from public, anon, authenticated;
grant execute on function public.mova_messaging_month_spend_micros(timestamptz) to service_role;

-- Atomically reserves the estimated cost on a queued message. Serialised with an advisory lock so two
-- workers cannot both pass the cap. Returns {allowed, spent_micros, cap_micros}.
create or replace function public.mova_messaging_reserve_spend(p_message_id uuid, p_cost_micros bigint, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare spent bigint; cap bigint := public.mova_messaging_spend_cap_micros();
begin
  if p_cost_micros is null or p_cost_micros < 0 then raise exception using errcode = '22023', message = 'COST_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mova:messaging-spend', 0));
  spent := public.mova_messaging_month_spend_micros(p_now);
  if spent + p_cost_micros > cap then
    update public.mova_messages set status = 'suppressed', error_code = 'spend_cap_reached', cost_micros = null where id = p_message_id and status = 'queued';
    return jsonb_build_object('allowed', false, 'reason', 'spend_cap_reached', 'spent_micros', spent, 'cap_micros', cap);
  end if;
  update public.mova_messages set cost_micros = p_cost_micros where id = p_message_id and status = 'queued';
  if not found then raise exception using errcode = 'P0002', message = 'MESSAGE_NOT_QUEUED'; end if;
  return jsonb_build_object('allowed', true, 'spent_micros', spent + p_cost_micros, 'cap_micros', cap);
end $$;
revoke all on function public.mova_messaging_reserve_spend(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.mova_messaging_reserve_spend(uuid, bigint, timestamptz) to service_role;
