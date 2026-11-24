-- Browser identifiers are random and independent of Auth. Geography is country-level only.
create table public.mova_discovery_visitors (
  id uuid primary key,
  first_seen_at timestamptz not null
);
alter table public.mova_discovery_visitors enable row level security;
revoke all on public.mova_discovery_visitors from public, anon, authenticated;

alter table public.mova_discovery_visits
  add column visitor_id uuid references public.mova_discovery_visitors(id) on delete set null,
  add column referrer_host text not null default '' check (referrer_host ~ '^[a-z0-9._-]{0,100}$'),
  add column device text not null default 'Unknown' check (device in ('Desktop', 'Mobile', 'Tablet', 'Unknown')),
  add column browser text not null default 'Unknown' check (browser in ('Chrome', 'Safari', 'Firefox', 'Edge', 'Opera', 'Samsung Internet', 'Other', 'Unknown')),
  add column country text not null default '' check (country ~ '^([A-Z]{2})?$');
create index mova_discovery_visits_visitor_idx on public.mova_discovery_visits(visitor_id) where visitor_id is not null;

create function public.mova_record_website_traffic_event(
  p_visit uuid, p_event uuid, p_path text, p_landing text, p_channel text, p_source text,
  p_campaign text, p_content text, p_signup_click boolean, p_audience jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  browser_id uuid := nullif(p_audience->>'visitor', '')::uuid;
  started timestamptz;
begin
  perform public.mova_record_discovery_event(
    p_visit, p_event, p_path, p_landing, p_channel, p_source, '', p_campaign, p_signup_click, p_content
  );

  select started_at into started from public.mova_discovery_visits where id = p_visit;
  if browser_id is not null then
    insert into public.mova_discovery_visitors (id, first_seen_at) values (browser_id, started)
    on conflict (id) do update set first_seen_at = excluded.first_seen_at
      where excluded.first_seen_at < mova_discovery_visitors.first_seen_at;
  end if;

  update public.mova_discovery_visits
  set visitor_id = coalesce(visitor_id, browser_id),
      referrer_host = case when referrer_host = '' then coalesce(p_audience->>'referrer', '') else referrer_host end,
      device = case when device = 'Unknown' then coalesce(p_audience->>'device', 'Unknown') else device end,
      browser = case when browser = 'Unknown' then coalesce(p_audience->>'browser', 'Unknown') else browser end,
      country = case when country = '' then coalesce(p_audience->>'country', '') else country end
  where id = p_visit and (visitor_id is null or device = 'Unknown' or browser = 'Unknown');
end;
$$;
revoke all on function public.mova_record_website_traffic_event(uuid,uuid,text,text,text,text,text,text,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.mova_record_website_traffic_event(uuid,uuid,text,text,text,text,text,text,boolean,jsonb) to service_role;

create function public.mova_admin_website_traffic(
  p_period text default '28d', p_start date default null, p_end date default null
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  as_of timestamptz := now();
  today date := (as_of at time zone 'UTC')::date;
  period_start timestamptz;
  period_end timestamptz := as_of;
  prior_start timestamptz;
begin
  perform public.mova_require_platform_admin();
  case p_period
    when '24h' then period_start := as_of - interval '24 hours';
    when '7d' then period_start := as_of - interval '168 hours';
    when '28d' then period_start := as_of - interval '672 hours';
    when '3mo' then period_start := ((as_of at time zone 'UTC') - interval '3 months') at time zone 'UTC';
    when 'custom' then
      if p_start is null or p_end is null or p_start > p_end or p_end > today then
        raise exception using errcode = '22023', message = 'TRAFFIC_DATE_RANGE_INVALID';
      end if;
      period_start := p_start::timestamp at time zone 'UTC';
      period_end := least(as_of, (p_end + 1)::timestamp at time zone 'UTC');
    else raise exception using errcode = '22023', message = 'TRAFFIC_PERIOD_INVALID';
  end case;
  prior_start := period_start - (period_end - period_start);
  return (
    with sessions as materialized (
      select v.*, a.first_seen_at, v.started_at >= period_start as is_current
      from public.mova_discovery_visits v
      left join public.mova_discovery_visitors a on a.id = v.visitor_id
      where v.started_at >= prior_start
        and (v.started_at < period_end or (period_end = as_of and v.started_at = as_of))
    ), views as materialized (
      select p.path, p.visit_id, p.viewed_at >= period_start as is_current
      from public.mova_discovery_page_views p
      where p.viewed_at >= prior_start
        and (p.viewed_at < period_end or (period_end = as_of and p.viewed_at = as_of))
    ), view_counts as (
      select is_current, count(*) as page_views from views group by 1
    ), totals as (
      select p.is_current,
        count(s.id) as sessions, count(s.visitor_id) as identified_sessions,
        count(distinct s.visitor_id) as visitors,
        count(distinct s.visitor_id) filter (where s.first_seen_at >= p.starts_at) as new_users,
        count(distinct s.visitor_id) filter (where s.first_seen_at < p.starts_at) as returning_users,
        count(s.id) filter (where s.signup_click) as signup_clicks,
        coalesce(sum(s.signups),0) as signups,
        count(s.id) filter (where s.signups > 0) as converted,
        coalesce(w.page_views,0) as page_views
      from (values (true,period_start), (false,prior_start)) p(is_current, starts_at)
      left join sessions s on s.is_current = p.is_current
      left join view_counts w on w.is_current = p.is_current
      group by p.is_current, p.starts_at, w.page_views
    ), grouped as (
      select d.kind, d.label, count(*) as sessions,
        count(distinct s.visitor_id) as visitors,
        coalesce(sum(s.signups),0) as signups,
        count(*) filter (where s.signups > 0) as converted
      from sessions s
      cross join lateral (values
        ('landing', s.landing_path),
        ('channel', s.channel),
        ('source', coalesce(nullif(s.source, ''), 'Direct / unknown')),
        ('referrer', coalesce(nullif(s.referrer_host, ''), 'Unknown')),
        ('device', s.device),
        ('browser', s.browser),
        ('country', coalesce(nullif(s.country, ''), 'Unknown')),
        ('campaign', case when s.campaign = 'aig_pp_search' then
          case when s.content = 'pricepilot' then 'aig_pp_search / pricepilot'
               when s.content = '' then 'aig_pp_search / content unavailable' end end)
      ) d(kind,label)
      where s.is_current and d.label is not null
      group by d.kind, d.label
    ), ranked as (
      select *, row_number() over (partition by kind order by sessions desc, label) as rank
      from grouped
    )
    select jsonb_build_object(
      'start', period_start,
      'through', period_end,
      'current', (select to_jsonb(t) - 'is_current' from totals t where is_current),
      'prior', (select to_jsonb(t) - 'is_current' from totals t where not is_current),
      'breakdown', coalesce((select jsonb_agg(to_jsonb(r) - 'rank' order by kind, rank)
        from ranked r where rank <= 50), '[]'::jsonb),
      'pages', coalesce((select jsonb_agg(to_jsonb(p) order by p.views desc, p.path) from (
        select path, count(*) as views, count(distinct visit_id) as sessions
        from views where is_current group by path order by count(*) desc, path limit 50
      ) p), '[]'::jsonb),
      'calculator', (select jsonb_build_object(
        'used', coalesce(sum(total) filter (where event = 'calculator_used'),0),
        'signup_clicks', coalesce(sum(total) filter (where event = 'start_free_clicked'),0),
        'signups', coalesce(sum(total) filter (where event = 'signup_completed'),0)
      ) from public.mova_calculator_funnel_daily where day between (period_start at time zone 'UTC')::date
        and ((period_end - interval '1 microsecond') at time zone 'UTC')::date)
    )
  );
end;
$$;
revoke all on function public.mova_admin_website_traffic(text,date,date) from public, anon;
grant execute on function public.mova_admin_website_traffic(text,date,date) to authenticated;
