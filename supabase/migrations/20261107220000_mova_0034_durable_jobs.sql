create table public.mova_background_jobs (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid unique references public.mova_outbox_events(id) on delete cascade,
  job_type text not null,
  artist_business_id uuid references public.mova_artist_businesses(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','dead')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  lease_owner text,
  lease_expires_at timestamptz,
  idempotency_key text not null unique,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint mova_background_jobs_lease_check check (
    (status = 'running' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'running' and lease_owner is null and lease_expires_at is null)
  ),
  constraint mova_background_jobs_source_check check (outbox_event_id is not null or job_type <> 'outbox_event')
);
create index mova_background_jobs_due_idx on public.mova_background_jobs(run_at, created_at) where status = 'queued';
create index mova_background_jobs_expired_lease_idx on public.mova_background_jobs(lease_expires_at) where status = 'running';

create table public.mova_background_job_alerts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.mova_background_jobs(id) on delete cascade,
  alert_type text not null check (alert_type in ('dead_letter','lease_exhausted')),
  error_code text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique(job_id, alert_type)
);
create index mova_background_job_alerts_open_idx on public.mova_background_job_alerts(created_at) where acknowledged_at is null;

alter table public.mova_background_jobs enable row level security;
alter table public.mova_background_job_alerts enable row level security;
revoke all on public.mova_background_jobs, public.mova_background_job_alerts from public, anon, authenticated;
grant select, insert, update, delete on public.mova_background_jobs, public.mova_background_job_alerts to service_role;

create or replace function public.mova_dispatch_outbox_events(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare queued_count integer;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception using errcode = '22023', message = 'JOB_LIMIT_INVALID'; end if;
  insert into public.mova_background_jobs(outbox_event_id, job_type, artist_business_id, payload, idempotency_key)
  select e.id, 'outbox_event', e.artist_business_id,
    jsonb_build_object('outbox_event_id', e.id, 'event_type', e.event_type), 'outbox:' || e.id::text
  from public.mova_outbox_events e
  where e.delivered_at is null
    and not exists (select 1 from public.mova_background_jobs j where j.outbox_event_id = e.id)
  order by e.occurred_at, e.id
  limit p_limit
  on conflict do nothing;
  get diagnostics queued_count = row_count;
  return queued_count;
end $$;

create or replace function public.mova_lease_background_jobs(p_worker_id text, p_limit integer default 25, p_lease_seconds integer default 120)
returns setof public.mova_background_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_worker_id is null or length(trim(p_worker_id)) not between 1 and 120
    or p_limit not between 1 and 100 or p_lease_seconds not between 15 and 900 then
    raise exception using errcode = '22023', message = 'JOB_LEASE_ARGUMENT_INVALID';
  end if;

  with exhausted as (
    update public.mova_background_jobs j set
      status = 'dead', lease_owner = null, lease_expires_at = null,
      last_error_code = coalesce(j.last_error_code, 'LEASE_EXPIRED'), updated_at = now(), completed_at = now()
    where j.status = 'running' and j.lease_expires_at <= now() and j.attempts >= j.max_attempts
    returning j.id, j.last_error_code
  )
  insert into public.mova_background_job_alerts(job_id, alert_type, error_code)
  select exhausted.id, 'lease_exhausted', exhausted.last_error_code from exhausted
  on conflict(job_id, alert_type) do nothing;

  return query
  with picked as (
    select j.id from public.mova_background_jobs j
    where (j.status = 'queued' and j.run_at <= now())
       or (j.status = 'running' and j.lease_expires_at <= now() and j.attempts < j.max_attempts)
    order by j.run_at, j.created_at, j.id
    for update skip locked
    limit p_limit
  )
  update public.mova_background_jobs j set
    status = 'running', attempts = j.attempts + 1,
    lease_owner = p_worker_id, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  from picked where j.id = picked.id
  returning j.*;
end $$;

create or replace function public.mova_complete_background_job(p_job_id uuid, p_worker_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare completed_id uuid; event_id uuid;
begin
  update public.mova_background_jobs j set
    status = 'succeeded', lease_owner = null, lease_expires_at = null,
    last_error_code = null, completed_at = now(), updated_at = now()
  where j.id = p_job_id and j.status = 'running' and j.lease_owner = p_worker_id
    and j.lease_expires_at > now()
  returning j.id, j.outbox_event_id into completed_id, event_id;
  if completed_id is null then return false; end if;
  if event_id is not null then
    update public.mova_outbox_events set delivered_at = coalesce(delivered_at, now()) where id = event_id;
  end if;
  return true;
end $$;

create or replace function public.mova_fail_background_job(p_job_id uuid, p_worker_id text, p_error_code text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare saved public.mova_background_jobs%rowtype; next_status text;
begin
  update public.mova_background_jobs j set
    status = case when j.attempts >= j.max_attempts then 'dead' else 'queued' end,
    run_at = case when j.attempts >= j.max_attempts then j.run_at else now() + make_interval(secs =>
      greatest(1, floor(least(3600, 15 * power(2, greatest(0, j.attempts - 1))) * (0.5 + random()))::integer)) end,
    lease_owner = null, lease_expires_at = null,
    last_error_code = left(regexp_replace(coalesce(p_error_code, 'JOB_FAILED'), '[^A-Z0-9_.-]', '_', 'g'), 100),
    completed_at = case when j.attempts >= j.max_attempts then now() else null end,
    updated_at = now()
  where j.id = p_job_id and j.status = 'running' and j.lease_owner = p_worker_id
  returning j.* into saved;
  if saved.id is null then return 'lease_lost'; end if;
  next_status := saved.status;
  if next_status = 'dead' then
    insert into public.mova_background_job_alerts(job_id, alert_type, error_code)
    values(saved.id, 'dead_letter', coalesce(saved.last_error_code, 'JOB_FAILED'))
    on conflict(job_id, alert_type) do nothing;
  end if;
  return next_status;
end $$;

revoke all on function public.mova_dispatch_outbox_events(integer) from public, anon, authenticated;
revoke all on function public.mova_lease_background_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.mova_complete_background_job(uuid, text) from public, anon, authenticated;
revoke all on function public.mova_fail_background_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mova_dispatch_outbox_events(integer) to service_role;
grant execute on function public.mova_lease_background_jobs(text, integer, integer) to service_role;
grant execute on function public.mova_complete_background_job(uuid, text) to service_role;
grant execute on function public.mova_fail_background_job(uuid, text, text) to service_role;
