begin;
select plan(8);

insert into auth.users(id,aud,role,email,email_confirmed_at) values
  ('e8900000-0000-4000-8000-000000000001','authenticated','authenticated','contact-owner@example.invalid',now()),
  ('e8900000-0000-4000-8000-000000000002','authenticated','authenticated','contact-other@example.invalid',now());
insert into public.mova_artist_businesses(id,name,status)
values('e8900000-0000-4000-8000-000000000101','Contact owner fixture','active');
insert into public.mova_artist_memberships(artist_business_id,user_id,role,status)
values('e8900000-0000-4000-8000-000000000101','e8900000-0000-4000-8000-000000000001','owner','active');
insert into public.mova_artist_profiles(artist_business_id,display_name,handle,specialties,bio,preferred_locale)
values('e8900000-0000-4000-8000-000000000101','Contact Owner','contact-owner',array['Color'],'Bio','en-US');

select has_function('public'::name,'mova_update_artist_contact'::name,array['uuid','text','text','text','jsonb']::name[],'TC-F01-CONTACT-01 contact update uses the owner-scoped RPC');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e8900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select handle from public.mova_update_artist_contact('e8900000-0000-4000-8000-000000000101','+1 (404) 555-0123','Owner@Example.com ','https://example.com',jsonb_build_object('instagram','https://instagram.com/owner','facebook',''))),'contact-owner','TC-F01-CONTACT-01 owner saves phone, email, website and links');
reset role;
select is((select contact_email from public.mova_artist_profiles where artist_business_id='e8900000-0000-4000-8000-000000000101'),'owner@example.com','TC-F01-CONTACT-01 email is stored lower-case and trimmed');
select is((select social_links from public.mova_artist_profiles where artist_business_id='e8900000-0000-4000-8000-000000000101'),'{"instagram": "https://instagram.com/owner"}'::jsonb,'TC-F01-CONTACT-01 empty social links are dropped');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e8900000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select * from public.mova_update_artist_contact('e8900000-0000-4000-8000-000000000101','+1 404 555 0199','evil@example.com',null,'{}'::jsonb)$$,'42501','OWNER_PROFILE_REQUIRED','TC-F01-CONTACT-01 another stylist cannot change contact details');
select set_config('request.jwt.claims','{"sub":"e8900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select * from public.mova_update_artist_contact('e8900000-0000-4000-8000-000000000101','','owner@example.com',null,'{}'::jsonb)$$,'22023','CONTACT_PHONE_INVALID','TC-F01-CONTACT-02 phone is required');
select throws_ok($$select * from public.mova_update_artist_contact('e8900000-0000-4000-8000-000000000101','+1 404 555 0123','owner@example.com','http://example.com','{}'::jsonb)$$,'22023','WEBSITE_INVALID','TC-F01-CONTACT-02 website must be https');
select throws_ok($$select * from public.mova_update_artist_contact('e8900000-0000-4000-8000-000000000101','+1 404 555 0123','owner@example.com',null,'{"myspace":"https://myspace.com/x"}'::jsonb)$$,'22023','SOCIAL_LINKS_INVALID','TC-F01-CONTACT-02 only supported social platforms are accepted');

select * from finish();
rollback;
