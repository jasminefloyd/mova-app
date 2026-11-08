-- Owner decision O10 (Nov 8): plan prices are confirmed — Free $0 + 1.5%, Pro $19 + 1.0%,
-- AI Growth $39 + 0.5% per Mova-processed payment. The catalog rows become active. Included features
-- are still to be decided, so entitlements keep their placeholder and the app does not list them.
update public.mova_plan_catalog set status = 'active', monthly_price_minor = 0, mova_fee_basis_points = 150, updated_at = now() where plan_key = 'free';
update public.mova_plan_catalog set status = 'active', monthly_price_minor = 1900, mova_fee_basis_points = 100, updated_at = now() where plan_key = 'pro';
update public.mova_plan_catalog set status = 'active', monthly_price_minor = 3900, mova_fee_basis_points = 50, updated_at = now() where plan_key = 'ai_growth';

-- Task 5.8: Stripe Billing (test mode) subscriptions. Price IDs live in Edge Function config
-- (MOVA_STRIPE_PRICE_PRO, MOVA_STRIPE_PRICE_AI_GROWTH), never in the browser or this table.
create table public.mova_billing_subscriptions (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  plan_key text not null references public.mova_plan_catalog(plan_key),
  stripe_customer_id text check (stripe_customer_id is null or stripe_customer_id like 'cus\_%'),
  stripe_subscription_id text unique check (stripe_subscription_id is null or stripe_subscription_id like 'sub\_%'),
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  livemode boolean not null default false check (livemode = false),
  updated_at timestamptz not null default now()
);
alter table public.mova_billing_subscriptions enable row level security;
revoke all on public.mova_billing_subscriptions from public, anon, authenticated;
grant select on public.mova_billing_subscriptions to authenticated;
grant all on public.mova_billing_subscriptions to service_role;
create policy mova_billing_subscriptions_member_select on public.mova_billing_subscriptions for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));

-- Applies a verified test-mode checkout: records the subscription and makes the plan current.
create or replace function public.mova_apply_plan_subscription(p_artist_business_id uuid, p_plan_key text, p_customer text, p_subscription text, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_plan_key not in ('pro', 'ai_growth') then raise exception using errcode = '22023', message = 'PLAN_INVALID'; end if;
  insert into public.mova_billing_subscriptions(artist_business_id, plan_key, stripe_customer_id, stripe_subscription_id, status)
  values (p_artist_business_id, p_plan_key, p_customer, p_subscription, p_status)
  on conflict (artist_business_id) do update set plan_key = excluded.plan_key, stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id, status = excluded.status, updated_at = now();
  insert into public.mova_business_plan_assignments(artist_business_id, plan_key, assignment_status)
  values (p_artist_business_id, case when p_status in ('active', 'trialing') then p_plan_key else 'free' end, 'current')
  on conflict (artist_business_id) do update set plan_key = excluded.plan_key, assignment_status = 'current', updated_at = now();
  return public.mova_plan_entitlement_summary(p_artist_business_id);
end $$;
revoke all on function public.mova_apply_plan_subscription(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.mova_apply_plan_subscription(uuid, text, text, text, text) to service_role;
