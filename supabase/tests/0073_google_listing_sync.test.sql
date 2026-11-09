begin;
select plan(9);
select has_table('public'::name, 'mova_google_listing_settings'::name, 'listing sync settings table exists');
select has_table('public'::name, 'mova_google_listing_snapshots'::name, 'listing snapshot table exists');
select ok((select relrowsecurity from pg_class where oid='public.mova_google_listing_snapshots'::regclass),'listing snapshots have RLS enabled');
select ok(not has_table_privilege('authenticated','public.mova_google_listing_snapshots','INSERT'),'stylists cannot write listing snapshots directly');
select ok(not has_table_privilege('anon','public.mova_google_listing_settings','SELECT'),'anonymous clients cannot read listing settings');

insert into public.mova_artist_businesses(id,name,status) values('f6b00000-0000-4000-8000-000000000101','Listing sync fixture','active');
insert into public.mova_google_listing_settings(artist_business_id) values('f6b00000-0000-4000-8000-000000000101');
select ok((select auto_send and last_sync_status='never' from public.mova_google_listing_settings where artist_business_id='f6b00000-0000-4000-8000-000000000101'),'automatic sends are on and nothing has synced yet by default');
select throws_ok($$insert into public.mova_google_listing_snapshots(artist_business_id,item_key,payload) values('f6b00000-0000-4000-8000-000000000101','service:x','[]'::jsonb)$$,'23514',null,'a snapshot payload must be a JSON object');
insert into public.mova_google_listing_snapshots(artist_business_id,item_key,payload) values('f6b00000-0000-4000-8000-000000000101','service:silk-press','{"name":"Silk press","price_minor":14000}');
select throws_ok($$insert into public.mova_google_listing_snapshots(artist_business_id,item_key,payload) values('f6b00000-0000-4000-8000-000000000101','service:silk-press','{}')$$,'23505',null,'each listing item has one snapshot per business');
select throws_ok($$insert into public.mova_google_listing_settings(artist_business_id,last_sync_status) values('f6b00000-0000-4000-8000-000000000101','done')$$,'23514',null,'sync status is one of never, synced or failed');
select * from finish();
rollback;
