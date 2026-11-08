# Background jobs and schedules (task 4.6)

## Schedules (Vercel Cron, `apps/web/vercel.json`)

| Route | Schedule | Does |
| --- | --- | --- |
| `/api/job-dispatch` | every minute | `job-dispatch` (outbox → jobs, appointment reminders) then `job-worker` (25 jobs) |
| `/api/booking-expiry` | every 5 min | `mova_expire_booking_requests` |
| `/api/calendar-sync` | every 5 min | `calendar-sync-run` |
| `/api/reports-refresh` | 05:17 UTC daily | `reports-refresh` (was never running: the route only answered POST and Vercel Cron sends GET; fixed) |

Every route checks `Authorization: Bearer $CRON_SECRET` in constant time (`apps/web/src/routes/cron-auth.ts`) and
fails closed when the secret is missing or shorter than 16 characters. Vercel adds that header automatically when
`CRON_SECRET` is set on the project. The Edge Functions check their own secrets: `MOVA_JOB_DISPATCH_SECRET`,
`MOVA_JOB_WORKER_SECRET` (header `x-mova-job-secret`) and `CRON_SECRET` for `calendar-sync-run` / `reports-refresh`.

Per-minute crons need a Vercel plan that allows them (Hobby allows daily only). If that is not available, schedule
the same HTTPS calls from Supabase (`pg_cron` + `pg_net`) with the same secrets; nothing else changes.

## Jobs

`mova_background_jobs` (0034). Job types: `outbox_event`, `stripe_checkout_expire`, `stripe_refund`,
`appointment_reminder` (0043), `stripe_processor_fee` (0045). A failure retries with exponential backoff
(15 s doubling, capped at an hour, jittered); after `max_attempts` (default 5) the job is **dead** and an alert row is
written.

## Dead letters (0046)

```sql
select * from public.mova_background_job_dead_letters order by dead_at desc;   -- service role only
select public.mova_requeue_dead_job('<job_id>');                                -- fresh attempts, alert acknowledged
```

Requeue only after fixing the cause in `last_error_code`. On production these are owner/on-call actions (stop rule:
no production writes from the agent).
