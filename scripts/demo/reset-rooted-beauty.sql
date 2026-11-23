-- Run as the first part of the Rooted Beauty reset transaction with demo seed SQL.
-- The release runner checks the target and applies the reset and seed atomically.
do $reset$
declare
  target constant uuid := 'e2500000-0000-4000-8000-000000000001';
begin
  perform pg_advisory_xact_lock(hashtextextended('mova:rooted-beauty-demo-reset', 0));
  perform 1 from public.mova_artist_businesses b
    join public.mova_artist_profiles p on p.artist_business_id = b.id
    where b.id = target and b.business_number = 1 and b.name = 'Rooted Beauty'
      and b.status = 'active' and p.handle = 'rooted-beauty'
    for update of b;
  if not found then raise exception 'Rooted Beauty demo identity does not match'; end if;

  if (select count(*) from public.mova_artist_memberships where artist_business_id = target and role = 'owner' and status = 'active') <> 1
    or not exists (
      select 1 from public.mova_artist_memberships m join auth.users u on u.id = m.user_id
      where m.artist_business_id = target and m.role = 'owner' and m.status = 'active'
        and u.email_confirmed_at is not null and u.deleted_at is null
    ) then
    raise exception 'Rooted Beauty demo owner does not match';
  end if;

  if exists (select 1 from public.mova_billing_subscriptions where artist_business_id = target)
    or exists (select 1 from public.mova_stripe_connections where artist_business_id = target and stripe_account_id is not null)
    or exists (select 1 from public.mova_payments where artist_business_id = target and (provider is not null or idempotency_key not like 'rooted-demo-payment-%'))
    or exists (select 1 from public.mova_payment_refunds where artist_business_id = target)
    or exists (
      select 1 from public.mova_payment_ledger l
      where l.artist_business_id = target and (
        l.category not in ('service_value', 'recorded_artist', 'collected_salon')
        or (l.payment_id is null and l.category <> 'service_value')
        or (l.payment_id is not null and not exists (
          select 1 from public.mova_payments p where p.id = l.payment_id and p.artist_business_id = target
            and p.provider is null and p.idempotency_key like 'rooted-demo-payment-%'
        ))
      )
    ) then
    raise exception 'Reset refused because the tenant has protected billing or payment data';
  end if;

  if exists (select 1 from public.mova_background_jobs where artist_business_id = target and status in ('running', 'queued', 'failed')) then
    raise exception 'Rooted Beauty has pending jobs. Allow them to finish before resetting.';
  end if;

  -- Delete work history in foreign-key order. Account identities and shared
  -- customer identities are not deleted. Tenant-owned links cascade.
  delete from public.mova_background_jobs where artist_business_id = target;
  delete from public.mova_outbox_events where artist_business_id = target;
  delete from public.mova_notification_inbox where artist_business_id = target;
  delete from public.mova_messages where artist_business_id = target;
  delete from public.mova_conversations where artist_business_id = target;
  delete from public.mova_concierge_knowledge where artist_business_id = target;
  delete from public.mova_slot_events where artist_business_id = target;
  delete from public.mova_social_share_events where artist_business_id = target;
  delete from public.mova_autopilot_decisions where artist_business_id = target;
  delete from public.mova_growth_opportunities where artist_business_id = target;
  delete from public.mova_forecasts where artist_business_id = target;
  delete from public.mova_marketing_campaigns where artist_business_id = target;
  delete from public.mova_profile_traffic_events where artist_business_id = target;
  delete from public.mova_reports_daily_rollups where artist_business_id = target;
  delete from public.mova_google_reviews where artist_business_id = target;
  delete from public.mova_availability_blocks where artist_business_id = target;
  delete from public.mova_location_exceptions where artist_business_id = target;
  delete from public.mova_client_import_batches where artist_business_id = target;
  delete from public.mova_price_pilot_observations where artist_business_id = target;
  delete from public.mova_price_pilot_sources where artist_business_id = target;
  delete from public.mova_price_pilot_usage where artist_business_id = target;
  delete from public.mova_usage_meter_events where artist_business_id = target;

  -- PostgreSQL holds the ledger DDL lock until commit. Restore the immutable
  -- trigger immediately after the tenant-filtered delete and before seeding.
  alter table public.mova_payment_ledger disable trigger mova_payment_ledger_immutable_trigger;
  delete from public.mova_payment_ledger where artist_business_id = target;
  alter table public.mova_payment_ledger enable trigger mova_payment_ledger_immutable_trigger;
  delete from public.mova_appointments where artist_business_id = target;
  delete from public.mova_clients where artist_business_id = target;
end
$reset$;
