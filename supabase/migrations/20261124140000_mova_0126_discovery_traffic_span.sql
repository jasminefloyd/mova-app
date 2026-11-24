-- Show when traffic in the selected window was actually recorded.
create or replace function public.mova_admin_website_traffic(
  p_period text default '28d', p_start date default null, p_end date default null
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  as_of timestamptz := now();
  period_start timestamptz;
  period_end timestamptz;
  prior_start timestamptz;
begin
  perform public.mova_require_platform_admin();
  select b.period_start, b.period_end into period_start, period_end
  from public.mova_admin_report_bounds(p_period, p_start, p_end) b;
  prior_start := period_start - (period_end - period_start);
  return (
    with sessions as materialized (
      select v.*, a.first_seen_at, v.started_at >= period_start as is_current
      from public.mova_discovery_visits v
      left join public.mova_discovery_visitors a on a.id = v.visitor_id
      where v.started_at >= prior_start
        and (v.started_at < period_end or (period_end = as_of and v.started_at = as_of))
    ), views as materialized (
      select p.path, p.visit_id, p.viewed_at, p.viewed_at >= period_start as is_current
      from public.mova_discovery_page_views p
      where p.viewed_at >= prior_start
        and (p.viewed_at < period_end or (period_end = as_of and p.viewed_at = as_of))
    ), traffic_span as (
      select least(s.first_at, v.first_at) as first_at, greatest(s.last_at, v.last_at) as last_at
      from (select min(started_at) as first_at, max(started_at) as last_at from sessions where is_current) s
      cross join (select min(viewed_at) as first_at, max(viewed_at) as last_at from views where is_current) v
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
      'traffic_span', (select to_jsonb(span) from traffic_span span where span.first_at is not null),
      'current', (select to_jsonb(t) - 'is_current' from totals t where is_current),
      'prior', (select to_jsonb(t) - 'is_current' from totals t where not is_current),
      'breakdown', coalesce((select jsonb_agg(to_jsonb(r) - 'rank' order by kind, rank)
        from ranked r where rank <= 50), '[]'::jsonb),
      'pages', coalesce((select jsonb_agg(to_jsonb(p) order by p.views desc, p.path) from (
        select path, count(*) as views, count(distinct visit_id) as sessions
        from views where is_current group by path order by count(*) desc, path limit 50
      ) p), '[]'::jsonb),
      'geography', coalesce((select jsonb_agg(to_jsonb(g) order by g.sessions desc, g.country, g.region, g.city) from (
        select city, region_code as region, country, count(*) as sessions, count(distinct visitor_id) as visitors,
          coalesce(sum(signups),0) as signups, count(*) filter (where signups > 0) as converted
        from sessions where is_current
        group by city, region_code, country
        order by count(*) desc, country, region_code, city limit 50
      ) g), '[]'::jsonb),
      'calculator', public.mova_calculator_funnel_for_period(period_start, period_end)
    )
  );
end;
$$;
