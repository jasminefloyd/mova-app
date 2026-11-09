begin;
select plan(17);

insert into auth.users (id, email) values
  ('ad660000-0000-4000-8000-000000000001', 'staff-admin@mova.invalid'),
  ('ad660000-0000-4000-8000-000000000002', 'stylist-owner@mova.invalid');
select public.mova_grant_platform_admin('ad660000-0000-4000-8000-000000000001', 'Test Admin');

select has_table('public'::name, 'mova_platform_admins'::name);
select ok((select relrowsecurity from pg_class where oid = 'public.mova_platform_admins'::regclass), 'admin roster has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.mova_admin_activity'::regclass), 'admin activity has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.mova_platform_admins', 'SELECT'), 'authenticated users cannot read the admin roster');
select ok(not has_table_privilege('anon', 'public.mova_admin_activity', 'SELECT'), 'anonymous users cannot read admin activity');
select ok(not has_function_privilege('anon', 'public.mova_grant_platform_admin(uuid,text)', 'EXECUTE'), 'anonymous users cannot grant admin');
select ok(not has_function_privilege('authenticated', 'public.mova_grant_platform_admin(uuid,text)', 'EXECUTE'), 'signed-in users cannot grant admin');

-- No session: not an admin.
select set_config('request.jwt.claims', '', true);
select ok(not public.mova_is_platform_admin(), 'no session is not an admin');

-- Admin on a one-step session (aal1): denied until the second step is done.
select set_config('request.jwt.claims', '{"sub":"ad660000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select ok(not public.mova_is_platform_admin(), 'admin on a one-step session is not an admin');

-- Admin on a two-step session: allowed.
select set_config('request.jwt.claims', '{"sub":"ad660000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select ok(public.mova_is_platform_admin(), 'admin on a two-step session is an admin');
select is((select (public.mova_admin_whoami() ->> 'is_admin')::boolean), true, 'whoami reports the admin');

-- Signed-in stylist on a two-step session: not an admin, and the guard raises.
select set_config('request.jwt.claims', '{"sub":"ad660000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select ok(not public.mova_is_platform_admin(), 'stylist on a two-step session is not an admin');
select is((select (public.mova_admin_whoami() ->> 'is_admin')::boolean), false, 'whoami reports non-admins without an error');
select throws_ok(
  $$select public.mova_require_platform_admin()$$,
  '42501', 'PLATFORM_ADMIN_REQUIRED', 'the guard refuses a stylist'
);

-- Activity log is append-only, even for the service role that writes it.
insert into public.mova_admin_activity (admin_user_id, action, object_type, details)
values ('ad660000-0000-4000-8000-000000000001', 'test.logged', 'test', '{}'::jsonb);
select throws_ok(
  $$update public.mova_admin_activity set action = 'changed' where action = 'test.logged'$$,
  '42501', 'ADMIN_ACTIVITY_IS_APPEND_ONLY', 'admin activity cannot be updated'
);
select throws_ok(
  $$delete from public.mova_admin_activity where action = 'test.logged'$$,
  '42501', 'ADMIN_ACTIVITY_IS_APPEND_ONLY', 'admin activity cannot be deleted'
);
select ok(exists(select 1 from public.mova_admin_activity where action = 'test.logged'), 'the logged row is kept');

select * from finish();
rollback;
