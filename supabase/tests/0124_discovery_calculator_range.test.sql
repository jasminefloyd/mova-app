begin;
select plan(10);

insert into auth.users(id, email) values ('ad124000-0000-4000-8000-000000000001', 'calculator-admin@mova.invalid');
select public.mova_grant_platform_admin('ad124000-0000-4000-8000-000000000001', 'Calculator Admin');

-- Older daily counts cannot be allocated within the day. A short historical
-- range must also exclude timestamped events immediately outside its bounds.
insert into public.mova_calculator_funnel_daily(day, event, total)
values ('2026-01-01', 'calculator_used', 5), ('2026-01-02', 'calculator_used', 7);
insert into public.mova_calculator_funnel_events(recorded_at, event, total) values
  ('2026-01-01 11:59:59+00', 'calculator_used', 2),
  ('2026-01-01 12:00+00', 'calculator_used', 3),
  ('2026-01-02 11:59:59+00', 'start_free_clicked', 2),
  ('2026-01-02 12:00+00', 'signup_completed', 4);

select is(public.mova_calculator_funnel_for_period('2026-01-01 12:00+00', '2026-01-02 12:00+00'),
  '{"used":3,"signup_clicks":2,"signups":0,"partial_history":true}'::jsonb,
  'An exact interval uses its start and end and flags excluded partial days');
select is(public.mova_calculator_funnel_for_period('2026-01-01 00:00+00', '2026-01-03 00:00+00'),
  '{"used":17,"signup_clicks":2,"signups":4,"partial_history":false}'::jsonb,
  'A full-day interval preserves legacy counts');

set local role service_role;
select public.mova_record_calculator_event('calculator_used');
select public.mova_record_calculator_event('calculator_used');
select public.mova_record_calculator_event('start_free_clicked');
reset role;
select is((select total from public.mova_calculator_funnel_daily
  where event = 'calculator_used' and day = (now() at time zone 'UTC')::date), 2::bigint,
  'Existing daily readers still receive new events');
select is((select total from public.mova_calculator_funnel_events
  where event = 'calculator_used' and recorded_at = now()), 2::bigint,
  'Multiple events at one timestamp are counted');
select ok(not has_table_privilege('authenticated', 'public.mova_calculator_funnel_events', 'SELECT'), 'Authenticated callers cannot inspect timestamped counts');
select ok(not has_table_privilege('anon', 'public.mova_calculator_funnel_events', 'SELECT'), 'Anonymous callers cannot inspect timestamped counts');
select ok(not has_function_privilege('authenticated', 'public.mova_calculator_funnel_for_period(timestamptz,timestamptz)', 'EXECUTE'),
  'Calculator aggregates are exposed only through the authorized report');

insert into public.mova_calculator_funnel_events(recorded_at, event, total)
values (now() - interval '25 hours', 'signup_completed', 1);

select set_config('request.jwt.claims', '{"sub":"ad124000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.mova_admin_website_traffic('24h')->'calculator',
  '{"used":2,"signup_clicks":1,"signups":0,"partial_history":false}'::jsonb,
  'The Discovery report excludes 25-hour-old activity without double counting new events');
select is(public.mova_admin_website_traffic('7d') #>> '{calculator,signups}', '1', 'A wider Discovery range includes the older activity');
select is(public.mova_admin_website_traffic('custom', '2026-01-02', '2026-01-02')->'calculator',
  '{"used":7,"signup_clicks":2,"signups":4,"partial_history":false}'::jsonb,
  'An inclusive custom day combines legacy and timestamped counts');

select * from finish();
rollback;
