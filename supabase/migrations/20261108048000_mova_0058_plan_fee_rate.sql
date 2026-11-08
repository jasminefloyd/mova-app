-- O10 (Nov 8): the Mova fee follows the stylist's plan: Free 1.5%, Pro 1.0%, AI Growth 0.5%.
-- The fee is still snapshotted once on each processed payment (0044 locks it), so a plan change never
-- alters past payments. Stylists with no current plan, or a plan that is not active, pay the platform
-- rate from mova_current_platform_fee() (0044).
alter table public.mova_payments add column platform_fee_plan_key text references public.mova_plan_catalog(plan_key);

create or replace function public.mova_business_fee(p_artist_business_id uuid, p_at timestamptz default now())
returns table(fee_bps integer, platform_fee_version integer, plan_key text)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(plan.mova_fee_basis_points, platform.fee_bps),
         case when plan.mova_fee_basis_points is null then platform.version end,
         plan.plan_key
  from public.mova_current_platform_fee(p_at) as platform
  left join lateral (
    select c.plan_key, c.mova_fee_basis_points
    from public.mova_business_plan_assignments a
    join public.mova_plan_catalog c on c.plan_key = a.plan_key and c.status = 'active'
    where a.artist_business_id = p_artist_business_id and a.assignment_status = 'current'
  ) as plan on true;
$$;
revoke all on function public.mova_business_fee(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.mova_business_fee(uuid, timestamptz) to service_role;

create or replace function public.mova_payment_snapshot_platform_fee()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare active record;
begin
  if new.collector = 'mova_processed' and new.method in ('card_checkout', 'card_paylink_sms', 'card_paylink_qr', 'wallet_checkout') then
    select * into active from public.mova_business_fee(new.artist_business_id, coalesce(new.created_at, now()));
    if active.fee_bps is null then raise exception using errcode = '55000', message = 'PLATFORM_FEE_NOT_CONFIGURED'; end if;
    new.platform_fee_bps := active.fee_bps;
    new.platform_fee_version := active.platform_fee_version;
    new.platform_fee_plan_key := active.plan_key;
    new.platform_fee_minor := floor((new.amount_minor::numeric * active.fee_bps + 5000) / 10000)::bigint;
  else
    new.platform_fee_bps := 0;
    new.platform_fee_version := null;
    new.platform_fee_plan_key := null;
    new.platform_fee_minor := 0;
  end if;
  return new;
end $$;

-- The plan a fee came from is locked with the rest of the fee snapshot.
create or replace function public.mova_payment_fee_locked()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.platform_fee_bps is distinct from old.platform_fee_bps or new.platform_fee_minor is distinct from old.platform_fee_minor
    or new.platform_fee_version is distinct from old.platform_fee_version or new.platform_fee_plan_key is distinct from old.platform_fee_plan_key
    or new.amount_minor is distinct from old.amount_minor
    or new.collector is distinct from old.collector or new.method is distinct from old.method then
    raise exception using errcode = '42501', message = 'PAYMENT_FEE_LOCKED';
  end if;
  return new;
end $$;
