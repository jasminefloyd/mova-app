-- Unified, append-only operational log stream. Sensitive values are deliberately not stored.
create table public.mova_system_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  level text not null check (level in ('info','warning','error')),
  source text not null check (source in ('web','function','database','auth','webhook','job','provider')),
  event_name text not null check (length(event_name) between 1 and 120),
  request_id text check (request_id is null or length(request_id) <= 80),
  route_or_function text check (route_or_function is null or length(route_or_function) <= 160),
  http_status integer check (http_status is null or http_status between 100 and 599),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  user_id uuid,
  artist_business_id uuid,
  client_id uuid,
  error_code text check (error_code is null or length(error_code) <= 120),
  message text not null default '' check (length(message) <= 240),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 4096)
);
create index mova_system_logs_occurred_idx on public.mova_system_logs (occurred_at desc, id desc);
create index mova_system_logs_level_idx on public.mova_system_logs (level, occurred_at desc);
create index mova_system_logs_source_idx on public.mova_system_logs (source, occurred_at desc);
create index mova_system_logs_request_idx on public.mova_system_logs (request_id) where request_id is not null;
create index mova_system_logs_business_idx on public.mova_system_logs (artist_business_id, occurred_at desc) where artist_business_id is not null;
alter table public.mova_system_logs enable row level security;
revoke all on public.mova_system_logs from public, anon, authenticated;
grant select, insert on public.mova_system_logs to service_role;
grant usage, select on sequence public.mova_system_logs_id_seq to service_role;

create function public.mova_system_logs_append_only() returns trigger language plpgsql
set search_path = public, pg_temp as $$
begin
  if tg_op='DELETE' and current_setting('mova.system_log_cleanup',true)='on' then return old; end if;
  raise exception using errcode='42501', message='SYSTEM_LOGS_APPEND_ONLY';
end $$;
revoke all on function public.mova_system_logs_append_only() from public, anon, authenticated;
create trigger mova_system_logs_append_only before update or delete on public.mova_system_logs
for each row execute function public.mova_system_logs_append_only();

-- The only writer exposed to Edge Functions; bounded and allowlisted input prevents payload logging.
create function public.mova_system_log_append(
  p_level text, p_source text, p_event_name text, p_request_id text default null,
  p_route_or_function text default null, p_http_status integer default null, p_duration_ms integer default null,
  p_user_id uuid default null, p_artist_business_id uuid default null, p_client_id uuid default null,
  p_error_code text default null, p_message text default '', p_context jsonb default '{}'::jsonb
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception using errcode='42501', message='SERVICE_ROLE_REQUIRED'; end if;
  insert into public.mova_system_logs(level,source,event_name,request_id,route_or_function,http_status,duration_ms,
    user_id,artist_business_id,client_id,error_code,message,context)
  values (
    case when p_level in ('info','warning','error') then p_level else 'error' end,
    case when p_source in ('web','function','database','auth','webhook','job','provider') then p_source else 'function' end,
    left(coalesce(nullif(p_event_name,''),'unknown'),120), left(p_request_id,80), left(p_route_or_function,160),
    p_http_status, greatest(p_duration_ms,0), p_user_id, p_artist_business_id, p_client_id,
    left(p_error_code,120), left(coalesce(p_message,''),240),
    case when jsonb_typeof(p_context)='object' and pg_column_size(p_context)<=4096 then p_context else '{}'::jsonb end
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.mova_system_log_append(text,text,text,text,text,integer,integer,uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.mova_system_log_append(text,text,text,text,text,integer,integer,uuid,uuid,uuid,text,text,jsonb) to service_role;

-- Minimal atomic rate limit for browser reports; store only a short-lived digest of the source IP.
create table public.mova_client_log_limits (
  ip_digest text primary key check (length(ip_digest)=64),
  window_started_at timestamptz not null,
  event_count integer not null check (event_count between 1 and 1000)
);
alter table public.mova_client_log_limits enable row level security;
revoke all on public.mova_client_log_limits from public, anon, authenticated;
grant select, insert, update, delete on public.mova_client_log_limits to service_role;

create function public.mova_client_log_rate_limit(p_ip_digest text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' or coalesce(p_ip_digest,'') !~ '^[0-9a-f]{64}$' then return false; end if;
  insert into public.mova_client_log_limits(ip_digest,window_started_at,event_count)
  values(p_ip_digest,now(),1)
  on conflict(ip_digest) do update set
    window_started_at=case when public.mova_client_log_limits.window_started_at < now()-interval '10 minutes' then now() else public.mova_client_log_limits.window_started_at end,
    event_count=case when public.mova_client_log_limits.window_started_at < now()-interval '10 minutes' then 1 else public.mova_client_log_limits.event_count+1 end
  returning event_count into v_count;
  delete from public.mova_client_log_limits where window_started_at < now()-interval '1 day';
  return v_count <= 30;
end $$;
revoke all on function public.mova_client_log_rate_limit(text) from public, anon, authenticated;
grant execute on function public.mova_client_log_rate_limit(text) to service_role;

-- A single read function backs the admin screen. It returns summaries only, never payload/context.
create function public.mova_admin_logs_search(
  p_from timestamptz default null, p_to timestamptz default null, p_level text default null,
  p_source text default null, p_stylist text default null, p_business_id uuid default null, p_user_id uuid default null,
  p_request_id text default null, p_search text default null, p_limit integer default 100,
  p_before timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_admin uuid := public.mova_require_platform_admin(); v_limit integer := least(greatest(coalesce(p_limit,100),1),1000); v_rows jsonb;
begin
  if p_level is not null and p_level not in ('info','warning','error') then raise exception using errcode='22023',message='LOG_LEVEL_INVALID'; end if;
  if p_source is not null and p_source not in ('web','function','database','auth','webhook','job','provider') then raise exception using errcode='22023',message='LOG_SOURCE_INVALID'; end if;
  with log_rows as (
    select l.id::text as id,l.occurred_at,l.level,l.source,l.event_name,l.request_id,l.route_or_function,l.http_status,
      l.duration_ms,l.user_id,l.artist_business_id,b.business_number as bid,
      coalesce(p.display_name,b.name) as business_name,l.client_id,l.error_code,l.message,l.context
    from public.mova_system_logs l
    left join public.mova_artist_businesses b on b.id=l.artist_business_id
    left join public.mova_artist_profiles p on p.artist_business_id=b.id
    union all
    select 'auth:'||a.id::text,a.created_at,
      case when coalesce(a.payload::jsonb->>'action','') ilike '%fail%' then 'warning' else 'info' end,
      'auth', 'auth.'||left(coalesce(a.payload::jsonb->>'action','event'),100),a.payload::jsonb->>'request_id',null,null,null,
      case when coalesce(a.payload::jsonb->>'actor_id',a.payload::jsonb->>'user_id','') ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        then coalesce(a.payload::jsonb->>'actor_id',a.payload::jsonb->>'user_id')::uuid else null end,
      null,null,null,null,'', '{}'::jsonb
    from auth.audit_log_entries a
  ), filtered as (
    select * from log_rows l
    where (p_from is null or l.occurred_at>=p_from) and (p_to is null or l.occurred_at<p_to)
      and (p_before is null or l.occurred_at<p_before) and (p_level is null or l.level=p_level)
      and (p_source is null or l.source=p_source) and (p_business_id is null or l.artist_business_id=p_business_id)
      and (p_stylist is null or l.business_name ilike '%'||left(p_stylist,100)||'%' or l.artist_business_id::text ilike '%'||left(p_stylist,100)||'%' or ('B'||coalesce(l.bid::text,'')) ilike '%'||left(p_stylist,100)||'%')
      and (p_user_id is null or l.user_id=p_user_id) and (p_request_id is null or l.request_id=p_request_id)
      and (p_search is null or l.event_name ilike '%'||left(p_search,100)||'%' or l.message ilike '%'||left(p_search,100)||'%' or l.error_code ilike '%'||left(p_search,100)||'%')
  )
  select coalesce(jsonb_agg(to_jsonb(q) order by q.occurred_at desc,q.id desc),'[]'::jsonb) into v_rows
  from (select * from filtered order by occurred_at desc,id desc limit v_limit) q;
  perform public.mova_admin_log('logs.viewed','system_logs',null,null,null,jsonb_build_object('rows',jsonb_array_length(v_rows)));
  return jsonb_build_object('rows',v_rows,'has_more',jsonb_array_length(v_rows)=v_limit);
end $$;
revoke all on function public.mova_admin_logs_search(timestamptz,timestamptz,text,text,text,uuid,uuid,text,text,integer,timestamptz) from public,anon;
grant execute on function public.mova_admin_logs_search(timestamptz,timestamptz,text,text,text,uuid,uuid,text,text,integer,timestamptz) to authenticated,service_role;

create function public.mova_admin_logs_exported(p_count integer,p_format text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.mova_require_platform_admin();
  perform public.mova_admin_log(case when p_format='csv' then 'logs.exported' when p_format='view' then 'logs.detail_viewed' else 'logs.copied' end,
    'system_logs',null,null,null,jsonb_build_object('count',least(greatest(coalesce(p_count,0),0),1000),'format',case when p_format='csv' then 'csv' else 'text' end));
end $$;
revoke all on function public.mova_admin_logs_exported(integer,text) from public,anon;
grant execute on function public.mova_admin_logs_exported(integer,text) to authenticated,service_role;

-- Remove info after 30d; warning/error after 90d. The existing scheduled job-dispatch invokes this;
-- the gate makes it perform work at most once per day.
create table public.mova_system_log_maintenance (
  id boolean primary key default true check (id),
  last_run_at timestamptz
);
insert into public.mova_system_log_maintenance(id,last_run_at) values(true,null);
alter table public.mova_system_log_maintenance enable row level security;
revoke all on public.mova_system_log_maintenance from public,anon,authenticated;
grant select,insert,update on public.mova_system_log_maintenance to service_role;

create function public.mova_system_logs_cleanup() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_deleted integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('mova_system_logs_cleanup'));
  if exists(select 1 from public.mova_system_log_maintenance where id=true and last_run_at>now()-interval '1 day') then return 0; end if;
  perform set_config('mova.system_log_cleanup','on',true);
  delete from public.mova_system_logs where (level='info' and occurred_at<now()-interval '30 days')
    or (level in ('warning','error') and occurred_at<now()-interval '90 days');
  get diagnostics v_deleted=row_count;
  update public.mova_system_log_maintenance set last_run_at=now() where id=true;
  delete from public.mova_client_log_limits where window_started_at < now()-interval '1 day';
  return v_deleted;
end $$;
revoke all on function public.mova_system_logs_cleanup() from public,anon,authenticated;
grant execute on function public.mova_system_logs_cleanup() to service_role;

create table public.mova_system_log_alert_claims (
  fingerprint text primary key check (length(fingerprint) between 1 and 80),
  claimed_at timestamptz not null default now()
);
alter table public.mova_system_log_alert_claims enable row level security;
revoke all on public.mova_system_log_alert_claims from public,anon,authenticated;
grant select,insert,update,delete on public.mova_system_log_alert_claims to service_role;

create function public.mova_system_log_alert_snapshot() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  return jsonb_build_object(
    'errors_15m',(select count(*) from public.mova_system_logs where level='error' and occurred_at>=now()-interval '15 minutes'),
    'dead_jobs',(select count(*) from public.mova_background_jobs where status='dead')
  );
end $$;
revoke all on function public.mova_system_log_alert_snapshot() from public,anon,authenticated;
grant execute on function public.mova_system_log_alert_snapshot() to service_role;

create function public.mova_system_log_alert_claim(p_fingerprint text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if coalesce(auth.role(),'')<>'service_role' or coalesce(p_fingerprint,'') !~ '^[a-z0-9_-]{1,80}$' then return false; end if;
  insert into public.mova_system_log_alert_claims(fingerprint,claimed_at) values(p_fingerprint,now())
  on conflict(fingerprint) do update set claimed_at=now()
    where public.mova_system_log_alert_claims.claimed_at<now()-interval '1 hour';
  get diagnostics v_count=row_count;
  delete from public.mova_system_log_alert_claims where claimed_at<now()-interval '30 days';
  return v_count=1;
end $$;
revoke all on function public.mova_system_log_alert_claim(text) from public,anon,authenticated;
grant execute on function public.mova_system_log_alert_claim(text) to service_role;
