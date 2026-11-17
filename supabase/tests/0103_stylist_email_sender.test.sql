begin;
select plan(6);

insert into auth.users(id, email) values ('e1030000-0000-4000-8000-0000000000f1', 'ari.signup@example.com');
insert into public.mova_artist_businesses(id, name, status) values ('e1030000-0000-4000-8000-000000000001', 'Sender fixture', 'active');
insert into public.mova_artist_memberships(artist_business_id, user_id, role, status) values ('e1030000-0000-4000-8000-000000000001', 'e1030000-0000-4000-8000-0000000000f1', 'owner', 'active');
insert into public.mova_artist_profiles(artist_business_id, display_name, handle, specialties) values ('e1030000-0000-4000-8000-000000000001', 'Ari Monroe', 'ari-sender', array['Color']);

select is(public.mova_artist_email_sender('e1030000-0000-4000-8000-000000000001'),
  '{"handle":"ari-sender","reply_to":"ari.signup@example.com"}'::jsonb,
  'client emails send as the handle and reply to the sign-up email by default');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1030000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);

select is(public.mova_client_email_settings('e1030000-0000-4000-8000-000000000001') ->> 'sender', 'ari-sender@mova-beauty.co', 'settings show the sending address');
select is(public.mova_set_client_reply_to('e1030000-0000-4000-8000-000000000001', 'Bookings@AriStudio.com') ->> 'reply_to', 'bookings@aristudio.com', 'the stylist can choose another reply-to address');
select throws_ok($$select public.mova_set_client_reply_to('e1030000-0000-4000-8000-000000000001', 'not an email')$$, '22023', 'INVALID_EMAIL', 'reply-to must be an email');
select is((public.mova_set_client_reply_to('e1030000-0000-4000-8000-000000000001', 'ari.signup@example.com') ->> 'reply_to_is_default')::boolean, true, 'choosing the sign-up email again goes back to the default');

reset role;
select ok(not has_function_privilege('anon', 'public.mova_artist_email_sender(uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.mova_artist_email_sender(uuid)', 'EXECUTE'), 'the sender lookup is only for the email service');

select * from finish();
rollback;
