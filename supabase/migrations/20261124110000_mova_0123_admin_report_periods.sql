-- Give the admin reports identical UTC boundaries and equal-length comparison windows.
create function public.mova_admin_report_bounds(p_period text, p_start date, p_end date)
returns table (period_start timestamptz, period_end timestamptz)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  as_of timestamptz := now();
  today date := (as_of at time zone 'UTC')::date;
begin
  period_end := as_of;
  case p_period
    when '24h' then period_start := as_of - interval '24 hours';
    when '7d' then period_start := as_of - interval '168 hours';
    when '14d' then period_start := as_of - interval '336 hours';
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
  return next;
end;
$$;
revoke all on function public.mova_admin_report_bounds(text, date, date) from public, anon, authenticated;

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
      'geography', coalesce((select jsonb_agg(to_jsonb(g) order by g.sessions desc, g.country, g.region, g.city) from (
        select city, region_code as region, country, count(*) as sessions, count(distinct visitor_id) as visitors,
          coalesce(sum(signups),0) as signups, count(*) filter (where signups > 0) as converted
        from sessions where is_current
        group by city, region_code, country
        order by count(*) desc, country, region_code, city limit 50
      ) g), '[]'::jsonb),
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

create function public.mova_admin_overview_for_period(
  p_period text, p_start date default null, p_end date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := now();
  v_from timestamptz;
  v_to timestamptz;
  v_prior timestamptz;
begin
  perform public.mova_require_platform_admin();
  select b.period_start, b.period_end into v_from, v_to
  from public.mova_admin_report_bounds(p_period, p_start, p_end) b;
  v_prior := v_from - (v_to - v_from);
  return jsonb_build_object(
    'current', public.mova_admin_overview_window(v_from, v_to),
    'prior', public.mova_admin_overview_window(v_prior, v_from),
    'weekly_active', coalesce((
      select jsonb_agg(jsonb_build_object('week', w.week, 'stylists', w.stylists) order by w.week)
      from (
        select date_trunc('week', a.created_at at time zone 'UTC')::date as week, count(distinct a.artist_business_id) as stylists
        from public.mova_appointments a
        where a.status <> 'draft' and a.created_at >= v_from and a.created_at < v_to
        group by 1
      ) w), '[]'::jsonb),
    'top_stylists', coalesce((
      select jsonb_agg(t order by (t ->> 'completed')::integer desc) from (
        select jsonb_build_object(
          'business_id', b.id, 'bid', b.business_number, 'name', coalesce(p.display_name, b.name), 'business_name', b.name,
          'completed', count(distinct a.id), 'processed_minor', coalesce(sum(pay.amount_minor), 0)) as t
        from public.mova_appointments a
        join public.mova_artist_businesses b on b.id = a.artist_business_id
        left join public.mova_artist_profiles p on p.artist_business_id = b.id
        left join public.mova_payments pay on pay.appointment_id = a.id and pay.collector = 'mova_processed' and pay.status = 'succeeded'
        where a.status = 'completed' and a.starts_at >= v_from and a.starts_at < v_to
        group by b.id, b.business_number, b.name, p.display_name
        order by count(distinct a.id) desc, b.business_number
        limit 5
      ) top), '[]'::jsonb),
    'needs_nudge', jsonb_build_object(
      'quiet', (select count(*) from public.mova_artist_businesses b where b.status = 'active'
        and not exists (select 1 from public.mova_appointments a where a.artist_business_id = b.id and a.created_at >= v_now - interval '14 days')),
      'items', coalesce((
        select jsonb_agg(n order by n ->> 'reason') from (
          (select jsonb_build_object('business_id', b.id, 'bid', b.business_number, 'name', coalesce(p.display_name, b.name),
              'business_name', b.name, 'reason', 'quiet') as n
           from public.mova_artist_businesses b left join public.mova_artist_profiles p on p.artist_business_id = b.id
           where b.status = 'active' and exists (select 1 from public.mova_appointments a where a.artist_business_id = b.id)
             and not exists (select 1 from public.mova_appointments a where a.artist_business_id = b.id and a.created_at >= v_now - interval '14 days')
           order by b.business_number limit 2)
          union all
          (select jsonb_build_object('business_id', b.id, 'bid', b.business_number, 'name', coalesce(p.display_name, b.name),
              'business_name', b.name, 'reason', 'stripe_restricted')
           from public.mova_stripe_connections s join public.mova_artist_businesses b on b.id = s.artist_business_id
           left join public.mova_artist_profiles p on p.artist_business_id = b.id
           where s.status = 'restricted' order by b.business_number limit 2)
          union all
          (select jsonb_build_object('business_id', b.id, 'bid', b.business_number, 'name', coalesce(p.display_name, b.name),
              'business_name', b.name, 'reason', 'published_no_bookings')
           from public.mova_artist_profiles p join public.mova_artist_businesses b on b.id = p.artist_business_id
           where p.is_published and b.status = 'active'
             and not exists (select 1 from public.mova_appointments a where a.artist_business_id = b.id)
           order by b.business_number limit 2)
        ) items), '[]'::jsonb)),
    'language', jsonb_build_object(
      'en_us', (select count(*) from public.mova_artist_profiles p join public.mova_artist_businesses b on b.id = p.artist_business_id where b.status = 'active' and p.preferred_locale = 'en-US'),
      'es_us', (select count(*) from public.mova_artist_profiles p join public.mova_artist_businesses b on b.id = p.artist_business_id where b.status = 'active' and p.preferred_locale = 'es-US'))
  );
end $$;

revoke all on function public.mova_admin_overview_for_period(text, date, date) from public, anon;
grant execute on function public.mova_admin_overview_for_period(text, date, date) to authenticated;

create function public.mova_admin_subscription_summary_for_period(
  p_period text, p_start date default null, p_end date default null
)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  since timestamptz;
  until_at timestamptz;
begin
  perform public.mova_require_platform_admin();
  select b.period_start, b.period_end into since, until_at
  from public.mova_admin_report_bounds(p_period, p_start, p_end) b;
  return (
    with plans as (
      select coalesce(a.plan_key, 'free') as plan, count(*) as accounts
      from public.mova_artist_businesses b
      left join public.mova_business_plan_assignments a on a.artist_business_id = b.id and a.assignment_status = 'current'
      where b.status = 'active' and public.mova_account_available(b.id)
      group by 1
    ), subscriptions as (
      select s.*, c.monthly_price_minor from public.mova_billing_subscriptions s
      join public.mova_plan_catalog c on c.plan_key = s.plan_key
      where s.livemode and s.stripe_subscription_id is not null
    ), trials as (
      select t.* from public.mova_plan_trials t
      join subscriptions s on s.stripe_subscription_id = t.stripe_subscription_id
      where t.started_at is not null
    )
    select jsonb_build_object(
      'plans', coalesce((select jsonb_object_agg(plan, accounts) from plans), '{}'::jsonb),
      'mrr_minor', (select coalesce(sum(monthly_price_minor), 0) from subscriptions where status = 'active'),
      'paid_subscriptions', (select count(*) from subscriptions where status = 'active'),
      'active_trials', (select count(*) from subscriptions where status = 'trialing' and trial_end > now()),
      'expiring_trials', (select count(*) from subscriptions where status = 'trialing' and trial_end > now() and trial_end <= now() + interval '7 days'),
      'trials_converted', (select count(*) from trials where converted_at >= since and converted_at < until_at),
      'trials_resolved', (select count(*) from trials where coalesce(converted_at, ended_at) >= since and coalesce(converted_at, ended_at) < until_at),
      'past_due', (select count(*) from subscriptions where status = 'past_due'),
      'pending_cancellations', (select count(*) from subscriptions where status in ('active', 'trialing', 'past_due') and cancel_at_period_end),
      'billing_events', (select jsonb_build_object(
        'payment_failures', count(*) filter (where type = 'invoice.payment_failed'),
        'cancellations', count(*) filter (where type = 'customer.subscription.deleted')
      ) from public.mova_billing_events
        where livemode and received_at >= since and received_at < until_at and processed_at is not null and error is null),
      'deletion_requests', (select count(*) from public.mova_account_closures where source = 'stylist' and created_at >= since and created_at < until_at),
      'open_deletion_requests', (select count(*) from public.mova_account_closures where source = 'stylist')
    )
  );
end;
$$;
revoke all on function public.mova_admin_subscription_summary_for_period(text, date, date) from public, anon;
grant execute on function public.mova_admin_subscription_summary_for_period(text, date, date) to authenticated;
