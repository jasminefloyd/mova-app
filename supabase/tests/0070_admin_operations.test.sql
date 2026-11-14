begin;
select plan(30);

insert into auth.users (id, email) values
  ('ad700000-0000-4000-8000-000000000001', 'ops-admin@mova.invalid'),
  ('ad700000-0000-4000-8000-000000000002', 'ops-stylist@mova.invalid');
select public.mova_grant_platform_admin('ad700000-0000-4000-8000-000000000001', 'Ops Admin');
insert into public.mova_artist_businesses (id, name, status) values
  ('ad700000-0000-4000-8000-000000000101', 'Glow Theory', 'active');
insert into public.mova_artist_profiles (artist_business_id, display_name, handle, specialties, is_published, published_at) values
  ('ad700000-0000-4000-8000-000000000101', 'Keisha Grant', 'glow-theory', '{Silk}', true, now() - interval '5 days');
insert into public.mova_support_messages (id, artist_business_id, user_id, type, message)
values ('ad700000-0000-4000-8000-000000000201', 'ad700000-0000-4000-8000-000000000101', 'ad700000-0000-4000-8000-000000000002', 'idea', 'Deposits for regulars only?');

-- Stylist cannot use the admin writes.
select set_config('request.jwt.claims', '{"sub":"ad700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.mova_admin_fees_overview()$$, '42501', 'PLATFORM_ADMIN_REQUIRED', 'stylists cannot read fees');
select throws_ok($$select public.mova_admin_set_platform_switch('zelle', true, 'Trying to turn it on')$$, '42501', 'PLATFORM_ADMIN_REQUIRED', 'stylists cannot change switches');
reset role;

select ok(not has_function_privilege('anon', 'public.mova_admin_set_stylist_fee(uuid,integer,date,date,text,boolean)', 'EXECUTE'), 'anonymous users cannot set a stylist fee');
select ok(has_function_privilege('authenticated', 'public.mova_admin_set_stylist_fee(uuid,integer,date,date,text,boolean)', 'EXECUTE'), 'signed-in users can reach the fee setter, which checks the admin role itself');

select set_config('request.jwt.claims', '{"sub":"ad700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- Fees.
select is((select (public.mova_admin_fees_overview() -> 'platform' ->> 'fee_bps')::int), 150, 'the platform default starts at 1.5%');
select lives_ok(
  $$select public.mova_admin_set_stylist_fee('ad700000-0000-4000-8000-000000000101', 100, (now() at time zone 'America/New_York')::date, null, 'Founding stylist pricing', true)$$,
  'an admin can set a stylist rate starting today'
);
select throws_ok($$select public.mova_admin_set_stylist_fee('ad700000-0000-4000-8000-000000000101', 400, (now() at time zone 'America/New_York')::date, null, 'Too high a rate', true)$$, '22023', 'FEE_OUT_OF_RANGE', 'rates above 3% are refused');
select throws_ok($$select public.mova_admin_set_stylist_fee('ad700000-0000-4000-8000-000000000101', 100, (now() at time zone 'America/New_York')::date, null, 'no', true)$$, '22023', 'REASON_REQUIRED', 'a short reason is refused');
select throws_ok($$select public.mova_admin_set_stylist_fee('ad700000-0000-4000-8000-000000000101', 100, '2020-01-01', null, 'Backdated change', true)$$, '22023', 'START_IN_PAST', 'a start date in the past is refused');
select throws_ok($$select public.mova_admin_set_stylist_fee('ad700000-0000-4000-8000-000000000101', 100, (now() at time zone 'America/New_York')::date + 5, (now() at time zone 'America/New_York')::date + 2, 'Backwards window', true)$$, '22023', 'END_BEFORE_START', 'an end before the start is refused');
select lives_ok(
  $$select public.mova_admin_set_platform_fee(175, now(), 'Raise the default for new plans')$$,
  'an admin can change the platform default'
);
select is((select (public.mova_admin_fees_overview() -> 'platform' ->> 'fee_bps')::int), 175, 'the new platform default is in effect');
select is((select (public.mova_admin_fees_overview() -> 'history')::text like '%fee.stylist_rate_set%'), true, 'fee changes appear in the history');

-- Switches.
select is((select jsonb_array_length(public.mova_admin_switches())), 11, 'eleven platform switches are listed (0070 base, 0087 marketing)');
select lives_ok($$select public.mova_admin_set_platform_switch('zelle', true, 'Turn on recorded Zelle for the pilot')$$, 'an admin can turn a switch on with a reason');
select throws_ok($$select public.mova_admin_set_platform_switch('tap_to_pay', true, 'Turn on tap to pay now')$$, '55000', 'SWITCH_NOT_BUILT', 'tap to pay cannot be turned on yet');
select throws_ok($$select public.mova_admin_set_platform_switch('autopilot', false, 'no')$$, '22023', 'REASON_REQUIRED', 'a switch change needs a reason');
select throws_ok($$select public.mova_admin_set_platform_switch('everything', false, 'Turn it all off please')$$, '22023', 'SWITCH_INVALID', 'unknown switches are refused');
select is((select (public.mova_admin_switches() -> 0 ->> 'key')), 'autopilot', 'switches are listed by key');

-- Stylist page.
select lives_ok($$select public.mova_admin_unpublish_page('ad700000-0000-4000-8000-000000000101', 'Page shows a disputed claim')$$, 'an admin can unpublish a page with a reason');

-- Stylist page.
select lives_ok($$select public.mova_admin_unpublish_page('ad700000-0000-4000-8000-000000000101', 'Page shows a disputed claim')$$, 'an admin can unpublish a page with a reason');

-- Support inbox.
select is((select (public.mova_admin_support_list() -> 'counts' ->> 'new')::int), 1, 'the new message is counted');
select lives_ok(
  $$select public.mova_admin_support_reply('ad700000-0000-4000-8000-000000000201', 'Thanks, we will look at deposits for regulars.', false)$$,
  'an admin can reply to a message'
);
select lives_ok($$select public.mova_admin_support_set_status('ad700000-0000-4000-8000-000000000201', 'resolved')$$, 'an admin can close a message');
select throws_ok($$select public.mova_admin_support_set_status('ad700000-0000-4000-8000-000000000201', 'archived')$$, '22023', 'SUPPORT_STATUS_INVALID', 'unknown statuses are refused');
select throws_ok($$select public.mova_admin_support_reply('ad700000-0000-4000-8000-000000000201', '   ', false)$$, '22023', 'REPLY_INVALID', 'an empty reply is refused');
reset role;

select is((select status from public.mova_support_messages where id = 'ad700000-0000-4000-8000-000000000201'), 'resolved', 'the closed message is resolved');
select is((select delivery from public.mova_support_replies where support_message_id = 'ad700000-0000-4000-8000-000000000201' limit 1), 'not_sent', 'replies are stored as not sent until email is connected');
select is((select is_published from public.mova_artist_profiles where artist_business_id = 'ad700000-0000-4000-8000-000000000101'), false, 'the page is unpublished');
select is((select fee_bps from public.mova_business_fee('ad700000-0000-4000-8000-000000000101')), 100, 'a stylist override wins over the platform default');

select * from finish();
rollback;
