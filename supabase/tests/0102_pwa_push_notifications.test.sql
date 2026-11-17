begin;
select plan(7);

insert into public.mova_artist_businesses(id, name, status) values ('e1020000-0000-4000-8000-000000000001', 'Push fixture', 'active');

insert into public.mova_messages(id, artist_business_id, direction, channel, purpose, origin, body, status, idempotency_key)
values ('e1020000-0000-4000-8000-0000000000a1', 'e1020000-0000-4000-8000-000000000001', 'inbound', 'sms', 'reply', 'transactional', 'Running 10 minutes late, still okay?', 'received', 'push-test-in');
insert into public.mova_messages(id, artist_business_id, direction, channel, purpose, origin, body, status, idempotency_key)
values ('e1020000-0000-4000-8000-0000000000a2', 'e1020000-0000-4000-8000-000000000001', 'outbound', 'sms', 'reply', 'artist', 'See you soon', 'sent', 'push-test-out');

select is((select count(*)::int from public.mova_outbox_events where event_type = 'message.received' and aggregate_id = 'e1020000-0000-4000-8000-0000000000a1'), 1,
  'an inbound client message queues a message.received alert');
select is((select count(*)::int from public.mova_outbox_events where aggregate_id = 'e1020000-0000-4000-8000-0000000000a2'), 0,
  'messages the stylist sends do not alert the stylist');

select ok((public.mova_stylist_alert_context('message.received', 'e1020000-0000-4000-8000-0000000000a1') ->> 'message') = 'Running 10 minutes late, still okay?',
  'alert context carries the message text');
select is(public.mova_stylist_alert_context('review.created', gen_random_uuid()), null::jsonb, 'unknown aggregates give no context');

select is(public.mova_enqueue_stylist_reminders(now()), 0, 'no reminders without confirmed appointments in the next hour');

select ok(has_table_privilege('authenticated', 'public.mova_user_app_state', 'SELECT') and not has_table_privilege('authenticated', 'public.mova_user_app_state', 'DELETE'),
  'stylists can read and set their own app state but not delete it');
select ok(not has_table_privilege('authenticated', 'public.mova_push_subscriptions', 'SELECT'), 'push subscriptions are only reachable through edge functions');

select * from finish();
rollback;
