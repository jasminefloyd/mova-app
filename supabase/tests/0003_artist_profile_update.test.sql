begin;
select plan(4);

insert into auth.users(id,aud,role,email,email_confirmed_at) values
  ('e3600000-0000-4000-8000-000000000001','authenticated','authenticated','profile-owner@example.invalid',now()),
  ('e3600000-0000-4000-8000-000000000002','authenticated','authenticated','profile-other@example.invalid',now());
insert into public.mova_artist_businesses(id,name,status)
values('e3600000-0000-4000-8000-000000000101','Profile owner fixture','active');
insert into public.mova_artist_memberships(artist_business_id,user_id,role,status)
values('e3600000-0000-4000-8000-000000000101','e3600000-0000-4000-8000-000000000001','owner','active');
insert into public.mova_artist_profiles(artist_business_id,display_name,handle,specialties,bio,preferred_locale)
values('e3600000-0000-4000-8000-000000000101','Profile Owner','profile-owner',array['Color'],'Original bio','en-US');

select has_function('public'::name,'mova_update_artist_profile'::name,array['uuid','text','text','text[]','text','text']::name[],'TC-F01-PROFILE-01 profile update uses the owner-scoped RPC');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e3600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select handle from public.mova_update_artist_profile('e3600000-0000-4000-8000-000000000101','Updated Owner','profile-owner',array['Color','Braids'],'Updated bio','en-US')),'profile-owner','TC-F01-PROFILE-01 owning stylist can update their own profile');
select set_config('request.jwt.claims','{"sub":"e3600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select * from public.mova_update_artist_profile('e3600000-0000-4000-8000-000000000101','Attacker','profile-owner',array['Color'],'Stolen bio','en-US')$$,'42501','OWNER_PROFILE_REQUIRED','TC-F01-PROFILE-01 another stylist cannot call the update for this business');
reset role;
select is((select display_name from public.mova_artist_profiles where artist_business_id='e3600000-0000-4000-8000-000000000101'),'Updated Owner','TC-F01-PROFILE-01 rejected other-stylist update leaves owner profile intact');

select * from finish();
rollback;
