begin;
select plan(7);
select results_eq($$select plan_key,monthly_price_minor,mova_fee_basis_points,status from public.mova_plan_catalog order by monthly_price_minor$$,
  $$values ('free'::text,0,150,'active'::text),('pro',1900,100,'active'),('ai_growth',3900,75,'active')$$,'TC-O10-PLANS-01 confirmed prices and fees are active');
insert into public.mova_artist_businesses(id,name,status) values('e5900000-0000-4000-8000-000000000201','Billing fixture','active');
select is(public.mova_plan_entitlement_summary('e5900000-0000-4000-8000-000000000201')->'current_plan'->>'plan_key','free','TC-D9-BILLING-01 a stylist starts on Free');
select is(public.mova_apply_plan_subscription('e5900000-0000-4000-8000-000000000201','pro','cus_test1','sub_test1','active')->'current_plan'->>'plan_key','pro','TC-D9-BILLING-02 a verified active subscription makes Pro current');
select is(public.mova_apply_plan_subscription('e5900000-0000-4000-8000-000000000201','pro','cus_test1','sub_test1','past_due')->'current_plan'->>'plan_key','free','TC-D9-BILLING-03 an unpaid subscription falls back to Free');
select throws_ok($$select public.mova_apply_plan_subscription('e5900000-0000-4000-8000-000000000201','free','cus_x','sub_x','active')$$,'22023','PLAN_INVALID','TC-D9-BILLING-04 Free is never a Stripe subscription');
select throws_ok($$insert into public.mova_billing_subscriptions(artist_business_id,plan_key,status,livemode) values('e5900000-0000-4000-8000-000000000201','pro','active',true) on conflict (artist_business_id) do update set livemode=true$$,'23514',null,'TC-D9-BILLING-05 live-mode subscriptions are refused');
select ok(not has_function_privilege('authenticated','public.mova_apply_plan_subscription(uuid,text,text,text,text)','EXECUTE'),'TC-D9-BILLING-06 stylists cannot set their own plan');
select * from finish();
rollback;
