begin;
select plan(17);
insert into auth.users (id,email,email_confirmed_at) values
 ('ac112000-0000-4000-8000-000000000001','admin@example.invalid',now()),
 ('ac112000-0000-4000-8000-000000000002','free@example.invalid',now()),
 ('ac112000-0000-4000-8000-000000000003','paid@example.invalid',now());
select public.mova_grant_platform_admin('ac112000-0000-4000-8000-000000000001','Closure admin');
insert into public.mova_artist_businesses (id,name) values
 ('ac112000-0000-4000-8000-000000000102','Free Studio'),
 ('ac112000-0000-4000-8000-000000000103','Paid Studio');
insert into public.mova_artist_memberships (artist_business_id,user_id) values
 ('ac112000-0000-4000-8000-000000000102','ac112000-0000-4000-8000-000000000002'),
 ('ac112000-0000-4000-8000-000000000103','ac112000-0000-4000-8000-000000000003');
insert into public.mova_artist_profiles (artist_business_id,display_name,handle,specialties,is_published,search_index_enabled) values
 ('ac112000-0000-4000-8000-000000000102','Free Stylist','closure-free','{Braids}',true,true),
 ('ac112000-0000-4000-8000-000000000103','Paid Stylist','closure-paid','{Braids}',true,true);
insert into public.mova_clients(artist_business_id,display_name,source) values
 ('ac112000-0000-4000-8000-000000000102','Free client','manual'),
 ('ac112000-0000-4000-8000-000000000103','Paid client','manual');

select is(public.mova_account_begin('ac112000-0000-4000-8000-000000000102','ac112000-0000-4000-8000-000000000002','stylist',null)->>'state','archived','free request archives synchronously');
select is((select banned_until from auth.users where email='free@example.invalid'),'9999-12-31 00:00:00+00'::timestamptz,'owner sign-in is disabled');
select is((select is_published from public.mova_artist_profiles where handle='closure-free'),false,'public page is unpublished');
select is((select count(*) from public.mova_account_mail() where kind='farewell'),1::bigint,'one farewell is pending');
select is((select count(*) from public.mova_account_mail() where kind='admin'),1::bigint,'admin notification is pending');

select set_config('request.jwt.claims','{"sub":"ac112000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select is((select count(*) from public.mova_artist_memberships where artist_business_id='ac112000-0000-4000-8000-000000000102'),0::bigint,'old artist JWT loses workspace access');
select throws_ok($$select public.mova_admin_account_closures()$$,'42501','PLATFORM_ADMIN_REQUIRED','non-admin cannot read requests');
reset role;

select is(public.mova_account_begin('ac112000-0000-4000-8000-000000000103','ac112000-0000-4000-8000-000000000003','stylist',now()+interval '2 days')->>'state','scheduled','paid closes after its period');
select ok(public.mova_account_available('ac112000-0000-4000-8000-000000000103'),'paid account remains available');
select is((select count(*) from public.mova_account_mail() where kind='farewell'),1::bigint,'paid farewell waits');
update public.mova_account_closures set ends_at=now()-interval '1 second' where artist_business_id='ac112000-0000-4000-8000-000000000103';
select ok(not public.mova_account_available('ac112000-0000-4000-8000-000000000103'),'access is blocked at its deadline before the job');
select is(public.mova_account_finish_due(),1,'job archives the due account');
select ok(public.mova_account_restore('ac112000-0000-4000-8000-000000000103',
 (select id from public.mova_account_closures where artist_business_id='ac112000-0000-4000-8000-000000000103')),'stylist reactivation restores archive');
select ok((select is_published from public.mova_artist_profiles where handle='closure-paid'),'previous publication state returns');
select throws_ok($$select public.mova_account_prepare_purge('ac112000-0000-4000-8000-000000000102','ac112000-0000-4000-8000-000000000001','wrong')$$,
 'P0001','DISPLAY_NAME_MISMATCH','confirmation name is enforced at the database');
select public.mova_account_prepare_purge('ac112000-0000-4000-8000-000000000102','ac112000-0000-4000-8000-000000000001','Free Stylist');
select public.mova_account_purge('ac112000-0000-4000-8000-000000000102','ac112000-0000-4000-8000-000000000001');
select ok(not exists(select 1 from public.mova_artist_businesses where name='Free Studio') and
 not exists(select 1 from auth.users where email='free@example.invalid') and
 not exists(select 1 from public.mova_clients where display_name='Free client'),'purge erases business, sign-in and clients');
select is((select count(*) from public.mova_clients where display_name='Paid client'),1::bigint,'other tenant remains intact');
select * from finish();
rollback;
