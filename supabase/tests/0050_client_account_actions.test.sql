begin;
select plan(11);

insert into auth.users(id,aud,role,email,email_confirmed_at) values
  ('e5500000-0000-4000-8000-000000000001','authenticated','authenticated','client-delete@example.invalid',now()),
  ('e5500000-0000-4000-8000-000000000002','authenticated','authenticated','stylist-delete@example.invalid',now());
insert into public.mova_artist_businesses(id,name,status) values('e5500000-0000-4000-8000-000000000101','Deletion fixture studio','active');
insert into public.mova_clients(id,artist_business_id,display_name,email,email_normalized) values
  ('e5500000-0000-4000-8000-000000000201','e5500000-0000-4000-8000-000000000101','Dana Client','client-delete@example.invalid','client-delete@example.invalid');
insert into public.mova_customer_accounts(id,user_id,display_name) values('e5500000-0000-4000-8000-000000000301','e5500000-0000-4000-8000-000000000001','Dana');
insert into public.mova_customer_contact_methods(customer_account_id,contact_type,value_normalized,verified_at) values('e5500000-0000-4000-8000-000000000301','email','client-delete@example.invalid',now());
insert into public.mova_client_customer_links(artist_business_id,client_id,customer_account_id,linked_via) values('e5500000-0000-4000-8000-000000000101','e5500000-0000-4000-8000-000000000201','e5500000-0000-4000-8000-000000000301','claim_verified');
insert into public.mova_client_consents(artist_business_id,client_id,purpose,channel,granted,changed_at) values('e5500000-0000-4000-8000-000000000101','e5500000-0000-4000-8000-000000000201','offers','sms',true,now()-interval '1 day');

select ok(not has_function_privilege('authenticated','public.mova_delete_customer_profile(uuid)','EXECUTE'),'TC-D11-DELETE-01 clients cannot call the deletion function directly');
select ok(not has_function_privilege('anon','public.mova_delete_customer_profile(uuid)','EXECUTE'),'TC-D11-DELETE-01 anon cannot call the deletion function');
select is((public.mova_delete_customer_profile('e5500000-0000-4000-8000-000000000001')->>'linked_stylists')::int,1,'TC-D11-DELETE-02 deletion reports one linked stylist');
select is((select count(*)::int from public.mova_customer_accounts where id='e5500000-0000-4000-8000-000000000301'),0,'TC-D11-DELETE-02 the customer account is removed');
select is((select count(*)::int from public.mova_customer_contact_methods where customer_account_id='e5500000-0000-4000-8000-000000000301'),0,'TC-D11-DELETE-02 verified contacts are removed');
select is((select count(*)::int from public.mova_client_customer_links where customer_account_id='e5500000-0000-4000-8000-000000000301'),0,'TC-D11-DELETE-02 links to stylists are removed');
select is((select count(*)::int from public.mova_clients where id='e5500000-0000-4000-8000-000000000201'),1,'TC-D11-DELETE-03 the stylist keeps their own client record');
select is((select granted from public.mova_client_consents where client_id='e5500000-0000-4000-8000-000000000201' and purpose='offers' and channel='sms' order by changed_at desc limit 1),false,'TC-D11-DELETE-03 marketing consent is withdrawn');
select ok((select marketing_opted_out from public.mova_clients where id='e5500000-0000-4000-8000-000000000201'),'TC-D11-DELETE-03 the client is opted out of marketing');
select is((select count(*)::int from public.mova_security_audit_events where event_type='privacy.client_profile_deleted' and object_id='e5500000-0000-4000-8000-000000000301'),1,'TC-D11-AUDIT-01 deletion writes an audit event');
select throws_ok($$select public.mova_delete_customer_profile('e5500000-0000-4000-8000-000000000001')$$,'P0002','CUSTOMER_ACCOUNT_NOT_FOUND','TC-D11-DELETE-04 deleting twice is refused');

select * from finish();
rollback;
