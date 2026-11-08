begin;
select plan(16);

-- Start from an empty allowlist so the cohort count is predictable.
delete from public.mova_early_access_invites;
set local mova.early_access_cap = '3';

select public.mova_waitlist_register('Nia@Example.com', 'nia@example.com', 'suite_renter', false, 'es-US');
select public.mova_waitlist_register('ari@example.com', 'ari@example.com', 'booth_chair_renter', true, null);
select public.mova_waitlist_register('dee@example.com', 'dee@example.com', 'commission_stylist', false, 'en-US');
select public.mova_waitlist_register('kai@example.com', 'kai@example.com', 'other_beauty_professional', false, 'en-US');

select is((select locale from public.mova_waitlist_signups where email_normalized = 'nia@example.com'), 'es-US', 'TC-INVITE-01 the waitlist keeps the visitor''s language');
select is((select locale from public.mova_waitlist_signups where email_normalized = 'ari@example.com'), 'en-US', 'TC-INVITE-01 and defaults to English');
select is((select invite_status from public.mova_waitlist_signups where email_normalized = 'nia@example.com'), 'waiting', 'TC-INVITE-01 new signups wait for approval');

select is((public.mova_waitlist_approve(array(select id from public.mova_waitlist_signups where email_normalized in ('nia@example.com', 'ari@example.com'))) ->> 'approved')::int, 2, 'TC-INVITE-02 approving two signups');
select ok(exists (select 1 from public.mova_early_access_invites where email_normalized = 'nia@example.com'), 'TC-INVITE-02 adds them to the signup allowlist');
select is((select count(*)::int from public.mova_background_jobs where job_type = 'early_access_invite'), 2, 'TC-INVITE-02 and queues one invite email each');
select is((public.mova_waitlist_approve(array(select id from public.mova_waitlist_signups where email_normalized = 'nia@example.com')) ->> 'approved')::int, 0, 'TC-INVITE-02 approving again changes nothing');

select throws_ok($$select public.mova_waitlist_approve(array(select id from public.mova_waitlist_signups where email_normalized in ('dee@example.com', 'kai@example.com')))$$,
  'P0001', 'EARLY_ACCESS_CAP_REACHED', 'TC-INVITE-03 the cohort cap stops approvals that would go over it');
select is((select count(*)::int from public.mova_early_access_invites), 2, 'TC-INVITE-03 and nothing is added when it does');

select is(public.mova_waitlist_decline(array(select id from public.mova_waitlist_signups where email_normalized = 'kai@example.com')), 1, 'TC-INVITE-04 a signup can be declined');
select is((public.mova_waitlist_approve(array(select id from public.mova_waitlist_signups where email_normalized = 'dee@example.com')) ->> 'used')::int, 3, 'TC-INVITE-04 the last place can still be filled');

select ok(public.mova_waitlist_mark_invited((select id from public.mova_waitlist_signups where email_normalized = 'nia@example.com')), 'TC-INVITE-05 a sent invite is recorded');
select is((select invite_status from public.mova_waitlist_signups where email_normalized = 'nia@example.com'), 'invited', 'TC-INVITE-05 as invited');

select lives_ok($$insert into public.mova_messages (artist_business_id, direction, channel, purpose, origin, status, idempotency_key) values (null, 'outbound', 'email', 'early_access_invite', 'system', 'queued', 'invite-test-1')$$,
  'TC-INVITE-06 an invite email can be stored without a stylist');
select throws_ok($$insert into public.mova_messages (artist_business_id, direction, channel, purpose, origin, status, idempotency_key) values (null, 'outbound', 'sms', 'offers', 'artist', 'queued', 'invite-test-2')$$,
  '23514', null, 'TC-INVITE-06 other messages still need a stylist');

select ok(not has_function_privilege('anon', 'public.mova_waitlist_approve(uuid[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mova_waitlist_approve(uuid[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mova_waitlist_admin_list()', 'EXECUTE'), 'TC-INVITE-07 only the server can approve or list the waitlist');

select * from finish();
rollback;
