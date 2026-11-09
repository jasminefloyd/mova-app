begin;
select plan(7);
select has_column('public'::name,'mova_artist_profiles'::name,'cover_source'::name,'profiles record where the cover came from');
insert into public.mova_artist_businesses(id,name,status) values('f6d00000-0000-4000-8000-000000000101','Cover fixture','active');
insert into public.mova_artist_profiles(artist_business_id,display_name,handle,specialties,bio,preferred_locale)
  values('f6d00000-0000-4000-8000-000000000101','Cover Owner','cover-owner',array['Color'],'Bio','en-US');
select is((select cover_source from public.mova_artist_profiles where artist_business_id='f6d00000-0000-4000-8000-000000000101'),'upload','existing and new profiles default to an upload cover');
select throws_ok($$update public.mova_artist_profiles set cover_source='unsplash' where artist_business_id='f6d00000-0000-4000-8000-000000000101'$$,'23514',null,'an Unsplash cover needs its image, photo id and credit');
select throws_ok($$update public.mova_artist_profiles set cover_source='unsplash',cover_image_url='https://example.test/x.jpg',cover_unsplash_photo_id='p1',cover_credit_name='Sam',cover_credit_url='https://unsplash.com/@sam?utm_source=mova&utm_medium=referral',cover_unsplash_url='https://unsplash.com/?utm_source=mova&utm_medium=referral' where artist_business_id='f6d00000-0000-4000-8000-000000000101'$$,'23514',null,'the cover image must be hosted by Unsplash');
select throws_ok($$update public.mova_artist_profiles set cover_source='unsplash',cover_image_url='https://images.unsplash.com/photo-1?w=1200',cover_unsplash_photo_id='p1',cover_credit_name='Sam',cover_credit_url='https://example.test/sam',cover_unsplash_url='https://unsplash.com/?utm_source=mova&utm_medium=referral' where artist_business_id='f6d00000-0000-4000-8000-000000000101'$$,'23514',null,'the photographer credit must link to their Unsplash profile');
update public.mova_artist_profiles set cover_source='unsplash',cover_image_url='https://images.unsplash.com/photo-1?w=1200',cover_unsplash_photo_id='p1',cover_credit_name='Sam Lee',cover_credit_url='https://unsplash.com/@samlee?utm_source=mova&utm_medium=referral',cover_unsplash_url='https://unsplash.com/?utm_source=mova&utm_medium=referral' where artist_business_id='f6d00000-0000-4000-8000-000000000101';
select is((select cover_credit_name from public.mova_artist_profiles where artist_business_id='f6d00000-0000-4000-8000-000000000101'),'Sam Lee','a complete Unsplash cover is stored with its credit');
select ok(not has_column_privilege('authenticated','public.mova_artist_profiles','cover_source','UPDATE'),'stylists cannot set the cover source directly; the cover function writes it');
select * from finish();
rollback;
