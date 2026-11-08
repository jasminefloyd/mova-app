begin;
select plan(12);

insert into auth.users(id,aud,role,email,email_confirmed_at) values
  ('e4100000-0000-4000-8000-000000000001','authenticated','authenticated','support-a@example.invalid',now()),
  ('e4100000-0000-4000-8000-000000000002','authenticated','authenticated','support-b@example.invalid',now()),
  ('e4100000-0000-4000-8000-000000000003','authenticated','authenticated','support-a2@example.invalid',now());
insert into public.mova_artist_businesses(id,name,status) values
  ('e4100000-0000-4000-8000-000000000101','Support fixture A','active'),
  ('e4100000-0000-4000-8000-000000000102','Support fixture B','active');
insert into public.mova_artist_memberships(artist_business_id,user_id,role,status) values
  ('e4100000-0000-4000-8000-000000000101','e4100000-0000-4000-8000-000000000001','owner','active'),
  ('e4100000-0000-4000-8000-000000000102','e4100000-0000-4000-8000-000000000002','owner','active'),
  ('e4100000-0000-4000-8000-000000000101','e4100000-0000-4000-8000-000000000003','owner','active');

select has_table('public'::name,'mova_support_messages'::name,'TC-SUPPORT-01 support messages table exists');
select ok((select relrowsecurity from pg_class where oid='public.mova_support_messages'::regclass),'TC-SUPPORT-01 RLS is on');
select ok(not has_table_privilege('anon','public.mova_support_messages','SELECT') and not has_table_privilege('anon','public.mova_support_messages','INSERT'),'TC-SUPPORT-01 anon has no access');
select ok(not has_table_privilege('authenticated','public.mova_support_messages','UPDATE') and not has_table_privilege('authenticated','public.mova_support_messages','DELETE'),'TC-SUPPORT-01 stylists cannot edit or delete messages');
select is((select public from storage.buckets where id='mova_support_screenshots'),false,'TC-SUPPORT-01 screenshot bucket is private');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e4100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$insert into public.mova_support_messages(artist_business_id,type,message,screen,locale) values('e4100000-0000-4000-8000-000000000101','broken','The calendar did not load.','/BID-1/calendar','en-US')$$,'TC-SUPPORT-02 stylist can send feedback for their own business');
select throws_ok($$insert into public.mova_support_messages(artist_business_id,type,message) values('e4100000-0000-4000-8000-000000000102','idea','Spoofed business')$$,'42501',null,'TC-SUPPORT-02 stylist cannot send feedback for another business');
select throws_ok($$insert into public.mova_support_messages(artist_business_id,user_id,type,message) values('e4100000-0000-4000-8000-000000000101','e4100000-0000-4000-8000-000000000003','idea','Spoofed user')$$,'42501',null,'TC-SUPPORT-02 stylist cannot send feedback as another user');
select throws_ok($$insert into public.mova_support_messages(artist_business_id,type,message,status) values('e4100000-0000-4000-8000-000000000101','idea','Pre-resolved','resolved')$$,'42501',null,'TC-SUPPORT-02 stylist cannot set the status');
select is((select count(*)::int from public.mova_support_messages),1,'TC-SUPPORT-03 stylist reads their own message');

select set_config('request.jwt.claims','{"sub":"e4100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.mova_support_messages),0,'TC-SUPPORT-03 a teammate in the same business cannot read it');
select set_config('request.jwt.claims','{"sub":"e4100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.mova_support_messages),0,'TC-SUPPORT-03 another stylist cannot read it');
reset role;

select * from finish();
rollback;
