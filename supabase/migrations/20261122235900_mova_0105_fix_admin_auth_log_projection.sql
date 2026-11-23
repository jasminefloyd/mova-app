-- Align Auth audit rows with the application log projection used by the admin search.
create or replace function public.mova_admin_logs_search(
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
      null::uuid,null::bigint,null::text,null::uuid,null::text,''::text,'{}'::jsonb
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
