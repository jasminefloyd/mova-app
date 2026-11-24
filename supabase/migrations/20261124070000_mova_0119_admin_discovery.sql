-- First-party marketing visits. Store only public paths, a referrer host, and campaign labels.
create table public.mova_discovery_visits (
  id uuid primary key,
  started_at timestamptz not null default now(),
  landing_path text not null check (landing_path ~ '^/(features|pricing|calculator|signup|guides(/[a-z0-9-]{1,140})?)?$'),
  channel text not null check (channel in ('organic search','paid search','social','email','referral','direct / unknown','other campaign')),
  source text not null check (source ~ '^[a-z0-9._-]{0,100}$'),
  medium text not null check (medium ~ '^[a-z0-9._-]{0,100}$'),
  campaign text not null check (campaign ~ '^[a-z0-9._-]{0,100}$'),
  signup_click boolean not null default false,
  signups integer not null default 0
);
create index mova_discovery_visits_started_idx on public.mova_discovery_visits(started_at);

create table public.mova_discovery_page_views (
  id uuid primary key,
  visit_id uuid not null references public.mova_discovery_visits(id) on delete cascade,
  path text not null check (path ~ '^/(features|pricing|calculator|signup|guides(/[a-z0-9-]{1,140})?)?$'),
  viewed_at timestamptz not null default now()
);
create index mova_discovery_page_views_visit_idx on public.mova_discovery_page_views(visit_id);
create index mova_discovery_page_views_time_idx on public.mova_discovery_page_views(viewed_at);

alter table public.mova_discovery_visits enable row level security;
alter table public.mova_discovery_page_views enable row level security;
revoke all on public.mova_discovery_visits, public.mova_discovery_page_views from public, anon, authenticated;

create function public.mova_record_discovery_event(
  p_visit uuid, p_event uuid, p_path text, p_landing text, p_channel text, p_source text,
  p_medium text, p_campaign text, p_signup_click boolean
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.mova_discovery_visits(id, landing_path, channel, source, medium, campaign, signup_click)
  values (p_visit, p_landing, p_channel, p_source, p_medium, p_campaign, p_signup_click)
  on conflict (id) do nothing;

  if p_signup_click then
    update public.mova_discovery_visits set signup_click = true where id = p_visit and not signup_click;
  else
    insert into public.mova_discovery_page_views(id, visit_id, path)
    values (p_event, p_visit, p_path) on conflict (id) do nothing;
  end if;
end;
$$;
revoke all on function public.mova_record_discovery_event(uuid, uuid, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mova_record_discovery_event(uuid, uuid, text, text, text, text, text, text, boolean) to service_role;

-- Count the first verified email for users created in the stylist signup flow.
-- A separate session identifier is never needed after conversion.
create function public.mova_record_discovery_signup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  visit text := new.raw_user_meta_data ->> 'mova_discovery_visit';
begin
  if new.email_confirmed_at is null or (tg_op = 'UPDATE' and old.email_confirmed_at is not null)
    or nullif(trim(new.raw_user_meta_data ->> 'first_name'), '') is null
    or nullif(trim(new.raw_user_meta_data ->> 'last_name'), '') is null
    or visit is null or visit !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  then return new; end if;

  update public.mova_discovery_visits set signups = signups + 1
  where id = visit::uuid
    and started_at <= new.created_at
    and new.email_confirmed_at < started_at + interval '24 hours';
  return new;
exception when others then
  raise warning 'Mova discovery signup recording failed (%)', sqlstate;
  return new;
end;
$$;
revoke all on function public.mova_record_discovery_signup() from public, anon, authenticated;
create trigger mova_discovery_email_verified after insert or update of email_confirmed_at on auth.users
for each row execute function public.mova_record_discovery_signup();

create function public.mova_admin_discovery() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'UTC')::date;
  cutoff timestamptz := (today - 28)::timestamp at time zone 'UTC';
  prior_start timestamptz := (today - 56)::timestamp at time zone 'UTC';
begin
  perform public.mova_require_platform_admin();
  return (
    with visits as (
      select * from public.mova_discovery_visits
      where started_at >= prior_start and started_at < (today::timestamp at time zone 'UTC')
    ), current_visits as (
      select * from visits where started_at >= cutoff
    ), periods as (
      select (started_at >= cutoff) as current_period, count(*) as visits,
        count(*) filter (where signup_click) as signup_clicks,
        coalesce(sum(signups), 0) as signups, count(*) filter (where signups > 0) as converted
      from visits group by 1
    ), breakdown as (
      select case when grouping(landing_path) = 0 then 'landing'
                  when grouping(channel) = 0 and grouping(source) = 1 then 'channel'
                  else 'campaign' end as kind,
        landing_path, channel, source, medium, campaign,
        count(*) as visits, count(*) filter (where signup_click) as signup_clicks,
        sum(signups) as signups, count(*) filter (where signups > 0) as converted
      from current_visits
      group by grouping sets ((landing_path), (channel), (channel, source, medium, campaign))
      having grouping(source) = 1 or source <> '' or medium <> '' or campaign <> ''
    ), ranked as (
      select *, row_number() over (partition by kind order by visits desc, signups desc, landing_path, channel, source, medium, campaign) as rank
      from breakdown
    )
    select jsonb_build_object(
      'through', today - 1,
      'current', (select to_jsonb(p) - 'current_period' from periods p where p.current_period),
      'prior', (select to_jsonb(p) - 'current_period' from periods p where not p.current_period),
      'breakdown', coalesce((select jsonb_agg(to_jsonb(r) - 'rank' order by kind, rank) from ranked r where rank <= 25), '[]'::jsonb),
      'pages', coalesce((select jsonb_agg(to_jsonb(p) order by p.views desc, p.path) from (
        select v.path, count(*) as views, count(distinct v.visit_id) as visits
        from public.mova_discovery_page_views v
        where v.viewed_at >= cutoff and v.viewed_at < (today::timestamp at time zone 'UTC')
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

-- Six monthly cohorts, including verified signups that have yet to create a business.
create function public.mova_admin_activation() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  current_month timestamp := date_trunc('month', now() at time zone 'UTC');
begin
  perform public.mova_require_platform_admin();
  return (
    with signups as (
      select u.id, u.email_confirmed_at as verified
      from auth.users u
      where u.email_confirmed_at >= ((current_month - interval '5 months') at time zone 'UTC')
        and u.email_confirmed_at <= now() and u.deleted_at is null
        and not exists (select 1 from public.mova_platform_admins a where a.user_id = u.id)
        and (exists (select 1 from public.mova_account_names n where n.user_id = u.id)
          or exists (select 1 from public.mova_artist_memberships m where m.user_id = u.id and m.role = 'owner'))
    ), milestones as (
      select date_trunc('month', s.verified at time zone 'UTC')::date as cohort, s.verified,
        activity.published, activity.booked, activity.completed
      from signups s
      cross join lateral (
        select min(p.published_at) filter (where p.published_at >= s.verified) as published,
          min(bk.booked) as booked, min(bk.completed) as completed
        from public.mova_artist_memberships m
        join public.mova_artist_businesses b on b.id = m.artist_business_id and b.status <> 'deleted'
        left join public.mova_artist_profiles p on p.artist_business_id = b.id
        cross join lateral (
          select min(a.created_at) filter (where a.created_at >= s.verified) as booked,
            min(e.completed_at) filter (where e.completed_at >= s.verified) as completed
          from public.mova_appointments a
          left join lateral (
            select min(ev.occurred_at) as completed_at from public.mova_appointment_events ev
            where ev.appointment_id = a.id and ev.to_status = 'completed'
          ) e on a.status = 'completed'
          where a.artist_business_id = b.id and a.status <> 'draft'
        ) bk
        where m.user_id = s.id and m.role = 'owner'
      ) activity
    ), cohorts as (
      select cohort, count(*) as verified, count(published) as published,
        count(booked) as booked, count(completed) as completed,
        percentile_cont(0.5) within group (order by extract(epoch from published - verified) / 3600)::numeric(12,1) as published_hours,
        percentile_cont(0.5) within group (order by extract(epoch from booked - verified) / 3600)::numeric(12,1) as booked_hours,
        percentile_cont(0.5) within group (order by extract(epoch from completed - verified) / 3600)::numeric(12,1) as completed_hours
      from milestones group by cohort
    )
    select coalesce(jsonb_agg(to_jsonb(c) order by cohort desc), '[]'::jsonb) from cohorts c
  );
end;
$$;
revoke all on function public.mova_admin_activation() from public, anon;
grant execute on function public.mova_admin_activation() to authenticated;

create function public.mova_admin_subscription_summary(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 7), 90));
begin
  perform public.mova_require_platform_admin();
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
      'trials_converted', (select count(*) from trials where converted_at >= since),
      'trials_resolved', (select count(*) from trials where coalesce(converted_at, ended_at) >= since),
      'past_due', (select count(*) from subscriptions where status = 'past_due'),
      'pending_cancellations', (select count(*) from subscriptions where status in ('active', 'trialing', 'past_due') and cancel_at_period_end),
      'billing_events', (select jsonb_build_object(
        'payment_failures', count(*) filter (where type = 'invoice.payment_failed'),
        'cancellations', count(*) filter (where type = 'customer.subscription.deleted')
      ) from public.mova_billing_events
        where livemode and received_at >= since and processed_at is not null and error is null),
      'deletion_requests', (select count(*) from public.mova_account_closures where source = 'stylist' and created_at >= since),
      'open_deletion_requests', (select count(*) from public.mova_account_closures where source = 'stylist')
    )
  );
end;
$$;
revoke all on function public.mova_admin_subscription_summary(integer) from public, anon;
grant execute on function public.mova_admin_subscription_summary(integer) to authenticated;

-- Use the same appointment start-time population for the no-show numerator and denominator.
create or replace function public.mova_admin_overview_window(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'active_stylists', (select count(distinct a.artist_business_id) from public.mova_appointments a
      join public.mova_artist_businesses b on b.id = a.artist_business_id
      where b.status = 'active' and a.status <> 'draft' and a.created_at >= p_from and a.created_at < p_to),
    'new_signups', (select count(*) from public.mova_artist_businesses where created_at >= p_from and created_at < p_to),
    'bookings_made', (select count(*) from public.mova_appointments where status <> 'draft' and created_at >= p_from and created_at < p_to),
    'appointments_due', (select count(*) from public.mova_appointments
      where status in ('confirmed','completed','no_show') and starts_at >= p_from and starts_at < p_to),
    'completed', (select count(*) from public.mova_appointments where status = 'completed' and starts_at >= p_from and starts_at < p_to),
    'no_shows', (select count(*) from public.mova_appointments where status = 'no_show' and starts_at >= p_from and starts_at < p_to),
    'processed_minor', (select coalesce(sum(amount_minor), 0) from public.mova_payments
      where collector = 'mova_processed' and status in ('succeeded', 'partially_refunded') and created_at >= p_from and created_at < p_to),
    'fees_minor', (select coalesce(sum(platform_fee_minor), 0) from public.mova_payments
      where collector = 'mova_processed' and status in ('succeeded', 'partially_refunded') and created_at >= p_from and created_at < p_to),
    'recorded_minor', (select coalesce(sum(amount_minor), 0) from public.mova_payments
      where collector = 'artist' and status = 'succeeded' and created_at >= p_from and created_at < p_to),
    'salon_minor', (select coalesce(sum(amount_minor), 0) from public.mova_payments
      where collector = 'salon' and status = 'succeeded' and created_at >= p_from and created_at < p_to),
    'seat_filler_filled', (select count(*) from public.mova_slot_events where status = 'filled' and created_at >= p_from and created_at < p_to),
    'seat_filler_offered', (select count(*) from public.mova_slot_events where status in ('live', 'filled', 'expired') and created_at >= p_from and created_at < p_to),
    'seat_filler_total', (select count(*) from public.mova_slot_events where created_at >= p_from and created_at < p_to),
    'autopilot_sent', (select count(*) from public.mova_autopilot_decisions where action = 'sent' and created_at >= p_from and created_at < p_to),
    'autopilot_rebooked', (select count(*) from public.mova_autopilot_decisions where action = 'rebooked' and created_at >= p_from and created_at < p_to),
    'concierge_conversations', (select count(*) from public.mova_conversations where created_at >= p_from and created_at < p_to),
    'concierge_handed', (select count(distinct h.conversation_id) from public.mova_handoffs h where h.created_at >= p_from and h.created_at < p_to)
  );
$$;

