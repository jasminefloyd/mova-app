begin;
select plan(10);

insert into auth.users (id, email) values
  ('ad710000-0000-4000-8000-000000000001', 'health-admin@mova.invalid'),
  ('ad710000-0000-4000-8000-000000000002', 'health-stylist@mova.invalid');
select public.mova_grant_platform_admin('ad710000-0000-4000-8000-000000000001', 'Health Admin');
insert into public.mova_background_jobs (id, job_type, payload, status, attempts, max_attempts, idempotency_key, last_error_code)
values
  ('ad710000-0000-4000-8000-000000000501', 'reports_refresh', '{}'::jsonb, 'dead', 5, 5, 'ad710000-dead-job-1', 'TIMEOUT'),
  ('ad710000-0000-4000-8000-000000000502', 'reports_refresh', '{}'::jsonb, 'queued', 0, 5, 'ad710000-queued-job-1', null);

set local role anon;
select throws_ok($$select public.mova_admin_health()$$, '42501', null, 'anonymous readers cannot read system health');
reset role;

select set_config('request.jwt.claims', '{"sub":"ad710000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.mova_admin_health()$$, '42501', 'PLATFORM_ADMIN_REQUIRED', 'stylists cannot read system health');
reset role;

select set_config('request.jwt.claims', '{"sub":"ad710000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(public.mova_admin_health() ? 'stripe_webhooks', 'health returns the webhook counts');
select is((select jsonb_array_length(public.mova_admin_health() -> 'stuck_jobs')), 1, 'a dead job is listed as a problem');
select throws_ok($$select public.mova_admin_requeue_job('ad710000-0000-4000-8000-000000000502', 'Requeue a healthy job for no reason')$$, '55000', 'JOB_NOT_REQUEUEABLE', 'a queued job is not requeued');
select throws_ok($$select public.mova_admin_requeue_job('ad710000-0000-4000-8000-000000000501', 'no')$$, '22023', 'REASON_REQUIRED', 'requeueing needs a reason');
select lives_ok($$select public.mova_admin_requeue_job('ad710000-0000-4000-8000-000000000501', 'Worker timed out, retrying after the fix')$$, 'an admin can requeue a dead job');
reset role;
select is((select status from public.mova_background_jobs where id = 'ad710000-0000-4000-8000-000000000501'), 'queued', 'the dead job is queued again');
select is((select attempts from public.mova_background_jobs where id = 'ad710000-0000-4000-8000-000000000501'), 0, 'attempts start again from zero');
select ok((select count(*) from public.mova_admin_activity where action = 'job.requeued') = 1, 'the requeue is logged once');

select * from finish();
rollback;
