begin;
select plan(12);

-- Fixture rows are inserted with triggers off (replica role), so only the columns these functions read matter.
set local session_replication_role = replica;
insert into public.mova_artist_businesses(id, name, status) values ('e1160000-0000-4000-8000-000000000001', 'Ari Monroe Hair', 'active');
insert into public.mova_clients(id, artist_business_id, display_name, email) values ('e1160000-0000-4000-8000-000000000011', 'e1160000-0000-4000-8000-000000000001', 'Keisha D.', 'keisha@example.com');
insert into public.mova_appointments(id, artist_business_id, location_id, service_id, status, starts_at, ends_at, service_name_snapshot, service_price_minor, client_name, client_id, client_email, manage_token_hash, idempotency_key)
  values ('e1160000-0000-4000-8000-000000000021', 'e1160000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 'completed', now() - interval '2 days', now() - interval '2 days' + interval '90 minutes',
          'Silk press', 9500, 'Keisha D.', 'e1160000-0000-4000-8000-000000000011', null, '\x00', 'fixture-0116-a');
insert into public.mova_review_requests(id, artist_business_id, appointment_id, token_hash, expires_at)
  values ('e1160000-0000-4000-8000-000000000031', 'e1160000-0000-4000-8000-000000000001', 'e1160000-0000-4000-8000-000000000021', '\x01', now() + interval '7 days');
insert into public.mova_reviews(id, artist_business_id, appointment_id, request_id, rating, body, display_name, locale)
  values ('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001', 'e1160000-0000-4000-8000-000000000021', 'e1160000-0000-4000-8000-000000000031', 5, 'Best silk press.', 'Keisha D.', 'en-US');
set local session_replication_role = origin;

select is(public.mova_review_reply_email_context('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001'), null, 'RV-01 nothing to email before the stylist replies');
update public.mova_reviews set artist_reply = 'Thank you, Keisha!', artist_replied_at = now() where id = 'e1160000-0000-4000-8000-000000000041';
select is(public.mova_review_reply_email_context('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001')->>'to', 'keisha@example.com', 'RV-02 the reply goes to the email on file');
select is(public.mova_review_reply_email_context('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001')->>'reply', 'Thank you, Keisha!', 'RV-03 the email carries the reply');
select ok(public.mova_review_reply_email_claim('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001'), 'RV-04 the first reply claims the email');
select ok(not public.mova_review_reply_email_claim('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001'), 'RV-05 an edited reply does not email again');
select is(public.mova_review_reply_email_context('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001'), null, 'RV-06 after the first email there is nothing more to send');
select public.mova_review_reply_email_release('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001');
select ok(public.mova_review_reply_email_claim('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001'), 'RV-07 a failed send gives the claim back');

-- Unsubscribe link: one-use token, records "no review emails" for this client.
update public.mova_reviews set reply_emailed_at = null where id = 'e1160000-0000-4000-8000-000000000041';
insert into public.mova_email_unsubscribe_tokens(token_hash, artist_business_id, client_id, address_hash)
  values (repeat('a', 64), 'e1160000-0000-4000-8000-000000000001', 'e1160000-0000-4000-8000-000000000011', repeat('b', 64));
select is(public.mova_email_unsubscribe(repeat('a', 64))->>'business_name', 'Ari Monroe Hair', 'RV-08 the unsubscribe page can name the stylist');
select is(public.mova_review_reply_email_context('e1160000-0000-4000-8000-000000000041', 'e1160000-0000-4000-8000-000000000001')->>'skip', 'unsubscribed', 'RV-09 an unsubscribed client gets no reply email');
select is((select count(*)::int from public.mova_client_consents where client_id = 'e1160000-0000-4000-8000-000000000011' and purpose = 'review_requests' and not granted), 1, 'RV-10 the opt-out is recorded once');
select lives_ok($$select public.mova_email_unsubscribe(repeat('a', 64))$$, 'RV-11 reusing the link is harmless');
select ok(not has_function_privilege('anon', 'public.mova_email_unsubscribe(text)', 'EXECUTE'), 'RV-12 only the server can run unsubscribe');

select * from finish();
rollback;
