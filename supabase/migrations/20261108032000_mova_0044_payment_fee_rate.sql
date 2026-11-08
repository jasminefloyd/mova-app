-- Task 4.2: every processed payment keeps the Mova fee rate it was charged at.
-- mova_payments.platform_fee_bps already snapshots the rate on insert (0009). This migration:
--   * adds one accessor for the server-side setting (mova_platform_fee_versions) and uses it in the snapshot,
--   * records which fee version applied (platform_fee_version),
--   * locks the rate, fee and amount after insert, so a later rate change can never alter a past payment,
--   * backfills 150 bps (version 1) on any processed payment that predates the snapshot.

create or replace function public.mova_current_platform_fee(p_at timestamptz default now())
returns table(version integer, fee_bps integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.version, v.fee_bps from public.mova_platform_fee_versions v
  where v.effective_at <= coalesce(p_at, now()) order by v.effective_at desc, v.version desc limit 1;
$$;
revoke all on function public.mova_current_platform_fee(timestamptz) from public, anon, authenticated;
grant execute on function public.mova_current_platform_fee(timestamptz) to service_role;

alter table public.mova_payments add column platform_fee_version integer references public.mova_platform_fee_versions(version);

create or replace function public.mova_payment_snapshot_platform_fee()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare active record;
begin
  if new.collector = 'mova_processed' and new.method in ('card_checkout', 'card_paylink_sms', 'card_paylink_qr', 'wallet_checkout') then
    select * into active from public.mova_current_platform_fee(coalesce(new.created_at, now()));
    if active.fee_bps is null then raise exception using errcode = '55000', message = 'PLATFORM_FEE_NOT_CONFIGURED'; end if;
    new.platform_fee_bps := active.fee_bps;
    new.platform_fee_version := active.version;
    new.platform_fee_minor := floor((new.amount_minor::numeric * active.fee_bps + 5000) / 10000)::bigint;
  else
    new.platform_fee_bps := 0;
    new.platform_fee_version := null;
    new.platform_fee_minor := 0;
  end if;
  return new;
end $$;

-- Backfill before the lock exists. Only rows whose stored fee already equals 1.5% are touched, so no
-- ledger amount changes.
update public.mova_payments p set platform_fee_bps = 150, platform_fee_version = 1
where p.collector = 'mova_processed' and p.platform_fee_bps = 0
  and p.platform_fee_minor = floor((p.amount_minor::numeric * 150 + 5000) / 10000)::bigint;
update public.mova_payments p set platform_fee_version = v.version
from public.mova_platform_fee_versions v
where p.platform_fee_version is null and p.collector = 'mova_processed' and p.platform_fee_bps > 0 and v.fee_bps = p.platform_fee_bps
  and v.version = (select max(v2.version) from public.mova_platform_fee_versions v2 where v2.fee_bps = p.platform_fee_bps and v2.effective_at <= p.created_at);

create or replace function public.mova_payment_fee_locked()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.platform_fee_bps is distinct from old.platform_fee_bps or new.platform_fee_minor is distinct from old.platform_fee_minor
    or new.platform_fee_version is distinct from old.platform_fee_version or new.amount_minor is distinct from old.amount_minor
    or new.collector is distinct from old.collector or new.method is distinct from old.method then
    raise exception using errcode = '42501', message = 'PAYMENT_FEE_LOCKED';
  end if;
  return new;
end $$;
revoke all on function public.mova_payment_fee_locked() from public, anon, authenticated;
create trigger mova_payments_fee_locked before update on public.mova_payments for each row execute function public.mova_payment_fee_locked();
