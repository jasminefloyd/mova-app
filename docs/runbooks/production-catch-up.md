# Production catch-up runbook (Phase 1, task 1.10)

Status: **prepared, not applied.** Applying it needs the owner's approval for these exact versions (owner decision O14). Nothing in this file has been run against production.

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

The production project also holds 83 migration records that are not in this repository. Do not run `supabase db push` against it: it would try to reconcile that history. Apply the files individually as below.

## Order

Apply 0032, 0034, 0038, 0039, 0040, 0041, 0042, 0043, 0044, 0045 in that order, then deploy the Edge Functions that depend on them (`availability-search`, `concierge-artist`, `customer-profile`, `waitlist-signup`, `payment-settings`, `stripe-connect-onboard`, `support-feedback`, `messaging-dispatch`, `messaging-events`, `messaging-inbound-sms`, `missed-call-webhook`, `job-dispatch`, `job-worker`, `stripe-webhook`). Deploying `availability-search` before 0039 makes booking return 503.

## Pre-checks (read-only)

```sql
-- Which of these versions production already has.
select version, name from supabase_migrations.schema_migrations
where version in ('20261107200000','20261107220000','20261108010000','20261108011000','20261108012000') order by version;
-- Anonymous grants that 0032 will remove (expect rows before, none after).
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name like 'mova\_%' order by 1, 2;
-- Objects 0034 creates must not already exist.
select to_regclass('public.mova_background_jobs'), to_regclass('public.mova_background_job_alerts');
```

## Apply

For each file, in one transaction: run the file's SQL, then insert its row into `supabase_migrations.schema_migrations` (version, name, statements), exactly as the earlier Management API applications did. Stop at the first error; nothing later runs.

## Verify

```sql
select count(*) from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name like 'mova\_%';           -- expect 0 after 0032
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
- 0045: revert `stripe-webhook` and `job-worker` first, then drop `mova_stripe_enqueue_processor_fee` and `mova_stripe_record_processor_fee`. Posted fee ledger rows are immutable and stay.
- 0044: drop trigger `mova_payments_fee_locked` and function `mova_payment_fee_locked`; keep the `platform_fee_version` column (harmless); restore the 0009 snapshot function only if reverting `payment-settings`.
- 0043: drop `mova_email_send_gate`, `mova_appointment_email_context` and `mova_enqueue_appointment_reminders` after reverting `job-dispatch` and `job-worker`.
- 0042: drop the functions it creates (`mova_sms_daily_cap`, `mova_sms_normalize`, `mova_sms_send_gate`, `mova_sms_handle_inbound`, `mova_missed_call_gate`) and the index `mova_messages_client_sms_recent_idx`; no table changes.
- 0041: only if no stylist has sent feedback: `drop table public.mova_support_messages;` and remove the empty `mova_support_screenshots` bucket.
