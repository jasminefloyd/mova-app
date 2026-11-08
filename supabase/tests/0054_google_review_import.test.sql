begin;
select plan(3);
select has_column('public'::name,'mova_review_settings'::name,'google_location_id'::name,'TC-D10-IMPORT-01 review settings store the Google location to import from');
insert into public.mova_artist_businesses(id,name,status) values('e5900000-0000-4000-8000-000000000101','Google import fixture','active');
insert into public.mova_google_reviews(artist_business_id,provider_review_id,rating) values('e5900000-0000-4000-8000-000000000101','fake-loc-r1',5);
select throws_ok($$insert into public.mova_google_reviews(artist_business_id,provider_review_id,rating) values('e5900000-0000-4000-8000-000000000101','fake-loc-r1',4)$$,'23505',null,'TC-D10-IMPORT-02 the same Google review is stored once (sync upserts)');
select throws_ok($$insert into public.mova_review_settings(artist_business_id,google_location_id) values('e5900000-0000-4000-8000-000000000101','x')$$,'23514',null,'TC-D10-IMPORT-01 location ids are validated');
select * from finish();
rollback;
