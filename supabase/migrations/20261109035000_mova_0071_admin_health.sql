-- A10 system health (admin). 2026-11-09, P6 admin stream. Read-only counts and the problem lists the screen
-- shows, plus one write: requeueing a background job that is dead, failed or whose worker lease expired.
-- Every change is logged to mova_admin_activity with its reason.

create function public.mova_admin_health() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_day timestamptz := now() - interval '24 hours';
begin
  perform public.mova_require_platform_admin();
  return jsonb_build_object(
    'checked_at', now(),
    'stripe_webhooks', jsonb_build_object(
      'received_24h', (select count(*) from public.mova_webhook_events where received_at >= v_day),
      'failed_24h', (select count(*) from public.mova_webhook_events where received_at >= v_day and status = 'failed')),
    'texts', jsonb_build_object(
      'sent_24h', (select count(*) from public.mova_messages where channel = 'sms' and direction = 'outbound' and created_at >= v_day),
      'failed_24h', (select count(*) from public.mova_messages where channel = 'sms' and direction = 'outbound' and status = 'failed' and created_at >= v_day)),
    'emails', jsonb_build_object(
      'sent_24h', (select count(*) from public.mova_messages where channel = 'email' and direction = 'outbound' and created_at >= v_day),
      'failed_24h', (select count(*) from public.mova_messages where channel = 'email' and direction = 'outbound' and status = 'failed' and created_at >= v_day)),
    'calendar', jsonb_build_object(
      'errors', (select count(*) from public.mova_google_calendar_connections where status = 'error'),
      'stylists_affected', (select count(distinct artist_business_id) from public.mova_google_calendar_connections where status = 'error')),
    'jobs', jsonb_build_object(
      'dead_24h', (select count(*) from public.mova_background_jobs where status = 'dead' and updated_at >= v_day),
      'stuck', (select count(*) from public.mova_background_jobs where
        (status = 'queued' and run_at < now() - interval '15 minutes')
        or (status = 'running' and lease_expires_at < now() - interval '15 minutes'))),
    'failed_texts', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'created_at', m.created_at, 'purpose', m.purpose,
        'error_code', m.error_code, 'bid', b.business_number, 'business_name', b.name, 'client_ref', left(m.client_id::text, 8)))
      from (select * from public.mova_messages where channel = 'sms' and direction = 'outbound' and status = 'failed'
        order by created_at desc limit 8) m
      left join public.mova_artist_businesses b on b.id = m.artist_business_id), '[]'::jsonb),
    'webhook_failures', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'event_type', w.event_type,
        'provider_event_id', w.provider_event_id, 'received_at', w.received_at) order by w.received_at desc)
      from (select * from public.mova_webhook_events where status = 'failed' order by received_at desc limit 5) w), '[]'::jsonb),
    'calendar_errors', coalesce((select jsonb_agg(jsonb_build_object('business_id', c.artist_business_id, 'bid', b.business_number,
        'business_name', b.name, 'updated_at', c.updated_at) order by c.updated_at desc)
      from (select * from public.mova_google_calendar_connections where status = 'error' order by updated_at desc limit 5) c
      join public.mova_artist_businesses b on b.id = c.artist_business_id), '[]'::jsonb),
    'stuck_jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'job_type', j.job_type, 'status', j.status,
        'run_at', j.run_at, 'attempts', j.attempts, 'last_error_code', j.last_error_code, 'lease_expires_at', j.lease_expires_at,
        'bid', b.business_number, 'business_name', b.name) order by j.run_at)
      from (select * from public.mova_background_jobs where status in ('dead', 'failed')
          or (status = 'queued' and run_at < now() - interval '15 minutes')
          or (status = 'running' and lease_expires_at < now() - interval '15 minutes')
        order by run_at limit 10) j
      left join public.mova_artist_businesses b on b.id = j.artist_business_id), '[]'::jsonb)
  );
end $$;

create function public.mova_admin_requeue_job(p_job_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.mova_background_jobs%rowtype;
begin
  perform public.mova_require_platform_admin();
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  select * into v_job from public.mova_background_jobs where id = p_job_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'BACKGROUND_JOB_NOT_FOUND'; end if;
  if not (v_job.status in ('dead', 'failed') or (v_job.status = 'running' and v_job.lease_expires_at < now())) then
    raise exception using errcode = '55000', message = 'JOB_NOT_REQUEUEABLE';
  end if;
  update public.mova_background_jobs set status = 'queued', attempts = 0, lease_owner = null, lease_expires_at = null,
    run_at = now(), last_error_code = null, completed_at = null, updated_at = now()
  where id = p_job_id returning * into v_job;
  update public.mova_background_job_alerts set acknowledged_at = now() where job_id = p_job_id and acknowledged_at is null;
  perform public.mova_admin_log('job.requeued', 'background_job', p_job_id::text, v_job.artist_business_id, p_reason,
    jsonb_build_object('job_type', v_job.job_type));
  return jsonb_build_object('id', v_job.id, 'status', v_job.status);
end $$;

revoke all on function public.mova_admin_health() from public, anon;
revoke all on function public.mova_admin_requeue_job(uuid, text) from public, anon;
grant execute on function public.mova_admin_health() to authenticated, service_role;
grant execute on function public.mova_admin_requeue_job(uuid, text) to authenticated, service_role;
