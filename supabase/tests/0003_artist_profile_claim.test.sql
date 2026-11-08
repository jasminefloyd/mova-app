begin;
select plan(14);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('f3333333-3333-4333-8333-333333333331', 'authenticated', 'authenticated', 'claim-unverified@example.invalid', null),
  ('f3333333-3333-4333-8333-333333333332', 'authenticated', 'authenticated', 'claim-verified@example.invalid', now());

select has_function('public'::name, 'mova_claim_artist_profile'::name, array['text','text','text[]','text','text']::name[]);
select is((select reason from public.mova_check_artist_handle(' ADMIN ')), 'reserved', 'reserved handles are normalized before checking');
select is((select reason from public.mova_check_artist_handle('ab')), 'invalid', 'short handles fail format validation');
select is((select available from public.mova_check_artist_handle('fresh-handle')), true, 'unused valid handle is available');

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select * from public.mova_claim_artist_profile('Unauthenticated Artist','claim-empty',array['Stylist'])$$,
  '28000', 'AUTH_REQUIRED', 'profile claim requires an authenticated user'
);

select set_config('request.jwt.claim.sub', 'f3333333-3333-4333-8333-333333333331', true);
select throws_ok(
  $$select * from public.mova_claim_artist_profile('Unverified Artist','claim-unverified',array['Stylist'])$$,
  '28000', 'EMAIL_NOT_VERIFIED', 'profile claim requires a verified email'
);

select set_config('request.jwt.claim.sub', 'f3333333-3333-4333-8333-333333333332', true);
select is(
  (select handle from public.mova_claim_artist_profile('Claim Test Artist','Claim-Test',array['Braider'],'Synthetic pgTAP fixture','es-US')),
  'claim-test', 'claim trims and lowercases the handle and returns the new profile'
);
select is((select count(*)::int from public.mova_artist_memberships where user_id=auth.uid() and role='owner' and status='active'), 1, 'claim creates an active owner membership');
select is((select current_step from public.mova_onboarding_progress where artist_business_id=(select artist_business_id from public.mova_artist_profiles where handle='claim-test')), 'photo', 'claim initializes onboarding progress');
select throws_ok(
  $$select * from public.mova_claim_artist_profile('Duplicate Artist','CLAIM-TEST',array['Stylist'])$$,
  '23505', 'HANDLE_TAKEN', 'case-insensitive duplicate claim is rejected'
);
select is((select count(*)::int from public.mova_artist_businesses where name='Claim Test Artist'), 1, 'duplicate claim leaves no partial business row');

select is(
  (select handle from public.mova_publish_artist_profile((select artist_business_id from public.mova_artist_profiles where handle='claim-test'))),
  'claim-test', 'owner can publish without location, payment, or photo setup'
);
select is((select is_published from public.mova_artist_profiles where handle='claim-test'), true, 'publish marks the profile public');
select is((select current_step from public.mova_onboarding_progress where artist_business_id=(select artist_business_id from public.mova_artist_profiles where handle='claim-test')), 'complete', 'publish completes onboarding');

select * from finish();
rollback;
