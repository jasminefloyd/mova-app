begin;
select plan(18);

select has_table('public'::name,'mova_background_jobs'::name,'TC-NFR-JOB-01 durable queue table exists');
select has_table('public'::name,'mova_background_job_alerts'::name,'TC-NFR-JOB-01 dead-letter alert table exists');
select has_function('public'::name,'mova_dispatch_outbox_events'::name,array['integer']::name[],'TC-NFR-JOB-01 outbox dispatch RPC is registered');
select has_function('public'::name,'mova_lease_background_jobs'::name,array['text','integer','integer']::name[],'TC-NFR-JOB-01 atomic leasing RPC is registered');

insert into public.mova_outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
values('test','e3400000-0000-4000-8000-000000000001','appointment.created','{}','job-test-event-1');
select is(public.mova_dispatch_outbox_events(10),1,'TC-NFR-JOB-01 pending outbox event is enqueued');
select is(public.mova_dispatch_outbox_events(10),0,'TC-NFR-JOB-01 repeated dispatch does not duplicate the job');
select is((select count(*)::integer from public.mova_background_jobs where idempotency_key like 'outbox:%'),1,'TC-NFR-JOB-01 unique source event and idempotency key produce one job');

create temporary table mova_first_lease as
select * from public.mova_lease_background_jobs('worker-one',1,30);
select is((select status from mova_first_lease),'running','TC-NFR-JOB-02 worker atomically leases a queued job');
select is((select attempts from mova_first_lease),1,'TC-NFR-JOB-02 lease increments attempts');
select is(public.mova_complete_background_job((select id from mova_first_lease),'wrong-worker'),false,'TC-NFR-JOB-02 stale worker cannot acknowledge another worker lease');

update public.mova_background_jobs set lease_expires_at=now()-interval '1 second'
where id=(select id from mova_first_lease);
create temporary table mova_reclaimed_lease as
select * from public.mova_lease_background_jobs('worker-two',1,30);
select is((select attempts from mova_reclaimed_lease),2,'TC-NFR-JOB-03 expired lease is reclaimed after a simulated worker crash');
select is(public.mova_complete_background_job((select id from mova_reclaimed_lease),'worker-one'),false,'TC-NFR-JOB-03 crashed worker cannot acknowledge the reclaimed lease');
select is(public.mova_complete_background_job((select id from mova_reclaimed_lease),'worker-two'),true,'TC-NFR-JOB-03 reclaimed worker can complete the job');
select ok((select delivered_at is not null from public.mova_outbox_events where id=(select outbox_event_id from mova_reclaimed_lease)),'TC-NFR-JOB-03 outbox acknowledgement is atomic with job completion');

insert into public.mova_outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
values('test','e3400000-0000-4000-8000-000000000002','appointment.completed','{}','job-test-event-2');
select is(public.mova_dispatch_outbox_events(10),1,'TC-NFR-JOB-04 second outbox event enters the durable queue');
create temporary table mova_retry_lease as
select * from public.mova_lease_background_jobs('worker-three',1,30);
select is(public.mova_fail_background_job((select id from mova_retry_lease),'worker-three','TEST_FAILURE'),'queued','TC-NFR-JOB-04 transient failure schedules a retry');
update public.mova_background_jobs set attempts=4,run_at=now()-interval '1 second'
where id=(select id from mova_retry_lease);
create temporary table mova_final_lease as
select * from public.mova_lease_background_jobs('worker-four',1,30);
select is(public.mova_fail_background_job((select id from mova_final_lease),'worker-four','TEST_FAILURE'),'dead','TC-NFR-JOB-05 exhausted attempts dead-letter the job');
select ok(exists(select 1 from public.mova_background_job_alerts where job_id=(select id from mova_final_lease) and alert_type='dead_letter'),'TC-NFR-JOB-05 dead-letter creates a durable alert');

select * from finish();
rollback;
