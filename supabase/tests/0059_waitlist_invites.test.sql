begin;
select plan(4);

-- P6 auth: the waitlist approval functions are retired (0061), but the 0059 columns and stored rows stay.
select has_column('public'::name, 'mova_waitlist_signups'::name, 'invite_status'::name, 'waitlist invite status column is kept');
select has_column('public'::name, 'mova_waitlist_signups'::name, 'locale'::name, 'waitlist language column is kept');
select has_column('public'::name, 'mova_waitlist_signups'::name, 'declined_at'::name, 'waitlist decline timestamp column is kept');
select lives_ok($$insert into public.mova_messages (artist_business_id, direction, channel, purpose, origin, status, idempotency_key) values (null, 'outbound', 'email', 'early_access_invite', 'system', 'queued', 'retired-invite-test-1')$$,
  'previously stored early-access invite emails remain allowed by the message constraint');

select * from finish();
rollback;
