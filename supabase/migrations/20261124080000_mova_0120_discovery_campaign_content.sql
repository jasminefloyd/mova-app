-- Keep manually tagged ad and guide links distinct within a campaign.
alter table public.mova_discovery_visits
  add column content text not null default '' check (content ~ '^[a-z0-9._-]{0,120}$');

create function public.mova_record_discovery_event(
  p_visit uuid, p_event uuid, p_path text, p_landing text, p_channel text, p_source text,
  p_medium text, p_campaign text, p_signup_click boolean, p_content text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.mova_discovery_visits(id, landing_path, channel, source, medium, campaign, signup_click, content)
  values (p_visit, p_landing, p_channel, p_source, p_medium, p_campaign, p_signup_click, p_content)
  on conflict (id) do nothing;

  if p_signup_click then
    update public.mova_discovery_visits set signup_click = true where id = p_visit and not signup_click;
  else
    insert into public.mova_discovery_page_views(id, visit_id, path)
    values (p_event, p_visit, p_path) on conflict (id) do nothing;
  end if;
end;
$$;
revoke all on function public.mova_record_discovery_event(uuid, uuid, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.mova_record_discovery_event(uuid, uuid, text, text, text, text, text, text, boolean, text) to service_role;

-- Keep the original signature for existing web clients during rollout.
create or replace function public.mova_record_discovery_event(
  p_visit uuid, p_event uuid, p_path text, p_landing text, p_channel text, p_source text,
  p_medium text, p_campaign text, p_signup_click boolean
) returns void language sql security definer set search_path = public, pg_temp as $$
  select public.mova_record_discovery_event(p_visit, p_event, p_path, p_landing, p_channel,
    p_source, p_medium, p_campaign, p_signup_click, '');
$$;

create or replace function public.mova_admin_discovery() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'UTC')::date;
  today_start timestamptz := today::timestamp at time zone 'UTC';
  cutoff timestamptz := (today - 28)::timestamp at time zone 'UTC';
  prior_start timestamptz := (today - 56)::timestamp at time zone 'UTC';
begin
  perform public.mova_require_platform_admin();
  return (
    with visits as (
      select * from public.mova_discovery_visits
      where started_at >= prior_start and started_at <= now()
    ), current_visits as (
      select *, started_at >= today_start as is_today from visits where started_at >= cutoff
    ), periods as (
      select (started_at >= cutoff) as current_period, count(*) as visits,
        count(*) filter (where signup_click) as signup_clicks,
        coalesce(sum(signups), 0) as signups, count(*) filter (where signups > 0) as converted
      from visits where started_at < today_start group by 1
    ), breakdown as (
      select is_today, case when grouping(landing_path) = 0 then 'landing'
                  when grouping(channel) = 0 and grouping(source) = 1 then 'channel'
                  else 'campaign' end as kind,
        landing_path, channel, source, medium, campaign, content,
        count(*) as visits, count(*) filter (where signup_click) as signup_clicks,
        sum(signups) as signups, count(*) filter (where signups > 0) as converted
      from current_visits
      group by is_today, grouping sets ((landing_path), (channel), (channel, source, medium, campaign, content))
      having grouping(source) = 1 or source <> '' or medium <> '' or campaign <> '' or content <> ''
    ), ranked as (
      select *, row_number() over (partition by is_today, kind order by visits desc, signups desc, landing_path, channel, source, medium, campaign, content) as rank
      from breakdown
    )
    select jsonb_build_object(
      'through', today - 1,
      'current', (select to_jsonb(p) - 'current_period' from periods p where p.current_period),
      'prior', (select to_jsonb(p) - 'current_period' from periods p where not p.current_period),
      'breakdown', coalesce((select jsonb_agg(to_jsonb(r) - 'rank' - 'is_today' order by kind, rank)
        from ranked r where not is_today and rank <= 25), '[]'::jsonb),
      'today_campaigns', coalesce((select jsonb_agg(to_jsonb(r) - 'rank' - 'is_today' order by rank)
        from ranked r where is_today and kind = 'campaign' and rank <= 25), '[]'::jsonb),
      'pages', coalesce((select jsonb_agg(to_jsonb(p) order by p.views desc, p.path) from (
        select v.path, count(*) as views, count(distinct v.visit_id) as visits
        from public.mova_discovery_page_views v
        where v.viewed_at >= cutoff and v.viewed_at < today_start
        group by v.path order by count(*) desc, v.path limit 25
      ) p), '[]'::jsonb),
      'calculator', (select jsonb_build_object(
        'used', coalesce(sum(total) filter (where event = 'calculator_used'), 0),
        'signup_clicks', coalesce(sum(total) filter (where event = 'start_free_clicked'), 0),
        'signups', coalesce(sum(total) filter (where event = 'signup_completed'), 0)
      ) from public.mova_calculator_funnel_daily where day >= today - 28 and day < today)
    )
  );
end;
$$;
revoke all on function public.mova_admin_discovery() from public, anon;
grant execute on function public.mova_admin_discovery() to authenticated;
