begin;
select plan(5);
insert into public.mova_artist_businesses(id,name,status) values('e5b00000-0000-4000-8000-000000000001','Autopilot fixture','active');
insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
values('e5b00000-0000-4000-8000-000000000101','e5b00000-0000-4000-8000-000000000001','Studio','suite','instant','mova','artist','America/New_York');
insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,base_price_minor,status)
values('e5b00000-0000-4000-8000-000000000201','e5b00000-0000-4000-8000-000000000001','Silk press','Styling',90,15000,'active');
insert into public.mova_clients(id,artist_business_id,display_name) values
 ('e5b00000-0000-4000-8000-000000000301','e5b00000-0000-4000-8000-000000000001','Rebooked client'),
 ('e5b00000-0000-4000-8000-000000000302','e5b00000-0000-4000-8000-000000000001','Late client');
insert into public.mova_growth_opportunities(id,artist_business_id,client_id,service_id,last_visit_at,next_due_at,window_end_at,confidence,model_version,status) values
 ('e5b00000-0000-4000-8000-000000000401','e5b00000-0000-4000-8000-000000000001','e5b00000-0000-4000-8000-000000000301','e5b00000-0000-4000-8000-000000000201',now()-interval '40 days',now()-interval '3 days',now()+interval '10 days','high','test','contacted'),
 ('e5b00000-0000-4000-8000-000000000402','e5b00000-0000-4000-8000-000000000001','e5b00000-0000-4000-8000-000000000302','e5b00000-0000-4000-8000-000000000201',now()-interval '60 days',now()-interval '30 days',now()+interval '10 days','high','test','contacted');
insert into public.mova_autopilot_decisions(artist_business_id,client_id,opportunity_id,action,reason_code,idempotency_key,created_at) values
 ('e5b00000-0000-4000-8000-000000000001','e5b00000-0000-4000-8000-000000000301','e5b00000-0000-4000-8000-000000000401','sent','due_in_window','autopilot:a',now()-interval '2 days'),
 ('e5b00000-0000-4000-8000-000000000001','e5b00000-0000-4000-8000-000000000302','e5b00000-0000-4000-8000-000000000402','sent','due_in_window','autopilot:b',now()-interval '30 days');
insert into public.mova_appointments(artist_business_id,location_id,service_id,client_id,source,status,starts_at,ends_at,service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,client_name,client_locale,manage_token_hash,idempotency_key,created_at) values
 ('e5b00000-0000-4000-8000-000000000001','e5b00000-0000-4000-8000-000000000101','e5b00000-0000-4000-8000-000000000201','e5b00000-0000-4000-8000-000000000301','showcase','confirmed',now()+interval '5 days',now()+interval '5 days 90 minutes','Silk press',15000,0,15000,'Rebooked client','en-US',decode(repeat('5b',32),'hex'),'autopilot-attr-a',now()-interval '1 day'),
 ('e5b00000-0000-4000-8000-000000000001','e5b00000-0000-4000-8000-000000000101','e5b00000-0000-4000-8000-000000000201','e5b00000-0000-4000-8000-000000000302','showcase','confirmed',now()+interval '6 days',now()+interval '6 days 90 minutes','Silk press',15000,0,15000,'Late client','en-US',decode(repeat('5c',32),'hex'),'autopilot-attr-b',now()-interval '1 day');
select is(public.mova_autopilot_attribute('e5b00000-0000-4000-8000-000000000001'),1,'TC-D3-ATTR-01 a booking within 14 days of the reminder is attributed');
select is((select status from public.mova_growth_opportunities where id='e5b00000-0000-4000-8000-000000000401'),'rebooked','TC-D3-ATTR-01 the opportunity is marked rebooked');
select is((select value_minor from public.mova_autopilot_decisions where idempotency_key='rebooked:e5b00000-0000-4000-8000-000000000401'),15000::bigint,'TC-D3-ATTR-02 Activity logs the rebooked value');
select is((select status from public.mova_growth_opportunities where id='e5b00000-0000-4000-8000-000000000402'),'contacted','TC-D3-ATTR-03 a booking outside the window is not attributed');
select is(public.mova_autopilot_attribute('e5b00000-0000-4000-8000-000000000001'),0,'TC-D3-ATTR-04 attribution happens once');
select * from finish();
rollback;
