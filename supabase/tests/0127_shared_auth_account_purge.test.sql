begin;
select plan(9);

-- Model another application in the same project using the same Auth identity.
create schema shared_auth_fixture;
create table shared_auth_fixture.users (id uuid primary key references auth.users(id));
insert into auth.users (id,email,email_confirmed_at) values
 ('ac127000-0000-4000-8000-000000000001','shared-auth-admin@example.invalid',now()),
 ('ac127000-0000-4000-8000-000000000002','shared-auth-owner@example.invalid',now());
insert into shared_auth_fixture.users values ('ac127000-0000-4000-8000-000000000002');
select public.mova_grant_platform_admin('ac127000-0000-4000-8000-000000000001','Purge admin');
insert into public.mova_artist_businesses (id,name) values ('ac127000-0000-4000-8000-000000000102','Shared Studio');
insert into public.mova_artist_memberships (artist_business_id,user_id)
values ('ac127000-0000-4000-8000-000000000102','ac127000-0000-4000-8000-000000000002');
insert into public.mova_artist_profiles (artist_business_id,display_name,handle,specialties,is_published)
values ('ac127000-0000-4000-8000-000000000102','D''Angelo’s Studio','shared-auth-test','{Braids}',true);
insert into public.mova_clients(artist_business_id,display_name,source)
values ('ac127000-0000-4000-8000-000000000102','Mova shared auth client','manual');

select lives_ok($$select public.mova_account_prepare_purge('ac127000-0000-4000-8000-000000000102',
  'ac127000-0000-4000-8000-000000000001','D''Angelo’s Studio')$$, 'Both straight and curly apostrophes pass exact display-name confirmation');
select is((select state from public.mova_account_closures where artist_business_id='ac127000-0000-4000-8000-000000000102'),'purging','The Mova account is ready to purge');
select ok(not public.mova_account_available('ac127000-0000-4000-8000-000000000102'),'The pending purge blocks Mova workspace access');
select is((select banned_until from auth.users where id='ac127000-0000-4000-8000-000000000002'),null::timestamptz,'The shared login is not banned');

-- Reproduce the stored state of a purge started by the previous release.
update auth.users set banned_until='9999-12-31 00:00:00+00' where id='ac127000-0000-4000-8000-000000000002';
update public.mova_account_closures set auth_ban_applied=true, previous_ban='2025-01-01 00:00:00+00' where artist_business_id='ac127000-0000-4000-8000-000000000102';
select lives_ok($$select public.mova_account_purge('ac127000-0000-4000-8000-000000000102',
  'ac127000-0000-4000-8000-000000000001')$$, 'Retrying the purge removes Mova data without violating the external foreign key');
select ok(not exists(select 1 from public.mova_artist_businesses where name='Shared Studio')
  and not exists(select 1 from public.mova_clients where display_name='Mova shared auth client')
  and not exists(select 1 from public.mova_artist_profiles where handle='shared-auth-test'),
  'Mova business, clients and public profile are erased');
select ok(exists(select 1 from auth.users where id='ac127000-0000-4000-8000-000000000002'),
  'The shared Auth identity survives');
select is((select banned_until from auth.users where id='ac127000-0000-4000-8000-000000000002'),
  '2025-01-01 00:00:00+00'::timestamptz,'A retry restores the ban state from before the Mova closure');
select is((select count(*) from shared_auth_fixture.users),1::bigint,'The other application keeps its user record');

select * from finish();
rollback;
