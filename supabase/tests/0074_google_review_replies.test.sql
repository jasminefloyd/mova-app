begin;
select plan(6);
select has_column('public'::name,'mova_google_reviews'::name,'reply_status'::name,'Google reviews store the reply status');
insert into public.mova_artist_businesses(id,name,status) values('f6c00000-0000-4000-8000-000000000101','Reply fixture','active');
insert into public.mova_google_reviews(artist_business_id,provider_review_id,rating,body) values
  ('f6c00000-0000-4000-8000-000000000101','g-1',5,'Lovely'),
  ('f6c00000-0000-4000-8000-000000000101','g-2',4,'Good'),
  ('f6c00000-0000-4000-8000-000000000101','g-3',3,'Fine');
update public.mova_google_reviews set reply_body='Thank you!',reply_status='posted',reply_posted_at=now() where provider_review_id='g-2' and artist_business_id='f6c00000-0000-4000-8000-000000000101';
select throws_ok($$update public.mova_google_reviews set reply_status='posted' where provider_review_id='g-1'$$,'23514',null,'a status other than none needs reply text');
select throws_ok($$update public.mova_google_reviews set reply_body='stray' where provider_review_id='g-1'$$,'23514',null,'reply text with status none is rejected');
select throws_ok($$update public.mova_google_reviews set reply_body=repeat('a',2001),reply_status='queued' where provider_review_id='g-1'$$,'23514',null,'reply text is limited to 2000 characters');
select is((public.mova_reputation_summary('f6c00000-0000-4000-8000-000000000101',true)->>'awaiting_reply')::int, 2,'with Google connected, Google reviews without a reply count as needing one');
select is((public.mova_reputation_summary('f6c00000-0000-4000-8000-000000000101',false)->>'awaiting_reply')::int, 0,'without Google, the count is only Mova reviews (none here)');
select * from finish();
rollback;
