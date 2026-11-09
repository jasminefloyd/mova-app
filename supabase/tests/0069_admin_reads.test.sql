begin;
select plan(16);

insert into auth.users (id, email) values
  ('ad690000-0000-4000-8000-000000000001', 'reads-admin@mova.invalid'),
  ('ad690000-0000-4000-8000-000000000002', 'reads-stylist@mova.invalid');
select public.mova_grant_platform_admin('ad690000-0000-4000-8000-000000000001', 'Reads Admin');

insert into public.mova_artist_businesses (id, name, status) values
  ('ad690000-0000-4000-8000-000000000101', 'Rooted Beauty', 'active'),
  ('ad690000-0000-4000-8000-000000000102', 'Crown and Coil', 'active');
insert into public.mova_artist_profiles (artist_business_id, display_name, handle, specialties, is_published) values
  ('ad690000-0000-4000-8000-000000000101', 'Ari Monroe', 'rooted-beauty', '{Braids}', false),
  ('ad690000-0000-4000-8000-000000000102', 'Dani Reyes', 'crown-and-coil', '{Locs}', true);
insert into public.mova_artist_memberships (artist_business_id, user_id, role, status) values
  ('ad690000-0000-4000-8000-000000000101', 'ad690000-0000-4000-8000-000000000002', 'owner', 'active');
insert into public.mova_security_audit_events (artist_business_id, event_type, object_type, object_id)
values ('ad690000-0000-4000-8000-000000000101', 'settings.profile_updated', 'artist_profile', 'ad690000-0000-4000-8000-000000000101');

-- Business numbers are sequential in a fresh database: 101 is BID-1 and 102 is BID-2.
select is((select business_number::int from public.mova_artist_businesses where id = 'ad690000-0000-4000-8000-000000000102'), 2, 'the second stylist is BID-2');

-- Stylists cannot read the admin reads.
select set_config('request.jwt.claims', '{"sub":"ad690000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.mova_admin_overview()$$, '42501', 'PLATFORM_ADMIN_REQUIRED', 'stylists cannot read the overview');
select throws_ok($$select public.mova_admin_stylists()$$, '42501', 'PLATFORM_ADMIN_REQUIRED', 'stylists cannot list stylists');
reset role;

-- Admin.
select set_config('request.jwt.claims', '{"sub":"ad690000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(public.mova_admin_overview() ? 'funnel' and public.mova_admin_overview() ? 'current', 'the overview returns the funnel and the current window');
select is((select (public.mova_admin_overview() -> 'funnel' ->> 'published_page')::int), 1, 'the funnel counts published pages');
select is((select (public.mova_admin_stylists() -> 'counts' ->> 'all')::int), 2, 'the stylist list counts every stylist');
select is((select (public.mova_admin_stylists('onboarding') -> 'total')::int), 1, 'an unpublished stylist with no bookings is onboarding');
select is((select (public.mova_admin_stylists('all', 'BID-2') -> 'total')::int), 1, 'search finds a stylist by BID');
select throws_ok($$select public.mova_admin_stylists('everyone')$$, '22023', 'STYLIST_FILTER_INVALID', 'unknown stylist filters are refused');
select is((select public.mova_admin_stylist_detail('ad690000-0000-4000-8000-000000000101') -> 'owner_email' #>> '{}'), 'reads-stylist@mova.invalid', 'the stylist detail shows the owner account');
select throws_ok($$select public.mova_admin_stylist_detail('ad690000-0000-4000-8000-00000000ffff')$$, 'P0002', 'BUSINESS_NOT_FOUND', 'an unknown stylist is refused');
select is((select jsonb_array_length(public.mova_admin_audit_events('ad690000-0000-4000-8000-000000000101') -> 'events')), 2, 'the audit log lists the stylist events, including the admin view');
select is((select jsonb_array_length(public.mova_admin_audit_events('ad690000-0000-4000-8000-000000000101', null, null, 'payments') -> 'events')), 0, 'the payments filter excludes settings events');
select throws_ok($$select public.mova_admin_audit_events('ad690000-0000-4000-8000-000000000101', null, null, 'everything')$$, '22023', 'AUDIT_CATEGORY_INVALID', 'unknown audit categories are refused');
select lives_ok($$select public.mova_admin_log_audit_export('ad690000-0000-4000-8000-000000000101', 1, false)$$, 'exporting an audit log is allowed for admins');
reset role;
select ok((select count(*) from public.mova_admin_activity where action = 'stylist.viewed') >= 1 and (select count(*) from public.mova_admin_activity where action = 'audit.exported') >= 1, 'viewing and exporting are logged');

select * from finish();
rollback;
