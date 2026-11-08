begin;
select plan(16);
-- Task 5.1: consent filtering, ranking, first-claim-wins and expiry.
insert into public.mova_artist_businesses(id,name,status) values('e5a00000-0000-4000-8000-000000000001','Seat filler fixture','active');
insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
values('e5a00000-0000-4000-8000-000000000101','e5a00000-0000-4000-8000-000000000001','Studio 9','suite','instant','mova','artist','America/New_York');
insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,base_price_minor,status)
values('e5a00000-0000-4000-8000-000000000201','e5a00000-0000-4000-8000-000000000001','Silk press','Styling',90,15000,'active'),
      ('e5a00000-0000-4000-8000-000000000202','e5a00000-0000-4000-8000-000000000001','Trim','Cuts',30,4000,'active');
insert into public.mova_clients(id,artist_business_id,display_name,phone,phone_normalized,last_visit_at,marketing_opted_out) values
 ('e5a00000-0000-4000-8000-000000000301','e5a00000-0000-4000-8000-000000000001','Ana Lapsed','+12025550111','+12025550111',now()-interval '90 days',false),
 ('e5a00000-0000-4000-8000-000000000302','e5a00000-0000-4000-8000-000000000001','Bea Revoked','+12025550112','+12025550112',now()-interval '90 days',false),
 ('e5a00000-0000-4000-8000-000000000303','e5a00000-0000-4000-8000-000000000001','Cy OptedOut','+12025550113','+12025550113',now()-interval '90 days',true),
 ('e5a00000-0000-4000-8000-000000000304','e5a00000-0000-4000-8000-000000000001','Dee Due','+12025550114','+12025550114',now()-interval '20 days',false),
 ('e5a00000-0000-4000-8000-000000000305','e5a00000-0000-4000-8000-000000000001','Eve Cancelled','+12025550115','+12025550115',now()-interval '90 days',false),
 ('e5a00000-0000-4000-8000-000000000306','e5a00000-0000-4000-8000-000000000001','Fay NoPhone',null,null,now()-interval '90 days',false),
 ('e5a00000-0000-4000-8000-000000000307','e5a00000-0000-4000-8000-000000000001','Gus Recent','+12025550117','+12025550117',now()-interval '10 days',false);
insert into public.mova_client_consents(artist_business_id,client_id,purpose,channel,granted,changed_at)
select 'e5a00000-0000-4000-8000-000000000001',id,'offers','sms',true,now()-interval '30 days' from public.mova_clients where artist_business_id='e5a00000-0000-4000-8000-000000000001';
insert into public.mova_client_consents(artist_business_id,client_id,purpose,channel,granted,changed_at)
values('e5a00000-0000-4000-8000-000000000001','e5a00000-0000-4000-8000-000000000302','offers','sms',false,now()-interval '1 day');
insert into public.mova_growth_opportunities(artist_business_id,client_id,service_id,last_visit_at,next_due_at,window_end_at,confidence,model_version)
values('e5a00000-0000-4000-8000-000000000001','e5a00000-0000-4000-8000-000000000304','e5a00000-0000-4000-8000-000000000201',now()-interval '20 days',now(),now()+interval '14 days','high','test');
insert into public.mova_appointments(id,artist_business_id,location_id,service_id,client_id,source,status,starts_at,ends_at,service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,client_name,client_locale,manage_token_hash,idempotency_key)
values('e5a00000-0000-4000-8000-000000000401','e5a00000-0000-4000-8000-000000000001','e5a00000-0000-4000-8000-000000000101','e5a00000-0000-4000-8000-000000000201','e5a00000-0000-4000-8000-000000000305','artist','cancelled',now()+interval '2 days',now()+interval '2 days 90 minutes','Silk press',15000,0,15000,'Eve Cancelled','en-US',decode(repeat('5a',32),'hex'),'seat-filler-test-source');
insert into public.mova_outbox_events(id,artist_business_id,aggregate_type,aggregate_id,event_type,idempotency_key)
values('e5a00000-0000-4000-8000-000000000501','e5a00000-0000-4000-8000-000000000001','appointment','e5a00000-0000-4000-8000-000000000401','slot.opened','seat-filler-test-event');

create temp table t_slot as select public.mova_slot_open_from_event('e5a00000-0000-4000-8000-000000000501') as id;
select isnt((select id from t_slot),null,'TC-D1-SLOT-01 slot.opened becomes a slot campaign');
select is(public.mova_slot_open_from_event('e5a00000-0000-4000-8000-000000000501'),(select id from t_slot),'TC-D1-SLOT-01 consuming the same event twice keeps one campaign');
select is(public.mova_slot_build_campaign((select id from t_slot)),2,'TC-D2-CONSENT-01 only two clients are eligible');
select results_eq($$select client_id from public.mova_slot_candidates where slot_event_id=(select id from t_slot) order by rank$$,
  $$values ('e5a00000-0000-4000-8000-000000000304'::uuid),('e5a00000-0000-4000-8000-000000000301'::uuid)$$,'TC-D2-CONSENT-02 the client due for this service ranks before the lapsed one');
select is((select count(*)::int from public.mova_slot_candidates where slot_event_id=(select id from t_slot) and client_id in ('e5a00000-0000-4000-8000-000000000302','e5a00000-0000-4000-8000-000000000303','e5a00000-0000-4000-8000-000000000305','e5a00000-0000-4000-8000-000000000306','e5a00000-0000-4000-8000-000000000307')),0,'TC-D2-CONSENT-03 revoked consent, opted out, the cancelling client, no phone and recent visitors are left out');
select is((select status from public.mova_slot_events where id=(select id from t_slot)),'needs_approval','TC-D1-SLOT-02 the campaign waits for approval');
select ok((select sms_example like '%Reply STOP to opt out%' from public.mova_slot_campaign_copy where slot_event_id=(select id from t_slot)),'TC-D1-SLOT-02 the draft text includes how to opt out');

select is((public.mova_slot_claim(repeat('ab',32))->>'status'),'invalid','TC-D1-CLAIM-01 an unknown token is invalid');
update public.mova_slot_candidates set status='messaged',claim_token_hash=encode(sha256(convert_to('token-'||client_id::text,'utf8')),'hex') where slot_event_id=(select id from t_slot);
select is((public.mova_slot_claim(encode(sha256(convert_to('token-e5a00000-0000-4000-8000-000000000301','utf8')),'hex'))->>'status'),'expired','TC-D1-CLAIM-02 a campaign that is not live cannot be claimed');
update public.mova_slot_events set status='live',current_wave=1 where id=(select id from t_slot);
create temp table t_claim as select public.mova_slot_claim(encode(sha256(convert_to('token-e5a00000-0000-4000-8000-000000000301','utf8')),'hex')) as result;
select is((select result->>'status' from t_claim),'claimed','TC-D1-CLAIM-03 the first claim wins');
select is((select status from public.mova_appointments where id=((select result->>'appointment_id' from t_claim))::uuid),'confirmed','TC-D1-CLAIM-03 an instant location confirms the booking');
select is((select source from public.mova_appointments where id=((select result->>'appointment_id' from t_claim))::uuid),'seat_filler','TC-D1-CLAIM-03 the booking is attributed to the seat filler');
select is((public.mova_slot_claim(encode(sha256(convert_to('token-e5a00000-0000-4000-8000-000000000304','utf8')),'hex'))->>'status'),'taken','TC-D1-CLAIM-04 a later claim is told the spot was taken');
select is((select status from public.mova_slot_events where id=(select id from t_slot)),'filled','TC-D1-CLAIM-04 the campaign is filled');
select is((select count(*)::int from public.mova_appointments where idempotency_key like 'seat-filler:%' and artist_business_id='e5a00000-0000-4000-8000-000000000001'),1,'TC-D1-CLAIM-04 exactly one booking exists');
select ok(not has_function_privilege('anon','public.mova_slot_claim(text)','EXECUTE'),'TC-D1-CLAIM-05 claims go through the slot-claim function only');
select * from finish();
rollback;
