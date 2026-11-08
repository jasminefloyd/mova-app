# Production catch-up runbook (Phase 1, task 1.10)

Status: **Supabase and Vercel production deployments completed on 2026-11-08.** Owner authorized the rollout. The 22 migrations (0032, 0034, 0038–0047, 0050–0059) were applied individually with matching history rows in transactions. Non-mutating post-apply checks passed; rollback-only fee-lock and sample-stylist checks were not run against production. Five Supabase secrets were set, and all 27 listed Edge Functions are ACTIVE with `verify_jwt=false`. The same `CRON_SECRET` was added to Vercel Production. Deployment `dpl_CzEJAQn82TrtgSU9UUiUWP9eXjfJ` is READY at `https://mova-beauty.co`. The owner explicitly skipped the backup step; PITR is disabled. Live production smoke checks remain pending.

## Why

According to `docs/engineering/PHASE_STATUS.md`, production received migrations 0030, 0031, 0033, 0035, 0036 and 0037 through the Supabase Management API, while these stayed local only:

| Version | File | What it does | Risk if missing |
| --- | --- | --- | --- |
| 0032 | `20261107200000_mova_0032_revoke_anon_tenant_select.sql` | Revokes anonymous SELECT on stylist (tenant) tables | Anonymous users hold table grants; RLS is the only protection left |
| 0034 | `20261107220000_mova_0034_durable_jobs.sql` | Durable background job queue | Job dispatch and retries cannot run |
| 0038 | `20261108010000_mova_0038_profile_handle_fix.sql` | Fixes "column reference handle is ambiguous" in profile claim and update | New stylists cannot claim a profile; profile edits fail |
| 0039 | `20261108011000_mova_0039_deposit_bookings_flag.sql` | Lets availability read the deposit-booking switch | Updated `availability-search` returns 503 until this exists |
| 0040 | `20261108012000_mova_0040_revoke_unused_write_grants.sql` | Revokes write grants that had no RLS policy | None functionally; grants and policies stay inconsistent |
| 0041 | `20261108020000_mova_0041_support_messages.sql` | Stylist feedback table with RLS and a private screenshot bucket | Send feedback (Settings) returns an error |
| 0042 | `20261108030000_mova_0042_sms_policy.sql` | SMS send gate with daily cap, STOP/START/HELP handling, missed-call gate | SMS adapter, inbound keywords and missed-call text-back return errors (all off until O4/O5) |
| 0043 | `20261108031000_mova_0043_appointment_emails.sql` | Email suppression gate, appointment email context, reminder queueing | Appointment emails and reminders cannot run (off until O4) |
| 0044 | `20261108032000_mova_0044_payment_fee_rate.sql` | Fee version on each payment, one fee accessor, fee/amount locked after insert, 150 bps backfill | Past payments' fee could be rewritten; `payment-settings` cannot read the fee |
| 0045 | `20261108033000_mova_0045_stripe_processor_fee.sql` | Queues and posts Stripe's processing fee to the ledger | Money shows $0 Stripe processing; `stripe-webhook` returns 503 after a paid Checkout (it queues the fee job) |
| 0046 | `20261108034000_mova_0046_job_dead_letters.sql` | Dead-letter view and requeue function for background jobs | Operators query the jobs table directly |
| 0047 | `20261108035000_mova_0047_messaging_spend_cap.sql` | Shared $50/month hard-stop spend cap for email and SMS (O4) | Every send fails closed (`SPEND_CHECK_UNAVAILABLE`) |
| 0050 | `20261108040000_mova_0050_client_account_actions.sql` | Client profile deletion withdraws marketing consents and audits (5.10) | Client profile delete returns an error |
| 0051 | `20261108041000_mova_0051_concierge_web_chat.sql` | Concierge turn intent column and index (5.4) | Concierge channels fail to log turns |
| 0052 | `20261108042000_mova_0052_concierge_spend_cap.sql` | $25/month platform concierge model spend cap (O8) | Every concierge channel hands off (fails closed) |
| 0053 | `20261108043000_mova_0053_stylist_feature_defaults.sql` | O11 stylist-level defaults ON; `mova_feature_settings`; `mova_stylist_features()` | Wallet, Google import, autopilot and seat filler refuse (fail closed) |
| 0054 | `20261108044000_mova_0054_google_review_import.sql` | Google location id and sync time on review settings (5.9) | Google review sync returns an error |
| 0055 | `20261108045000_mova_0055_plans_confirmed.sql` | O10 prices active; test-mode billing subscriptions (5.8) | Plans show as before; plan changes fail |
| 0056 | `20261108046000_mova_0056_seat_filler.sql` | Seat filler campaigns, ranking, first-claim-wins (5.1) | `slot.opened` is not consumed; claims fail |
| 0057 | `20261108047000_mova_0057_autopilot_attribution.sql` | Rebooking attribution for the autopilot (5.2) | Autopilot runs fail at attribution |
| 0058 | `20261108048000_mova_0058_plan_fee_rate.sql` | Mova fee follows the stylist's plan (O10: Free 1.5%, Pro 1.0%, AI Growth 0.5%); plan recorded and locked on each payment | Every stylist pays 1.5% whatever their plan; `payment-settings` cannot read the fee |
| 0059 | `20261108050000_mova_0059_waitlist_invites.sql` | Waitlist approval, cohort cap of 10 and invite email jobs (O2); invite emails stored without a stylist | `waitlist-admin` and invite emails fail |

The production project also holds 83 migration records that are not in this repository. Do not run `supabase db push` against it: it would try to reconcile that history. Apply the files individually as below.

## Order

Apply 0032, 0034, 0038, 0039, 0040, 0041, 0042, 0043, 0044, 0045, 0046, 0047, 0050, 0051, 0052, 0053, 0054, 0055, 0056, 0057, 0058, 0059 in that order, then deploy the Edge Functions that depend on them (`availability-search`, `concierge-artist`, `customer-profile`, `waitlist-signup`, `payment-settings`, `stripe-connect-onboard`, `support-feedback`, `messaging-dispatch`, `messaging-events`, `messaging-inbound-sms`, `missed-call-webhook`, `job-dispatch`, `job-worker`, `stripe-webhook`, `messaging-status`, `concierge-web-chat`, `instagram-webhook`, `wallet-pass-create`, `google-reviews-sync`, `plan-management`, `subscription-checkout`, `subscription-portal`, `slot-campaign`, `slot-claim`, `revenue-center`). Phase 5 platform flags (`MOVA_CONCIERGE_WEB_CHAT_ENABLED`, `MOVA_INSTAGRAM_CONCIERGE_ENABLED`, `MOVA_SMS_CONCIERGE_ENABLED`, `MOVA_SEAT_FILLER_ENABLED`, `MOVA_REBOOKING_TEXTS_ENABLED`, `MOVA_WALLET_CLIENT_CARD_ENABLED`, `MOVA_GOOGLE_REVIEWS_ENABLED`) stay off. Deploying `availability-search` before 0039 makes booking return 503.

## Pre-checks (read-only)

```sql
-- Which of these versions production already has.
select version, name from supabase_migrations.schema_migrations
where version in ('20261107200000','20261107220000','20261108010000','20261108011000','20261108012000') order by version;
-- Anonymous SELECT grants that 0032 will remove (expect rows before, none after).
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name like 'mova\_%'
  and privilege_type = 'SELECT' order by 1, 2;
-- Objects 0034 creates must not already exist.
select to_regclass('public.mova_background_jobs'), to_regclass('public.mova_background_job_alerts');
```

## Apply

For each file, in one transaction: run the file's SQL, then insert its row into `supabase_migrations.schema_migrations` (version, name, statements), exactly as the earlier Management API applications did. Stop at the first error; nothing later runs.

## Verify

```sql
select count(*) from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name like 'mova\_%'
  and privilege_type = 'SELECT';                                                           -- expect 0 after 0032
select public.mova_deposit_bookings_enabled();                                             -- expect false
select has_function_privilege('anon', 'public.mova_deposit_bookings_enabled()', 'EXECUTE'); -- expect false
```

Pre-check for 0044: `select count(*) from mova_payments where collector='mova_processed' and platform_fee_bps=0` lists rows the backfill will touch (only those whose stored fee already equals 1.5%).

Then, on the deployed app: Book (25) shows times for a no-deposit service; a deposit service at a stylist-collected location shows the "can't be booked online yet" message; a test stylist on a non-production project can claim a handle.

## Rollback

- 0032, 0040: re-grant the revoked privileges (each file's `revoke` statements, inverted to `grant`).
- 0034: drop the objects it created, only if no jobs have been enqueued.
- 0038: no rollback needed (the previous functions failed on every call).
- 0039: `drop function public.mova_deposit_bookings_enabled();`, after reverting `availability-search`.
- 0057: `drop function public.mova_autopilot_attribute(uuid, timestamptz);` after reverting `revenue-center` and `job-dispatch`.
- 0058: revert `payment-settings`, then restore the 0044 versions of `mova_payment_snapshot_platform_fee` and `mova_payment_fee_locked` and `drop function public.mova_business_fee(uuid, timestamptz);`. Keep the `platform_fee_plan_key` column (stored fees stay as charged).
- 0059: revert `waitlist-signup` and `job-worker`, delete the `waitlist-admin` function, then drop the 0059 functions and the 5-argument `mova_waitlist_register`, restore the 0021 body of the 4-argument one, drop constraint `mova_messages_platform_email_check` and index `mova_messages_platform_idempotency_uq` (only if no invite emails were stored), and set `artist_business_id` back to not null. The new waitlist columns can stay.
- 0056: revert `job-worker`, `job-dispatch`, `slot-campaign`, `slot-claim`; drop the five `mova_slot_*` functions; the added columns are nullable/defaulted and can stay.
- 0055: set the three plan rows back to `status = 'proposed'`; drop `mova_apply_plan_subscription` and `mova_billing_subscriptions` only if empty.
- 0054: the two added columns can stay; revert `google-reviews-sync`.
- 0053: `drop function public.mova_stylist_features(uuid); drop table public.mova_feature_settings;` and reset the four column defaults to false (only if no stylist has saved choices).
- 0052: `drop function public.mova_concierge_month_spend();` after reverting the concierge channels.
- 0051: the `intent` column and index can stay.
- 0050: revert `customer-profile`, then `drop function public.mova_delete_customer_profile(uuid);`.
- 0047: revert the messaging functions first, then drop `mova_messaging_reserve_spend`, `mova_messaging_month_spend_micros`, `mova_messaging_spend_cap_micros`.
- 0046: `drop view public.mova_background_job_dead_letters; drop function public.mova_requeue_dead_job(uuid);`
- 0045: revert `stripe-webhook` and `job-worker` first, then drop `mova_stripe_enqueue_processor_fee` and `mova_stripe_record_processor_fee`. Posted fee ledger rows are immutable and stay.
- 0044: drop trigger `mova_payments_fee_locked` and function `mova_payment_fee_locked`; keep the `platform_fee_version` column (harmless); restore the 0009 snapshot function only if reverting `payment-settings`.
- 0043: drop `mova_email_send_gate`, `mova_appointment_email_context` and `mova_enqueue_appointment_reminders` after reverting `job-dispatch` and `job-worker`.
- 0042: drop the functions it creates (`mova_sms_daily_cap`, `mova_sms_normalize`, `mova_sms_send_gate`, `mova_sms_handle_inbound`, `mova_missed_call_gate`) and the index `mova_messages_client_sms_recent_idx`; no table changes.
- 0041: only if no stylist has sent feedback: `drop table public.mova_support_messages;` and remove the empty `mova_support_screenshots` bucket.
