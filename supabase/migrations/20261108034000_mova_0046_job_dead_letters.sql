-- Task 4.6: a dead-letter view for operators and a safe way to retry a dead job.
-- Service role only (the admin portal that will show it is out of scope).

create view public.mova_background_job_dead_letters
with (security_invoker = true) as
select j.id as job_id, j.job_type, j.artist_business_id, j.attempts, j.max_attempts, j.last_error_code,
  j.idempotency_key, j.payload, j.created_at, j.completed_at as dead_at,
  a.id as alert_id, a.acknowledged_at
from public.mova_background_jobs j
left join public.mova_background_job_alerts a on a.job_id = j.id and a.alert_type = 'dead_letter'
where j.status = 'dead';
revoke all on public.mova_background_job_dead_letters from public, anon, authenticated;
grant select on public.mova_background_job_dead_letters to service_role;

-- Puts a dead job back in the queue with fresh attempts and acknowledges its alert. Only dead jobs.
create or replace function public.mova_requeue_dead_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.mova_background_jobs set status = 'queued', attempts = 0, run_at = now(), last_error_code = null,
    completed_at = null, updated_at = now()
  where id = p_job_id and status = 'dead';
  if not found then return false; end if;
  update public.mova_background_job_alerts set acknowledged_at = now()
  where job_id = p_job_id and alert_type = 'dead_letter' and acknowledged_at is null;
  return true;
end $$;
revoke all on function public.mova_requeue_dead_job(uuid) from public, anon, authenticated;
grant execute on function public.mova_requeue_dead_job(uuid) to service_role;
