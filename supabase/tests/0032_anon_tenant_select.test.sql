begin;
select plan(11);

select ok(not has_table_privilege('anon', 'public.mova_artist_profiles', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select artist profiles');
select ok(not has_table_privilege('anon', 'public.mova_services', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select services');
select ok(not has_table_privilege('anon', 'public.mova_service_locations', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select service locations');
select ok(not has_table_privilege('anon', 'public.mova_locations', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select locations');
select ok(not has_table_privilege('anon', 'public.mova_location_hours', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select location hours');
select ok(not has_table_privilege('anon', 'public.mova_location_exceptions', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select location exceptions');
select ok(not has_table_privilege('anon', 'public.mova_location_policies', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select location policies');
select ok(not has_table_privilege('anon', 'public.mova_availability_blocks', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select availability blocks');
select ok(not has_table_privilege('anon', 'public.mova_portfolio_items', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select portfolio items');
select ok(not has_table_privilege('anon', 'public.mova_portfolio_service_links', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select portfolio service links');
select ok(not has_table_privilege('anon', 'public.mova_onboarding_progress', 'SELECT'), 'TC-RLS-TENANTCFG-ANON: anon cannot select onboarding progress');

select * from finish();
rollback;
