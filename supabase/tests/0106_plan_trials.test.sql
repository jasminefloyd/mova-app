begin;
select plan(36);

-- Fixtures: Ari owns business A (onboarded) and business B; Bo is a member of A but not the owner.
insert into auth.users(id, email) values
  ('e1060000-0000-4000-8000-0000000000a1', 'ari.trial@example.com'),
  ('e1060000-0000-4000-8000-0000000000b1', 'bo.trial@example.com'),
  ('e1060000-0000-4000-8000-0000000000c1', 'cy.trial@example.com');
insert into public.mova_artist_businesses(id, name, status) values
  ('e1060000-0000-4000-8000-00000000000a', 'Trial A', 'active'),
  ('e1060000-0000-4000-8000-00000000000b', 'Trial B', 'active'),
  ('e1060000-0000-4000-8000-00000000000c', 'Trial C', 'active');
insert into public.mova_artist_memberships(artist_business_id, user_id, role, status) values
  ('e1060000-0000-4000-8000-00000000000a', 'e1060000-0000-4000-8000-0000000000a1', 'owner', 'active'),
  ('e1060000-0000-4000-8000-00000000000a', 'e1060000-0000-4000-8000-0000000000b1', 'assistant', 'active'),
  ('e1060000-0000-4000-8000-00000000000b', 'e1060000-0000-4000-8000-0000000000a1', 'owner', 'active'),
  ('e1060000-0000-4000-8000-00000000000c', 'e1060000-0000-4000-8000-0000000000c1', 'owner', 'active');
insert into public.mova_onboarding_progress(artist_business_id, current_step) values
  ('e1060000-0000-4000-8000-00000000000a', 'complete'), ('e1060000-0000-4000-8000-00000000000c', 'complete');

-- Switch off: nobody is eligible.
select is(public.mova_trial_status_internal('e1060000-0000-4000-8000-00000000000a', 'e1060000-0000-4000-8000-0000000000a1')->>'state', 'free', 'with trial_enabled off the trial is not offered');
update public.mova_platform_switches set enabled = true where key = 'trial_enabled';

-- Eligible, offer flow.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1060000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is(public.mova_trial_status('e1060000-0000-4000-8000-00000000000a')->>'state', 'eligible', 'an onboarded owner with no subscription is eligible');
select is((public.mova_trial_status('e1060000-0000-4000-8000-00000000000a')->>'should_offer')::boolean, true, 'T1 is due on first app entry');
select is(public.mova_record_trial_offer('e1060000-0000-4000-8000-00000000000a', true)->>'state', 'declined', 'Continue on Free records a decline');
select is((public.mova_trial_status('e1060000-0000-4000-8000-00000000000a')->>'should_offer')::boolean, false, 'T1 is not shown again after it was offered');
select is((public.mova_trial_status('e1060000-0000-4000-8000-00000000000a')->>'eligible')::boolean, true, 'a declined stylist can still start the trial from Plan (Q1)');
select throws_ok($$insert into public.mova_plan_trials(artist_business_id, user_id) values ('e1060000-0000-4000-8000-00000000000a', 'e1060000-0000-4000-8000-0000000000a1')$$, '42501', null, 'stylists cannot write trial rows directly');
select set_config('request.jwt.claims', '{"sub":"e1060000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select throws_ok($$select public.mova_record_trial_offer('e1060000-0000-4000-8000-00000000000a', true)$$, '42501', 'OWNER_REQUIRED', 'only the owner answers the trial offer');
select is((public.mova_trial_status('e1060000-0000-4000-8000-00000000000a')->>'should_offer')::boolean, false, 'non-owners are never sent to T1');
select set_config('request.jwt.claims', '{"sub":"e1060000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$select public.mova_trial_status('e1060000-0000-4000-8000-00000000000a')$$, '42501', 'NOT_A_MEMBER', 'other stylists cannot read the trial state');
select is(public.mova_set_account_sms_consent('+13125550148', true, 'start_trial')->>'phone', '+13125550148', 'a stylist opts in to account texts');
select throws_ok($$select public.mova_set_account_sms_consent('312-555-0148', true)$$, '22023', 'PHONE_INVALID', 'account texts need an E.164 number');
select is((public.mova_set_account_sms_consent(null, false)->>'enabled')::boolean, false, 'a stylist turns account texts off');
reset role;

-- Trial starts (Stripe says trialing on AI + Growth).
select is(public.mova_apply_billing_state('e1060000-0000-4000-8000-00000000000a', 'cus_t1', 'sub_t1', 'trialing', 'ai_growth',
  now() + interval '30 days', false, now() + interval '30 days', false, 'visa', '4242', 'fp_1', now())->>'trial_started', 'true', 'the first trialing state starts the trial');
select is((select plan_key from public.mova_business_plan_assignments where artist_business_id = 'e1060000-0000-4000-8000-00000000000a'), 'ai_growth', 'trialing assigns AI + Growth');
select is((select fee_bps from public.mova_business_fee('e1060000-0000-4000-8000-00000000000a')), 150, 'the trial fee is the Free rate (D4)');
select is((select plan_key from public.mova_business_fee('e1060000-0000-4000-8000-00000000000a')), 'free', 'trial payments record the Free plan in the fee snapshot');
select is(public.mova_trial_status_internal('e1060000-0000-4000-8000-00000000000a', 'e1060000-0000-4000-8000-0000000000a1')->>'state', 'trialing', 'state is trialing');
select is((public.mova_trial_status_internal('e1060000-0000-4000-8000-00000000000a', null)->>'days_left')::int, 30, 'thirty days left on day one');
select is(public.mova_apply_billing_state('e1060000-0000-4000-8000-00000000000a', 'cus_t1', 'sub_t1', 'trialing', 'ai_growth',
  now() + interval '30 days', false, null, false, null, null, null, now())->>'trial_started', 'false', 'applying the same state again is idempotent');
select throws_ok($$insert into public.mova_plan_trials(artist_business_id, user_id, started_at) values ('e1060000-0000-4000-8000-00000000000b', 'e1060000-0000-4000-8000-0000000000a1', now())$$,
  '23505', null, 'one started trial per stylist (D6)');
select is(public.mova_trial_status_internal('e1060000-0000-4000-8000-00000000000b', 'e1060000-0000-4000-8000-0000000000a1')->>'state', 'free', 'the same stylist''s second business is not eligible');

-- After-trial choice: Free (Stripe cancel_at_period_end).
select public.mova_set_after_trial_plan('e1060000-0000-4000-8000-00000000000a', 'free');
select is(public.mova_trial_status_internal('e1060000-0000-4000-8000-00000000000a', null)->>'after_trial_plan', 'free', 'T5 Free choice is stored');

-- Reminders: 7 days before, at 10:00 New York time.
update public.mova_plan_trials set ends_at = '2026-12-22 15:00+00' where artist_business_id = 'e1060000-0000-4000-8000-00000000000a';
update public.mova_billing_subscriptions set trial_end = '2026-12-22 15:00+00' where artist_business_id = 'e1060000-0000-4000-8000-00000000000a';
select is(public.mova_enqueue_trial_messages('2026-12-15 14:59+00'), 0, 'no 7-day reminder before 10:00 local');
select is(public.mova_enqueue_trial_messages('2026-12-15 15:00+00'), 1, 'the 7-day reminder is queued at 10:00 local');
select is(public.mova_enqueue_trial_messages('2026-12-15 15:05+00'), 0, 'reminders are queued once');
select is(public.mova_enqueue_trial_messages('2026-12-23 15:00+00'), 0, 'nothing after the trial ended');
update public.mova_plan_trials set reminder_1d_at = null where artist_business_id = 'e1060000-0000-4000-8000-00000000000a';
select is(public.mova_enqueue_trial_messages('2026-12-21 15:00+00'), 1, 'the 1-day reminder is queued at 10:00 local the day before');

-- Trial ends on Free: Stripe deletes the subscription.
select is(public.mova_apply_billing_state('e1060000-0000-4000-8000-00000000000a', 'cus_t1', 'sub_t1', 'canceled', 'ai_growth',
  '2026-12-22 15:00+00', true, null, false, null, null, null, now() + interval '1 minute')->>'trial_ended_free', 'true', 'a canceled trial ends on Free');
select is((select plan_key from public.mova_business_plan_assignments where artist_business_id = 'e1060000-0000-4000-8000-00000000000a'), 'free', 'the plan drops to Free');
select is(public.mova_trial_status_internal('e1060000-0000-4000-8000-00000000000a', null)->>'state', 'ended_free', 'state is ended_free (T6/T7)');
select is(public.mova_apply_billing_state('e1060000-0000-4000-8000-00000000000a', 'cus_t1', 'sub_t1', 'trialing', 'ai_growth',
  null, false, null, false, null, null, null, now() - interval '1 day')->>'ignored', 'true', 'an older event never rewinds the state');

-- Unlock later: active Pro; then a failed renewal keeps Pro.
select is(public.mova_apply_billing_state('e1060000-0000-4000-8000-00000000000a', 'cus_t1', 'sub_t2', 'active', 'pro',
  null, false, now() + interval '30 days', false, null, null, null, now() + interval '2 minutes')->>'plan_key', 'pro', 'unlocking Pro makes Pro current');
select is(public.mova_apply_billing_state('e1060000-0000-4000-8000-00000000000a', 'cus_t1', 'sub_t2', 'past_due', 'pro',
  null, false, null, false, null, null, null, now() + interval '3 minutes')->>'plan_key', 'pro', 'past_due keeps the paid plan during retries');

-- Admin assignment wins over Stripe.
select public.mova_apply_billing_state('e1060000-0000-4000-8000-00000000000c', 'cus_t3', 'sub_t3', 'active', 'pro', null, false, null, false, null, null, null, now());
update public.mova_business_plan_assignments set plan_key = 'ai_growth', assignment_source = 'admin' where artist_business_id = 'e1060000-0000-4000-8000-00000000000c';
select is(public.mova_apply_billing_state('e1060000-0000-4000-8000-00000000000c', 'cus_t3', 'sub_t3', 'canceled', 'pro', null, false, null, false, null, null, null, now() + interval '1 minute')->>'plan_key',
  'ai_growth', 'an admin-assigned plan is not overwritten');

select ok(not has_function_privilege('authenticated', 'public.mova_apply_billing_state(uuid,text,text,text,text,timestamptz,boolean,timestamptz,boolean,text,text,text,timestamptz,uuid)', 'EXECUTE'),
  'stylists cannot write billing state');

select * from finish();
rollback;
