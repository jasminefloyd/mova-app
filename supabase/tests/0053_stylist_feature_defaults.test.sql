begin;
select plan(6);
insert into public.mova_artist_businesses(id,name,status) values
 ('e5800000-0000-4000-8000-000000000101','Defaults fixture','active'),
 ('e5800000-0000-4000-8000-000000000102','Saved choices fixture','active');
select is(public.mova_stylist_features('e5800000-0000-4000-8000-000000000101'),
  '{"rebooking_autopilot":true,"seat_filler_autopilot":true,"review_requests":true,"google_review_import":true,"wallet_card":true,"social_share":true}'::jsonb,
  'TC-O11-DEFAULTS-01 a stylist with no saved settings gets every O11 feature ON');
insert into public.mova_autopilot_settings(artist_business_id) values('e5800000-0000-4000-8000-000000000101');
insert into public.mova_review_settings(artist_business_id) values('e5800000-0000-4000-8000-000000000101');
insert into public.mova_feature_settings(artist_business_id) values('e5800000-0000-4000-8000-000000000101');
select ok((select bool_and(value::boolean) from jsonb_each_text(public.mova_stylist_features('e5800000-0000-4000-8000-000000000101'))),'TC-O11-DEFAULTS-01 new settings rows default ON');
insert into public.mova_autopilot_settings(artist_business_id,enabled,slot_texts_autopilot) values('e5800000-0000-4000-8000-000000000102',false,false);
insert into public.mova_feature_settings(artist_business_id,wallet_card) values('e5800000-0000-4000-8000-000000000102',false);
select is((public.mova_stylist_features('e5800000-0000-4000-8000-000000000102')->>'rebooking_autopilot')::boolean,false,'TC-O11-DEFAULTS-02 a stylist who turned autopilot off stays off');
select is((public.mova_stylist_features('e5800000-0000-4000-8000-000000000102')->>'wallet_card')::boolean,false,'TC-O11-DEFAULTS-02 a stylist who turned the wallet card off stays off');
select ok(not has_function_privilege('authenticated','public.mova_stylist_features(uuid)','EXECUTE'),'TC-O11-DEFAULTS-03 only Edge Functions read the effective switches');
select ok(not has_table_privilege('authenticated','public.mova_feature_settings','INSERT'),'TC-O11-DEFAULTS-03 stylists change feature switches only through functions');
select * from finish();
rollback;
