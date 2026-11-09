begin;
select plan(9);

select has_table('public'::name, 'mova_early_access_invites'::name, 'invite allowlist is stored in a prefixed table');
select has_function('public'::name, 'mova_before_user_created'::name, array['jsonb']::name[], 'signup hook function exists');
select ok((select relrowsecurity from pg_class where oid = 'public.mova_early_access_invites'::regclass), 'invite allowlist has RLS enabled');
select ok(not has_table_privilege('anon', 'public.mova_early_access_invites', 'SELECT'), 'anonymous clients cannot read invites');
select ok(not has_table_privilege('authenticated', 'public.mova_early_access_invites', 'SELECT'), 'signed-in clients cannot read invites');
select ok(not has_table_privilege('service_role', 'public.mova_early_access_invites', 'SELECT'), 'service-role API clients cannot read invites');

insert into public.mova_early_access_invites (email_normalized)
values ('invite-test@example.invalid');

select is(
  public.mova_before_user_created('{"user":{"email":"INVITE-TEST@example.invalid"}}'::jsonb),
  '{}'::jsonb,
  'matching address is allowed case-insensitively'
);

select is(
  public.mova_before_user_created('{"user":{"email":"not-invited@example.invalid"}}'::jsonb),
  '{}'::jsonb,
  'uninvited address is allowed since open sign-up (P6 0060)'
);

select ok(
  public.mova_before_user_created('{"user":{"email":"not-invited@example.invalid"}}'::jsonb) ->> 'error' is null,
  'no error is returned for an uninvited address'
);

select * from finish();
rollback;
