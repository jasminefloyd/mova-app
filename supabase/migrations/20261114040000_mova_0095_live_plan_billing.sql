-- Pro and AI + Growth subscriptions are sold from the platform's live Stripe account.
-- Keep this mode separate from test-only stylist deposits, pay links and Connect operations.

alter table public.mova_billing_subscriptions
  drop constraint if exists mova_billing_subscriptions_livemode_check;

revoke all on function public.mova_apply_plan_subscription(uuid, text, text, text, text) from public, anon, authenticated;
drop function public.mova_apply_plan_subscription(uuid, text, text, text, text);

create function public.mova_apply_plan_subscription(
  p_artist_business_id uuid,
  p_plan_key text,
  p_customer text,
  p_subscription text,
  p_status text,
  p_livemode boolean
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_plan_key not in ('pro', 'ai_growth') then raise exception using errcode = '22023', message = 'PLAN_INVALID'; end if;
  if p_status not in ('active', 'trialing', 'past_due', 'canceled', 'incomplete') then raise exception using errcode = '22023', message = 'SUBSCRIPTION_STATUS_INVALID'; end if;
  insert into public.mova_billing_subscriptions(artist_business_id, plan_key, stripe_customer_id, stripe_subscription_id, status, livemode)
  values (p_artist_business_id, p_plan_key, p_customer, p_subscription, p_status, p_livemode)
  on conflict (artist_business_id) do update set plan_key = excluded.plan_key, stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id, status = excluded.status, livemode = excluded.livemode, updated_at = now();
  insert into public.mova_business_plan_assignments(artist_business_id, plan_key, assignment_status)
  values (p_artist_business_id, case when p_status in ('active', 'trialing') then p_plan_key else 'free' end, 'current')
  on conflict (artist_business_id) do update set plan_key = excluded.plan_key, assignment_status = 'current', updated_at = now();
  return public.mova_plan_entitlement_summary(p_artist_business_id);
end $$;
revoke all on function public.mova_apply_plan_subscription(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mova_apply_plan_subscription(uuid, text, text, text, text, boolean) to service_role;
