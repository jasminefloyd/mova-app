begin;
select plan(6);

insert into public.mova_early_access_invites (email_normalized) values ('kept-invite@example.invalid');

select is(
  public.mova_before_user_created('{"user":{"email":"new-stylist@example.invalid"}}'::jsonb),
  '{}'::jsonb,
  'an address that was never invited can sign up'
);
select is(
  public.mova_before_user_created('{"user":{"email":"KEPT-INVITE@example.invalid"}}'::jsonb),
  '{}'::jsonb,
  'an invited address is still allowed, case-insensitively'
);
select is(
  public.mova_before_user_created('{}'::jsonb),
  '{}'::jsonb,
  'a payload without an email is allowed too'
);
select ok(
  exists (select 1 from public.mova_early_access_invites where email_normalized = 'kept-invite@example.invalid'),
  'existing early-access invite rows are kept'
);
select ok(
  has_function_privilege('supabase_auth_admin', 'public.mova_before_user_created(jsonb)', 'EXECUTE'),
  'the auth service can still run the hook'
);
select ok(
  not has_function_privilege('anon', 'public.mova_before_user_created(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mova_before_user_created(jsonb)', 'EXECUTE'),
  'clients cannot call the hook directly'
);

select * from finish();
rollback;
