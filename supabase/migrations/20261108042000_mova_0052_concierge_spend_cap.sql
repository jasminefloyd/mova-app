-- Owner decision O8 (Nov 8): a platform-wide hard cap on concierge model spend, $25 per calendar month
-- (UTC). When it is reached every channel hands the conversation to the stylist instead of calling a
-- model. The cap can be lowered or raised with the server setting mova.ai_monthly_cap_micros.
create or replace function public.mova_concierge_month_spend()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'spent_micros', coalesce((select sum(cost_micros) from public.mova_concierge_turns
      where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'), 0),
    'cap_micros', coalesce(nullif(current_setting('mova.ai_monthly_cap_micros', true), '')::bigint, 25000000)
  );
$$;

revoke all on function public.mova_concierge_month_spend() from public, anon, authenticated;
grant execute on function public.mova_concierge_month_spend() to service_role;
