begin;
select plan(19);
select has_table('public'::name, 'mova_google_connections'::name, 'one Google connection table exists');
select ok((select relrowsecurity from pg_class where oid='public.mova_google_connections'::regclass),'Google connection table has RLS enabled');
select ok(not has_column_privilege('authenticated','public.mova_google_connections','refresh_token_encrypted','SELECT'),'refresh token ciphertext is not exposed to authenticated clients');
select ok(not has_table_privilege('anon','public.mova_google_connections','SELECT'),'anonymous clients cannot read Google connections');
select col_is_pk('public'::name, 'mova_google_connections'::name, 'artist_business_id'::name);
select ok(not has_function_privilege('authenticated','public.mova_google_carry_over_calendar_connections()','EXECUTE'),'only the service role can run the carry-over');
select ok(has_function_privilege('service_role','public.mova_google_carry_over_calendar_connections()','EXECUTE'),'service role runs the carry-over');

-- An existing calendar connection, with calendar sync on, a chosen calendar and a review-import location.
insert into public.mova_artist_businesses(id,name,status) values('f6a00000-0000-4000-8000-000000000101','Carry-over active','active'),('f6a00000-0000-4000-8000-000000000102','Carry-over revoked','active');
insert into public.mova_google_calendar_connections(artist_business_id,google_account_email,calendar_id,refresh_token_encrypted,status,connected_at)
values('f6a00000-0000-4000-8000-000000000101','ari@example.test','work@example.test','\x0102030405'::bytea,'active','2026-10-01T10:00:00Z'),
  ('f6a00000-0000-4000-8000-000000000102','old@example.test','primary','\x0a0b'::bytea,'revoked','2026-09-01T10:00:00Z');
insert into public.mova_calendar_sync_settings(artist_business_id,google_enabled) values('f6a00000-0000-4000-8000-000000000101',true),('f6a00000-0000-4000-8000-000000000102',false);
insert into public.mova_review_settings(artist_business_id,google_location_id) values('f6a00000-0000-4000-8000-000000000101','locations/123');

select is(public.mova_google_carry_over_calendar_connections(), 2, 'the first run copies both legacy connections');
select is((select refresh_token_encrypted from public.mova_google_connections where artist_business_id='f6a00000-0000-4000-8000-000000000101'),'\x0102030405'::bytea,'the existing connection keeps its refresh token, so nobody reconnects');
select is((select google_account_email from public.mova_google_connections where artist_business_id='f6a00000-0000-4000-8000-000000000101'),'ari@example.test','the connected Google account carries over');
select ok((select calendar_enabled and calendar_id='work@example.test' and status='active' from public.mova_google_connections where artist_business_id='f6a00000-0000-4000-8000-000000000101'),'calendar sync stays on with the chosen calendar');
select is((select business_location_id from public.mova_google_connections where artist_business_id='f6a00000-0000-4000-8000-000000000101'),'locations/123','the review-import location becomes the Business Profile location');
select ok((select not business_profile_enabled and granted_scopes = array['https://www.googleapis.com/auth/calendar.events'] from public.mova_google_connections where artist_business_id='f6a00000-0000-4000-8000-000000000101'),'carried-over connections only claim the calendar scope until Business Profile is granted');
select ok((select not calendar_enabled and status='revoked' from public.mova_google_connections where artist_business_id='f6a00000-0000-4000-8000-000000000102'),'a revoked legacy connection stays revoked and off');

select is(public.mova_google_carry_over_calendar_connections(), 0, 'running the carry-over again copies nothing (idempotent)');
select is((select count(*)::int from public.mova_google_connections where artist_business_id in ('f6a00000-0000-4000-8000-000000000101','f6a00000-0000-4000-8000-000000000102')),2,'no duplicate connection rows after a second run');

update public.mova_google_connections set calendar_enabled=false where artist_business_id='f6a00000-0000-4000-8000-000000000101';
select public.mova_google_carry_over_calendar_connections();
select ok((select not calendar_enabled from public.mova_google_connections where artist_business_id='f6a00000-0000-4000-8000-000000000101'),'a later choice made in the new table is not overwritten by the carry-over');
select ok((select count(*)=1 from public.mova_google_calendar_connections where artist_business_id='f6a00000-0000-4000-8000-000000000101'),'the legacy connection row is kept, not deleted');
select ok((select count(*)=1 from public.mova_calendar_sync_settings where artist_business_id='f6a00000-0000-4000-8000-000000000101'),'the legacy sync settings row is kept');
select * from finish();
rollback;
