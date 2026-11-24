begin;
select plan(20);

select public.mova_record_discovery_event('ad119000-0000-4000-8000-000000000001', 'ad119000-0000-4000-8000-000000000011',
  '/calculator','/calculator','paid search','google','cpc','november',false);
select public.mova_record_discovery_event('ad119000-0000-4000-8000-000000000001', 'ad119000-0000-4000-8000-000000000011',
  '/calculator','/calculator','paid search','google','cpc','november',false);
select public.mova_record_discovery_event('ad119000-0000-4000-8000-000000000001', 'ad119000-0000-4000-8000-000000000012',
  '/calculator','/calculator','paid search','google','cpc','november',true);
select public.mova_record_discovery_event('ad119000-0000-4000-8000-000000000001', 'ad119000-0000-4000-8000-000000000013',
  '/signup','/signup','direct / unknown','','','',false);
update public.mova_discovery_visits set started_at = now() - interval '1 day';
update public.mova_discovery_page_views set viewed_at = now() - interval '1 day';
insert into public.mova_calculator_funnel_daily (day,event,total)
values ((now() at time zone 'UTC')::date - 1, 'calculator_used', 4);

insert into auth.users(id,email,created_at,raw_user_meta_data) values (
  'ad119000-0000-4000-8000-000000000101','discover@mova.invalid',now()-interval '23 hours',
  '{"first_name":"Test","last_name":"Stylist","mova_discovery_visit":"ad119000-0000-4000-8000-000000000001"}'
), (
  'ad119000-0000-4000-8000-000000000102','no-business@mova.invalid',now()-interval '22 hours',
  '{"first_name":"Test","last_name":"Onboarding"}'
), ('ad119000-0000-4000-8000-000000000103','admin@mova.invalid',now(),'{}');
select public.mova_grant_platform_admin('ad119000-0000-4000-8000-000000000103','Discovery Admin');
select is((select signups from public.mova_discovery_visits), 0, 'an email-code request alone is no conversion');
update auth.users set email_confirmed_at = now()-interval '20 hours' where email in ('discover@mova.invalid','no-business@mova.invalid');
update auth.users set email_confirmed_at = now()-interval '20 hours' where email='discover@mova.invalid';
select is((select signups from public.mova_discovery_visits), 1, 'the first verified signup counts once');
select is((select count(*) from public.mova_discovery_page_views), 2::bigint, 'replayed view ID is deduplicated');

insert into public.mova_artist_businesses (id,name,status) values
  ('ad119000-0000-4000-8000-000000000201','Live studio','active'),
  ('ad119000-0000-4000-8000-000000000202','Sandbox studio','active'),
  ('ad119000-0000-4000-8000-000000000203','Trial studio','active');
insert into public.mova_artist_memberships (artist_business_id,user_id,role,status) values
  ('ad119000-0000-4000-8000-000000000201','ad119000-0000-4000-8000-000000000101','owner','active');
insert into public.mova_artist_profiles (artist_business_id,display_name,handle,specialties,is_published,published_at)
values ('ad119000-0000-4000-8000-000000000201','Discover stylist','discover-stylist','{Styling}',true,now()-interval '16 hours');
insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
values ('ad119000-0000-4000-8000-000000000301','ad119000-0000-4000-8000-000000000201','Studio','suite','instant','mova','artist','UTC');
insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,base_price_minor,status)
values ('ad119000-0000-4000-8000-000000000302','ad119000-0000-4000-8000-000000000201','Style','Styling',60,10000,'active');
insert into public.mova_appointments(id,artist_business_id,location_id,service_id,source,status,starts_at,ends_at,
  service_name_snapshot,service_price_minor,client_name,manage_token_hash,idempotency_key,created_at)
select ('ad119000-0000-4000-8000-00000000040'||n)::uuid,
  'ad119000-0000-4000-8000-000000000201','ad119000-0000-4000-8000-000000000301','ad119000-0000-4000-8000-000000000302',
  'artist', status, now()+starts, now()+starts+interval '1 hour','Style',10000,'Fixture Client',
  decode(md5(n::text),'hex'),'discovery-'||n,now()+created
from (values
  (1,'completed',interval '-4 hours',interval '-12 hours'),
  (2,'no_show',interval '-8 hours',interval '-40 days'),
  (3,'confirmed',interval '2 days',interval '-10 hours'),
  (4,'cancelled',interval '-10 hours',interval '-15 hours')
) data(n,status,starts,created);
insert into public.mova_appointment_events (artist_business_id,appointment_id,from_status,to_status,actor_type,idempotency_key,occurred_at)
values ('ad119000-0000-4000-8000-000000000201','ad119000-0000-4000-8000-000000000401','confirmed','completed','artist','discovery-complete',now()-interval '3 hours');
insert into public.mova_billing_subscriptions (artist_business_id,plan_key,stripe_subscription_id,status,livemode,trial_end)
values ('ad119000-0000-4000-8000-000000000201','pro','sub_discovery_live','active',true,null),
  ('ad119000-0000-4000-8000-000000000202','ai_growth','sub_discovery_test','active',false,null),
  ('ad119000-0000-4000-8000-000000000203','ai_growth','sub_discovery_trial','trialing',true,now()+interval '4 days');
insert into public.mova_plan_trials (artist_business_id,user_id,stripe_subscription_id,started_at,converted_at)
values ('ad119000-0000-4000-8000-000000000201','ad119000-0000-4000-8000-000000000101','sub_discovery_live',now()-interval '31 days',now()-interval '2 days');
insert into public.mova_billing_events (stripe_event_id,type,livemode,processed_at)
values ('evt_discovery_fail','invoice.payment_failed',true,now()),
  ('evt_discovery_test','invoice.payment_failed',false,now()),
  ('evt_discovery_cancel','customer.subscription.deleted',true,now());

select ok(not has_function_privilege('anon','public.mova_admin_discovery()','EXECUTE'), 'anonymous users cannot read discovery');
select ok(not has_table_privilege('authenticated','public.mova_discovery_visits','SELECT'), 'authenticated visitors cannot read raw visits');
select set_config('request.jwt.claims','{"sub":"ad119000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok('select public.mova_admin_discovery()', '42501', 'PLATFORM_ADMIN_REQUIRED', 'a stylist cannot view discovery');
reset role;
select set_config('request.jwt.claims','{"sub":"ad119000-0000-4000-8000-000000000103","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(public.mova_admin_discovery() #>> '{current,visits}', '1', 'one attributable website visit');
select is(public.mova_admin_discovery() #>> '{current,signups}', '1', 'one verified signup reported');
select is(public.mova_admin_discovery() #>> '{current,signup_clicks}', '1', 'CTA attributed to the visit');
select ok(public.mova_admin_discovery()->'breakdown' @> '[{"kind":"campaign","campaign":"november","signups":1}]', 'campaign persists from landing to verified signup');
select is(public.mova_admin_discovery() #>> '{calculator,used}', '4', 'existing calculator counter is included');
select is(public.mova_admin_activation() #>> '{0,verified}', '2', 'verified cohort includes signups without a business');
select is(public.mova_admin_activation() #>> '{0,published}', '1', 'first publication counted');
select is(public.mova_admin_activation() #>> '{0,completed}', '1', 'first completed visit counted');
select is(public.mova_admin_overview() #>> '{current,appointments_due}', '2', 'denominator uses eligible start dates, not booking dates');
select is(public.mova_admin_overview() #>> '{current,no_shows}', '1', 'no-show belongs to the same occurrence window');
select is(public.mova_admin_subscription_summary() ->> 'mrr_minor', '1900', 'only active live subscriptions contribute to list-price MRR');
select is(public.mova_admin_subscription_summary() ->> 'expiring_trials', '1', 'trial expires in seven days');
select is(public.mova_admin_subscription_summary() #>> '{billing_events,payment_failures}', '1', 'sandbox invoice failure is excluded');
select is(public.mova_admin_subscription_summary() ->> 'trials_converted', '1', 'resolved trial converts to paid');
select * from finish();
rollback;
