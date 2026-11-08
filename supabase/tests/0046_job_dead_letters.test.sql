begin;
select plan(12);

insert into public.mova_background_jobs(id, job_type, payload, idempotency_key, max_attempts)
values ('e4700000-0000-4000-8000-000000000001', 'appointment_reminder', '{"appointment_id":"e4700000-0000-4000-8000-000000000099"}', 'e47-retry-job', 2);

-- Attempt 1 fails: back to queued with a backoff in the future.
select is((select count(*)::int from public.mova_lease_background_jobs('e47-worker-1', 10, 60) where id = 'e4700000-0000-4000-8000-000000000001'), 1, 'TC-JOB-RETRY-01 a queued job is leased');
select is(public.mova_fail_background_job('e4700000-0000-4000-8000-000000000001', 'e47-worker-1', 'APPOINTMENT_EMAIL_FAILED'), 'queued', 'TC-JOB-RETRY-01 the first failure retries');
select ok((select run_at > now() from public.mova_background_jobs where id = 'e4700000-0000-4000-8000-000000000001'), 'TC-JOB-RETRY-01 with a backoff');
select is((select count(*)::int from public.mova_lease_background_jobs('e47-worker-2', 10, 60) where id = 'e4700000-0000-4000-8000-000000000001'), 0, 'TC-JOB-RETRY-01 it is not leased again before the backoff ends');
select is(public.mova_fail_background_job('e4700000-0000-4000-8000-000000000001', 'e47-worker-1', 'X'), 'lease_lost', 'TC-JOB-RETRY-02 a worker that lost the lease cannot fail the job');

-- Attempt 2 (the last) fails: dead letter.
update public.mova_background_jobs set run_at = now() - interval '1 second' where id = 'e4700000-0000-4000-8000-000000000001';
select is((select attempts from public.mova_lease_background_jobs('e47-worker-3', 10, 60) where id = 'e4700000-0000-4000-8000-000000000001'), 2, 'TC-JOB-RETRY-03 the second lease is attempt 2');
select is(public.mova_fail_background_job('e4700000-0000-4000-8000-000000000001', 'e47-worker-3', 'APPOINTMENT EMAIL FAILED!'), 'dead', 'TC-JOB-RETRY-03 the last failure dead-letters the job');
select is((select last_error_code from public.mova_background_job_dead_letters where job_id = 'e4700000-0000-4000-8000-000000000001'), 'APPOINTMENT_EMAIL_FAILED_', 'TC-JOB-DLQ-01 the dead-letter view shows it with a sanitised error code');
select ok((select alert_id is not null and acknowledged_at is null from public.mova_background_job_dead_letters where job_id = 'e4700000-0000-4000-8000-000000000001'), 'TC-JOB-DLQ-01 with an open alert');

select ok(public.mova_requeue_dead_job('e4700000-0000-4000-8000-000000000001'), 'TC-JOB-DLQ-02 a dead job can be requeued');
select is((select status || ':' || attempts from public.mova_background_jobs where id = 'e4700000-0000-4000-8000-000000000001'), 'queued:0', 'TC-JOB-DLQ-02 with fresh attempts, and it leaves the dead-letter view');
select ok(not has_table_privilege('authenticated', 'public.mova_background_job_dead_letters', 'SELECT') and not has_function_privilege('authenticated', 'public.mova_requeue_dead_job(uuid)', 'EXECUTE'), 'TC-JOB-DLQ-03 only the service role sees or requeues dead jobs');

select * from finish();
rollback;
