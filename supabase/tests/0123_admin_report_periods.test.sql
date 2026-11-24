begin;
select plan(12);

insert into auth.users(id, email) values
  ('ad123000-0000-4000-8000-000000000001', 'period-admin@mova.invalid'),
  ('ad123000-0000-4000-8000-000000000002', 'period-stylist@mova.invalid');
select public.mova_grant_platform_admin('ad123000-0000-4000-8000-000000000001', 'Period Admin');

insert into public.mova_artist_businesses(name, created_at) values
  ('New today', now() - interval '12 hours'),
  ('New ten days ago', now() - interval '10 days'),
  ('New twenty days ago', now() - interval '20 days');

insert into public.mova_discovery_visits(id, started_at, landing_path, channel, source, medium, campaign) values
  ('ad123000-0000-4000-8000-000000000010', now() - interval '12 hours', '/', 'direct / unknown', '', '', ''),
  ('ad123000-0000-4000-8000-000000000011', now() - interval '10 days', '/', 'direct / unknown', '', '', ''),
  ('ad123000-0000-4000-8000-000000000012', now() - interval '20 days', '/', 'direct / unknown', '', '', '');

insert into public.mova_billing_events(stripe_event_id, type, livemode, received_at, processed_at) values
  ('evt_period_today', 'invoice.payment_failed', true, now() - interval '12 hours', now()),
  ('evt_period_ten', 'invoice.payment_failed', true, now() - interval '10 days', now()),
  ('evt_period_twenty', 'invoice.payment_failed', true, now() - interval '20 days', now());

select set_config('request.jwt.claims', '{"sub":"ad123000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.mova_admin_overview_for_period('14d')$$,
  '42501', 'PLATFORM_ADMIN_REQUIRED', 'Overview requires a platform admin');
select throws_ok($$select public.mova_admin_subscription_summary_for_period('14d')$$,
  '42501', 'PLATFORM_ADMIN_REQUIRED', 'Subscription reports require a platform admin');
reset role;

select set_config('request.jwt.claims', '{"sub":"ad123000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.mova_admin_website_traffic('14d') #>> '{current,sessions}', '2', 'Discovery includes sessions in the last 14 days');
select is(public.mova_admin_website_traffic('14d') #>> '{prior,sessions}', '1', 'Discovery uses an equal-length prior period');
select is(public.mova_admin_overview_for_period('14d') #>> '{current,new_signups}', '2', 'Overview includes signups in the last 14 days');
select is(public.mova_admin_overview_for_period('14d') #>> '{prior,new_signups}', '1', 'Overview uses an equal-length prior period');
select is(public.mova_admin_overview_for_period('24h') #>> '{current,new_signups}', '1', 'Overview uses a rolling 24 hours');
select is(public.mova_admin_subscription_summary_for_period('14d') #>> '{billing_events,payment_failures}', '2', 'Billing failures use the selected period');

select is(public.mova_admin_website_traffic('custom', (now() at time zone 'UTC')::date - 10, (now() at time zone 'UTC')::date - 10) #>> '{current,sessions}',
  '1', 'Discovery includes the entire selected UTC date');
select is(public.mova_admin_overview_for_period('custom', (now() at time zone 'UTC')::date - 10, (now() at time zone 'UTC')::date - 10) #>> '{current,new_signups}',
  '1', 'Overview applies both custom date bounds');
select is(public.mova_admin_subscription_summary_for_period('custom', (now() at time zone 'UTC')::date - 10, (now() at time zone 'UTC')::date - 10) #>> '{billing_events,payment_failures}',
  '1', 'Billing excludes events after the end of a custom period');
select throws_ok($$select public.mova_admin_overview_for_period('custom', current_date, current_date + 2)$$,
  '22023', 'TRAFFIC_DATE_RANGE_INVALID', 'Custom ranges cannot end in the future');

select * from finish();
rollback;
