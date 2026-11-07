-- P14 reports, privacy-safe profile traffic, and verified-visit reviews.
-- Version 0024 follows the already-applied 0018 forecast and 0023 display-ID migrations.

create table public.mova_profile_traffic_events (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  event_type text not null check (event_type in ('page_view','qr_scan','booking_started','booking_completed')),
  source text not null check (source in ('instagram','qr','google','direct','other')),
  event_key uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint mova_profile_traffic_events_key_uq unique (artist_business_id,event_key)
);
create index mova_profile_traffic_events_day_idx on public.mova_profile_traffic_events(artist_business_id,occurred_at);

create table public.mova_reports_daily_rollups (
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  local_date date not null,
  service_value_minor bigint not null default 0,
  completed_count integer not null default 0,
  no_show_count integer not null default 0,
  booked_seconds bigint not null default 0,
  offered_seconds bigint not null default 0,
  page_views integer not null default 0,
  qr_scans integer not null default 0,
  booking_starts integer not null default 0,
  booking_completions integer not null default 0,
  source_counts jsonb not null default '{}'::jsonb check(jsonb_typeof(source_counts)='object'),
  slot_fills integer not null default 0,
  slot_recovered_minor bigint not null default 0,
  rebooking_count integer not null default 0,
  rebooking_value_minor bigint not null default 0,
  rebooking_reminders_sent integer not null default 0,
  social_shares integer not null default 0,
  rating_sum integer not null default 0,
  rating_count integer not null default 0,
  awaiting_reply integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (artist_business_id,local_date)
);
create index mova_reports_daily_rollups_date_idx on public.mova_reports_daily_rollups(local_date,artist_business_id);
alter table public.mova_reports_daily_rollups add column google_rating_sum integer not null default 0;
alter table public.mova_reports_daily_rollups add column google_rating_count integer not null default 0;

-- Reporting days use the artist's earliest-created active location as the stable business timezone.
create or replace function public.mova_local_interval_start(p_day date,p_time_zone text,p_open time)
returns timestamptz language sql immutable strict set search_path=public,pg_temp as $$
  select make_timestamptz(extract(year from p_day)::int,extract(month from p_day)::int,extract(day from p_day)::int,
    extract(hour from p_open)::int,extract(minute from p_open)::int,extract(second from p_open),p_time_zone)
$$;
create or replace function public.mova_local_interval_end(p_day date,p_time_zone text,p_open time,p_close time)
returns timestamptz language sql immutable strict set search_path=public,pg_temp as $$
  select make_timestamptz(extract(year from (p_day+case when p_close<=p_open then 1 else 0 end))::int,
    extract(month from (p_day+case when p_close<=p_open then 1 else 0 end))::int,
    extract(day from (p_day+case when p_close<=p_open then 1 else 0 end))::int,
    extract(hour from p_close)::int,extract(minute from p_close)::int,extract(second from p_close),p_time_zone)
$$;

create table public.mova_review_settings (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  ask_after_visit boolean not null default false,
  google_review_url text,
  updated_at timestamptz not null default now(),
  constraint mova_review_settings_google_url_check check(google_review_url is null or (google_review_url like 'https://%' and length(google_review_url)<=2048))
);

create table public.mova_review_requests (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  appointment_id uuid not null references public.mova_appointments(id) on delete cascade,
  token_hash bytea not null unique,
  status text not null default 'queued' check(status in ('queued','sent','used','expired','suppressed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  used_at timestamptz,
  constraint mova_review_requests_appointment_uq unique(appointment_id)
);
create index mova_review_requests_due_idx on public.mova_review_requests(artist_business_id,created_at) where status='queued';

create table public.mova_reviews (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  appointment_id uuid not null references public.mova_appointments(id) on delete cascade,
  request_id uuid not null references public.mova_review_requests(id) on delete restrict,
  rating smallint not null check(rating between 1 and 5),
  tags text[] not null default '{}'::text[] check(tags <@ array['great_results','listened_to_me','on_time','clean_space','healthy_hair']::text[]),
  body text not null default '' check(length(body)<=1000),
  display_name text not null check(length(display_name) between 1 and 80),
  locale text not null check(locale in ('en-US','es-US')),
  moderation_status text not null default 'pending' check(moderation_status in ('pending','flagged','approved','rejected')),
  public_display_enabled boolean not null default false,
  artist_reply text check(artist_reply is null or length(artist_reply)<=2000),
  artist_replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_reviews_appointment_uq unique(appointment_id),
  constraint mova_reviews_request_uq unique(request_id),
  constraint mova_reviews_public_gate check(not public_display_enabled or moderation_status='approved')
);
create index mova_reviews_artist_created_idx on public.mova_reviews(artist_business_id,created_at desc);
create index mova_reviews_artist_reply_idx on public.mova_reviews(artist_business_id,artist_replied_at) where artist_reply is null;

create table public.mova_review_reports (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  review_id uuid not null references public.mova_reviews(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check(reason in ('spam','abuse','privacy','not_a_client','other')),
  details text not null default '' check(length(details)<=1000),
  status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  constraint mova_review_reports_one_open_uq unique(review_id,submitted_by,status)
);

create table public.mova_google_reviews (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  provider_review_id text not null,
  rating smallint not null check(rating between 1 and 5),
  body text not null default '' check(length(body)<=5000),
  display_name text not null default '' check(length(display_name)<=120),
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  constraint mova_google_reviews_external_uq unique(artist_business_id,provider_review_id)
);

alter table public.mova_profile_traffic_events enable row level security;
alter table public.mova_reports_daily_rollups enable row level security;
alter table public.mova_review_settings enable row level security;
alter table public.mova_review_requests enable row level security;
alter table public.mova_reviews enable row level security;
alter table public.mova_review_reports enable row level security;
alter table public.mova_google_reviews enable row level security;

revoke all on public.mova_profile_traffic_events,public.mova_reports_daily_rollups,public.mova_review_settings,
  public.mova_review_requests,public.mova_reviews,public.mova_review_reports,public.mova_google_reviews from public,anon,authenticated;

create policy mova_reports_rollups_member_select on public.mova_reports_daily_rollups for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_review_settings_member_select on public.mova_review_settings for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_reviews_member_select on public.mova_reviews for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_review_reports_member_select on public.mova_review_reports for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_google_reviews_member_select on public.mova_google_reviews for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
grant select on public.mova_reports_daily_rollups,public.mova_review_settings,public.mova_reviews,public.mova_review_reports,public.mova_google_reviews to authenticated;

create or replace function public.mova_reports_refresh_daily(p_artist_business_id uuid,p_local_date date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v record; v_time_zone text;
begin
  if p_local_date < current_date-interval '400 days' or p_local_date > current_date+interval '2 days' then
    raise exception using errcode='22023',message='REPORT_DATE_OUT_OF_RANGE';
  end if;
  select time_zone into v_time_zone from public.mova_locations where artist_business_id=p_artist_business_id and is_active order by created_at,id limit 1;
  v_time_zone:=coalesce(v_time_zone,'UTC');
  with appts as (
    select a.* from public.mova_appointments a
    join public.mova_locations l on l.id=a.location_id and l.artist_business_id=a.artist_business_id
    where a.artist_business_id=p_artist_business_id and (a.starts_at at time zone l.time_zone)::date=p_local_date
  ), traffic_counts as (
    select count(*) filter(where event_type='page_view')::int page_views,
      count(*) filter(where event_type='qr_scan')::int qr_scans,
      count(*) filter(where event_type='booking_started')::int booking_starts,
      count(*) filter(where event_type='booking_completed')::int booking_completions
    from public.mova_profile_traffic_events where artist_business_id=p_artist_business_id
      and occurred_at>=public.mova_local_interval_start(p_local_date,v_time_zone,'00:00'::time)
      and occurred_at<public.mova_local_interval_start(p_local_date+1,v_time_zone,'00:00'::time)
  ), sources as (
    select coalesce(jsonb_object_agg(source,source_count),'{}'::jsonb) source_counts
    from (select source,count(*)::int source_count from public.mova_profile_traffic_events
      where artist_business_id=p_artist_business_id and occurred_at>=public.mova_local_interval_start(p_local_date,v_time_zone,'00:00'::time)
        and occurred_at<public.mova_local_interval_start(p_local_date+1,v_time_zone,'00:00'::time) and event_type='page_view' group by source) q
  ), reviews as (
    select count(*)::int rating_count,coalesce(sum(rating),0)::int rating_sum,
      count(*) filter(where artist_reply is null)::int awaiting_reply
    from public.mova_reviews where artist_business_id=p_artist_business_id
      and (created_at at time zone v_time_zone)::date=p_local_date
  ), google_reviews as (
    select count(*)::int rating_count,coalesce(sum(rating),0)::int rating_sum
    from public.mova_google_reviews where artist_business_id=p_artist_business_id
      and (coalesce(provider_created_at,synced_at) at time zone v_time_zone)::date=p_local_date
  ), slot as (
    select count(*) filter(where status='filled')::int slot_fills,
      coalesce(sum(case when status='filled' then coalesce(se.value_minor,a.service_price_minor,0) else 0 end),0)::bigint slot_recovered_minor
    from public.mova_slot_events se left join public.mova_appointments a on a.id=se.filled_appointment_id and a.artist_business_id=se.artist_business_id
    where se.artist_business_id=p_artist_business_id and (se.created_at at time zone v_time_zone)::date=p_local_date
  ), rebooking as (
    select count(*)::int rebooking_count,coalesce(sum(value_minor),0)::bigint rebooking_value_minor
    from public.mova_autopilot_decisions where artist_business_id=p_artist_business_id and action='rebooked'
      and (created_at at time zone v_time_zone)::date=p_local_date
  ), reminders as (
    select count(*)::int sent_count from public.mova_messages where artist_business_id=p_artist_business_id
      and direction='outbound' and purpose='rebooking_reminders' and status in ('sent','delivered')
      and sent_at is not null and (sent_at at time zone v_time_zone)::date=p_local_date
  ), shares as (
    select count(*)::int share_count from public.mova_social_share_events where artist_business_id=p_artist_business_id
      and (initiated_at at time zone v_time_zone)::date=p_local_date
  ), offered as (
    select coalesce(sum(extract(epoch from (public.mova_local_interval_end(p_local_date,l.time_zone,h.opens_at,h.closes_at)-public.mova_local_interval_start(p_local_date,l.time_zone,h.opens_at,h.closes_at))))::bigint,0) seconds
    from public.mova_locations l join public.mova_location_hours h on h.artist_business_id=l.artist_business_id and h.location_id=l.id
    where l.artist_business_id=p_artist_business_id and l.is_active and l.booking_mode='instant' and h.weekday=extract(dow from p_local_date)::int
      and not exists(select 1 from public.mova_location_exceptions e where e.location_id=l.id and e.exception_date=p_local_date)
  ), exceptions as (
    select coalesce(sum(extract(epoch from (public.mova_local_interval_end(p_local_date,l.time_zone,(x->>'opens_at')::time,(x->>'closes_at')::time)-public.mova_local_interval_start(p_local_date,l.time_zone,(x->>'opens_at')::time,(x->>'closes_at')::time))))::bigint,0) seconds
    from public.mova_location_exceptions e join public.mova_locations l on l.id=e.location_id and l.artist_business_id=e.artist_business_id
    cross join lateral jsonb_array_elements(case when e.is_closed then '[]'::jsonb else e.hours end) x
    where e.artist_business_id=p_artist_business_id and e.exception_date=p_local_date and l.is_active and l.booking_mode='instant'
  ), appointment_totals as (
    select coalesce(sum(a.service_price_minor) filter(where a.status='completed'),0)::bigint service_value_minor,
      count(*) filter(where a.status='completed')::int completed_count,count(*) filter(where a.status='no_show')::int no_show_count,
      coalesce(sum(extract(epoch from (a.ends_at-a.starts_at))::bigint) filter(where a.status in ('confirmed','completed') and l.booking_mode='instant'),0)::bigint booked_seconds
    from appts a join public.mova_locations l on l.id=a.location_id and l.artist_business_id=a.artist_business_id
  )
  insert into public.mova_reports_daily_rollups as r(artist_business_id,local_date,service_value_minor,completed_count,no_show_count,booked_seconds,offered_seconds,
    page_views,qr_scans,booking_starts,booking_completions,source_counts,slot_fills,slot_recovered_minor,rebooking_count,rebooking_value_minor,
    rebooking_reminders_sent,social_shares,rating_sum,rating_count,awaiting_reply,google_rating_sum,google_rating_count,refreshed_at)
  select p_artist_business_id,p_local_date,at.service_value_minor,at.completed_count,at.no_show_count,at.booked_seconds,
    coalesce(o.seconds,0)+coalesce(x.seconds,0),tc.page_views,tc.qr_scans,tc.booking_starts,tc.booking_completions,s.source_counts,
    sl.slot_fills,sl.slot_recovered_minor,rb.rebooking_count,rb.rebooking_value_minor,rm.sent_count,sh.share_count,rv.rating_sum,rv.rating_count,rv.awaiting_reply,gr.rating_sum,gr.rating_count,now()
  from appointment_totals at cross join traffic_counts tc cross join sources s cross join slot sl cross join rebooking rb cross join reminders rm cross join shares sh cross join reviews rv cross join google_reviews gr cross join offered o cross join exceptions x
  on conflict(artist_business_id,local_date) do update set service_value_minor=excluded.service_value_minor,completed_count=excluded.completed_count,
    no_show_count=excluded.no_show_count,booked_seconds=excluded.booked_seconds,offered_seconds=excluded.offered_seconds,page_views=excluded.page_views,
    qr_scans=excluded.qr_scans,booking_starts=excluded.booking_starts,booking_completions=excluded.booking_completions,source_counts=excluded.source_counts,
    slot_fills=excluded.slot_fills,slot_recovered_minor=excluded.slot_recovered_minor,rebooking_count=excluded.rebooking_count,
    rebooking_value_minor=excluded.rebooking_value_minor,rebooking_reminders_sent=excluded.rebooking_reminders_sent,social_shares=excluded.social_shares,
    rating_sum=excluded.rating_sum,rating_count=excluded.rating_count,awaiting_reply=excluded.awaiting_reply,google_rating_sum=excluded.google_rating_sum,google_rating_count=excluded.google_rating_count,refreshed_at=now();
end $$;

-- Converts wall-clock opening times using the location time zone, including overnight hours.
create or replace function public.mova_reports_summary(p_artist_business_id uuid,p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_days int; v_prev_start date; v_prev_end date; v_current jsonb; v_previous jsonb; v_series jsonb; v_sources jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>89 then raise exception using errcode='22023',message='REPORT_RANGE_INVALID'; end if;
  v_days:=p_end-p_start+1; v_prev_start:=p_start-v_days; v_prev_end:=p_start-1;
  perform public.mova_reports_refresh_daily(p_artist_business_id,d::date) from generate_series(v_prev_start,p_end,interval '1 day') d;
  select jsonb_build_object('service_value_minor',coalesce(sum(service_value_minor),0),'completed_count',coalesce(sum(completed_count),0),
    'no_show_count',coalesce(sum(no_show_count),0),'booked_seconds',coalesce(sum(booked_seconds),0),'offered_seconds',coalesce(sum(offered_seconds),0),
    'page_views',coalesce(sum(page_views),0),'qr_scans',coalesce(sum(qr_scans),0),'booking_starts',coalesce(sum(booking_starts),0),
    'booking_completions',coalesce(sum(booking_completions),0),
    'slot_fills',coalesce(sum(slot_fills),0),'slot_recovered_minor',coalesce(sum(slot_recovered_minor),0),'rebooking_count',coalesce(sum(rebooking_count),0),
    'rebooking_value_minor',coalesce(sum(rebooking_value_minor),0),'rebooking_reminders_sent',coalesce(sum(rebooking_reminders_sent),0),
    'social_shares',coalesce(sum(social_shares),0),'rating_sum',coalesce(sum(rating_sum),0),'rating_count',coalesce(sum(rating_count),0),
    'google_rating_sum',coalesce(sum(google_rating_sum),0),'google_rating_count',coalesce(sum(google_rating_count),0),
    'awaiting_reply',coalesce(sum(awaiting_reply),0)) into v_current
  from public.mova_reports_daily_rollups r
  where r.artist_business_id=p_artist_business_id and r.local_date between p_start and p_end;
  select coalesce(jsonb_object_agg(key,total),'{}'::jsonb) into v_sources from (
    select source.key,sum(source.value::int)::int total from public.mova_reports_daily_rollups r
      cross join lateral jsonb_each_text(r.source_counts) source
    where r.artist_business_id=p_artist_business_id and r.local_date between p_start and p_end group by source.key
  ) counted_sources;
  v_current:=v_current||jsonb_build_object('source_counts',v_sources);
  select jsonb_build_object('service_value_minor',coalesce(sum(service_value_minor),0),'completed_count',coalesce(sum(completed_count),0),
    'no_show_count',coalesce(sum(no_show_count),0),'booked_seconds',coalesce(sum(booked_seconds),0),'offered_seconds',coalesce(sum(offered_seconds),0),
    'page_views',coalesce(sum(page_views),0),'qr_scans',coalesce(sum(qr_scans),0),'booking_starts',coalesce(sum(booking_starts),0),
    'booking_completions',coalesce(sum(booking_completions),0),'slot_fills',coalesce(sum(slot_fills),0),'slot_recovered_minor',coalesce(sum(slot_recovered_minor),0),
    'rebooking_count',coalesce(sum(rebooking_count),0),'rebooking_value_minor',coalesce(sum(rebooking_value_minor),0),
    'rebooking_reminders_sent',coalesce(sum(rebooking_reminders_sent),0),'social_shares',coalesce(sum(social_shares),0),
    'rating_sum',coalesce(sum(rating_sum),0),'rating_count',coalesce(sum(rating_count),0),'google_rating_sum',coalesce(sum(google_rating_sum),0),
    'google_rating_count',coalesce(sum(google_rating_count),0),'awaiting_reply',coalesce(sum(awaiting_reply),0)) into v_previous
  from public.mova_reports_daily_rollups where artist_business_id=p_artist_business_id and local_date between v_prev_start and v_prev_end;
  select coalesce(jsonb_agg(jsonb_build_object('date',local_date,'service_value_minor',service_value_minor,'completed_count',completed_count,
    'page_views',page_views,'qr_scans',qr_scans) order by local_date),'[]'::jsonb) into v_series
  from public.mova_reports_daily_rollups where artist_business_id=p_artist_business_id and local_date between p_start and p_end;
  return jsonb_build_object('start',p_start,'end',p_end,'previous_start',v_prev_start,'previous_end',v_prev_end,'current',v_current,'previous',v_previous,'series',v_series);
end $$;

create or replace function public.mova_reputation_summary(p_artist_business_id uuid,p_include_google boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with ratings as (
    select all_ratings.rating,count(*)::int as count from (
      select rating from public.mova_reviews where artist_business_id=p_artist_business_id
      union all select rating from public.mova_google_reviews where artist_business_id=p_artist_business_id and p_include_google
    ) all_ratings group by all_ratings.rating
  ), summary as (
    select count(*)::int as total,coalesce(sum(rating),0)::int as rating_sum,
      count(*) filter(where artist_reply is null)::int as awaiting_reply
    from public.mova_reviews where artist_business_id=p_artist_business_id
  ), source_summary as (
    select (select count(*)::int from public.mova_reviews where artist_business_id=p_artist_business_id) as mova_count,
      coalesce((select sum(rating)::int from public.mova_reviews where artist_business_id=p_artist_business_id),0) as mova_rating_sum,
      case when p_include_google then (select count(*)::int from public.mova_google_reviews where artist_business_id=p_artist_business_id) else 0 end as google_count,
      case when p_include_google then coalesce((select sum(rating)::int from public.mova_google_reviews where artist_business_id=p_artist_business_id),0) else 0 end as google_rating_sum
  )
  select jsonb_build_object('count',summary.total+source_summary.google_count,
    'average',case when summary.total+source_summary.google_count=0 then null else round((summary.rating_sum+source_summary.google_rating_sum)::numeric/(summary.total+source_summary.google_count),1) end,
    'awaiting_reply',summary.awaiting_reply,'stars',jsonb_build_object('1',coalesce((select count from ratings where rating=1),0),
      '2',coalesce((select count from ratings where rating=2),0),'3',coalesce((select count from ratings where rating=3),0),
      '4',coalesce((select count from ratings where rating=4),0),'5',coalesce((select count from ratings where rating=5),0)),
    'mova_count',source_summary.mova_count,'mova_average',case when source_summary.mova_count=0 then null else round(source_summary.mova_rating_sum::numeric/source_summary.mova_count,1) end,
    'google_count',source_summary.google_count,'google_average',case when source_summary.google_count=0 then null else round(source_summary.google_rating_sum::numeric/source_summary.google_count,1) end
  ) from summary cross join source_summary
$$;

create or replace function public.mova_track_profile_event(p_handle text,p_event_type text,p_source text,p_event_key uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare business_id uuid;
begin
  if p_event_type not in ('page_view','qr_scan','booking_started','booking_completed') or p_source not in ('instagram','qr','google','direct','other') then
    raise exception using errcode='22023',message='TRACK_EVENT_INVALID';
  end if;
  select p.artist_business_id into business_id from public.mova_artist_profiles p join public.mova_artist_businesses b on b.id=p.artist_business_id
    where p.handle=p_handle and p.is_published and b.status='active';
  if business_id is null then return false; end if;
  insert into public.mova_profile_traffic_events(artist_business_id,event_type,source,event_key)
  values(business_id,p_event_type,p_source,p_event_key) on conflict(artist_business_id,event_key) do nothing;
  return true;
end $$;

create or replace function public.mova_review_submit(p_token_hash bytea,p_rating smallint,p_tags text[],p_body text,p_locale text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare request public.mova_review_requests%rowtype; appointment public.mova_appointments%rowtype; safe_name text;
begin
  if p_rating not between 1 and 5 or coalesce(array_length(p_tags,1),0)>5 or coalesce(p_body,'')<>trim(coalesce(p_body,''))
    or length(coalesce(p_body,''))>1000 or p_locale not in ('en-US','es-US')
    or not coalesce(p_tags,'{}') <@ array['great_results','listened_to_me','on_time','clean_space','healthy_hair']::text[] then
    raise exception using errcode='22023',message='REVIEW_INPUT_INVALID';
  end if;
  select * into request from public.mova_review_requests where token_hash=p_token_hash for update;
  if not found or request.status<>'sent' or request.expires_at<=now() then raise exception using errcode='P0002',message='REVIEW_LINK_INVALID'; end if;
  select * into appointment from public.mova_appointments where id=request.appointment_id and artist_business_id=request.artist_business_id and status='completed';
  if not found then raise exception using errcode='42501',message='COMPLETED_VISIT_REQUIRED'; end if;
  safe_name:=split_part(trim(appointment.client_name),' ',1)||case when position(' ' in trim(appointment.client_name))>0 then ' '||upper(left(split_part(trim(appointment.client_name),' ',2),1))||'.' else '' end;
  insert into public.mova_reviews(artist_business_id,appointment_id,request_id,rating,tags,body,display_name,locale,moderation_status,public_display_enabled)
  values(request.artist_business_id,appointment.id,request.id,p_rating,coalesce(p_tags,'{}'),trim(coalesce(p_body,'')),safe_name,p_locale,'pending',false);
  update public.mova_review_requests set status='used',used_at=now() where id=request.id;
  return jsonb_build_object('saved',true,'moderation_status','pending');
exception when unique_violation then raise exception using errcode='23505',message='REVIEW_ALREADY_SUBMITTED';
end $$;

create or replace function public.mova_review_public_context(p_token_hash bytea)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare request public.mova_review_requests%rowtype;
begin
  select * into request from public.mova_review_requests where token_hash=p_token_hash;
  if not found or request.status<>'sent' or request.expires_at<=now() then return null; end if;
  return (select jsonb_build_object('artist_name',p.display_name,'artist_handle',p.handle,'profile_photo_path',p.profile_photo_path,
    'service_name',a.service_name_snapshot,'visit_date',a.starts_at,'location_name',l.name,'google_review_url',s.google_review_url,
    'reviewer_display_name',split_part(trim(a.client_name),' ',1)||case when position(' ' in trim(a.client_name))>0 then ' '||upper(left(split_part(trim(a.client_name),' ',2),1))||'.' else '' end)
    from public.mova_appointments a join public.mova_artist_profiles p on p.artist_business_id=a.artist_business_id
    join public.mova_locations l on l.id=a.location_id and l.artist_business_id=a.artist_business_id
    left join public.mova_review_settings s on s.artist_business_id=a.artist_business_id
    where a.id=request.appointment_id and a.artist_business_id=request.artist_business_id and a.status='completed');
end $$;

create or replace function public.mova_review_reply_save(p_review_id uuid,p_artist_business_id uuid,p_reply text,p_actor_id uuid)
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
begin
  if not exists(select 1 from public.mova_artist_memberships where user_id=p_actor_id and artist_business_id=p_artist_business_id and status='active')
    or length(trim(coalesce(p_reply,'')))>2000 then raise exception using errcode='42501',message='REVIEW_REPLY_FORBIDDEN'; end if;
  update public.mova_reviews set artist_reply=nullif(trim(p_reply),''),artist_replied_at=case when trim(p_reply)='' then null else now() end,updated_at=now()
    where id=p_review_id and artist_business_id=p_artist_business_id;
  if not found then raise exception using errcode='P0002',message='REVIEW_NOT_FOUND'; end if;
end $$;

create or replace function public.mova_review_report_create(p_review_id uuid,p_artist_business_id uuid,p_reason text,p_details text,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare report_id uuid;
begin
  if not exists(select 1 from public.mova_artist_memberships where user_id=p_actor_id and artist_business_id=p_artist_business_id and status='active')
    or p_reason not in ('spam','abuse','privacy','not_a_client','other') or length(coalesce(p_details,''))>1000 then raise exception using errcode='42501',message='REVIEW_REPORT_INVALID'; end if;
  insert into public.mova_review_reports(artist_business_id,review_id,submitted_by,reason,details)
  select p_artist_business_id,p_review_id,p_actor_id,p_reason,coalesce(p_details,'') where exists(select 1 from public.mova_reviews where id=p_review_id and artist_business_id=p_artist_business_id)
  returning id into report_id;
  if report_id is null then raise exception using errcode='P0002',message='REVIEW_NOT_FOUND'; end if;
  return report_id;
end $$;

create or replace function public.mova_review_request_create(p_appointment_id uuid,p_artist_business_id uuid,p_token_hash bytea,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.mova_appointments%rowtype; request public.mova_review_requests%rowtype;
begin
  if not exists(select 1 from public.mova_artist_memberships where user_id=p_actor_id and artist_business_id=p_artist_business_id and status='active') then raise exception using errcode='42501',message='ARTIST_MEMBERSHIP_REQUIRED'; end if;
  select * into a from public.mova_appointments where id=p_appointment_id and artist_business_id=p_artist_business_id and status='completed' for update;
  if not found then raise exception using errcode='P0002',message='COMPLETED_VISIT_REQUIRED'; end if;
  if not coalesce((select ask_after_visit from public.mova_review_settings where artist_business_id=p_artist_business_id),false) then raise exception using errcode='42501',message='REVIEW_REQUESTS_DISABLED'; end if;
  insert into public.mova_review_requests(artist_business_id,appointment_id,token_hash,expires_at)
  values(p_artist_business_id,a.id,p_token_hash,now()+interval '14 days') on conflict(appointment_id) do nothing;
  select * into request from public.mova_review_requests where appointment_id=a.id;
  return jsonb_build_object('request_id',request.id,'status',request.status,'expires_at',request.expires_at,'replayed',request.token_hash<>p_token_hash);
end $$;

create or replace function public.mova_review_settings_save(p_artist_business_id uuid,p_ask_after_visit boolean,p_google_review_url text,p_actor_id uuid)
returns public.mova_review_settings language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.mova_review_settings%rowtype;
begin
  if not exists(select 1 from public.mova_artist_memberships where user_id=p_actor_id and artist_business_id=p_artist_business_id and status='active') then
    raise exception using errcode='42501',message='ARTIST_MEMBERSHIP_REQUIRED';
  end if;
  if p_ask_after_visit then
    raise exception using errcode='55000',message='REVIEW_EMAIL_PROVIDER_UNAVAILABLE';
  end if;
  if p_google_review_url is not null and (p_google_review_url !~ '^https://' or length(p_google_review_url)>2048) then
    raise exception using errcode='22023',message='GOOGLE_REVIEW_URL_INVALID';
  end if;
  insert into public.mova_review_settings(artist_business_id,ask_after_visit,google_review_url)
  values(p_artist_business_id,p_ask_after_visit,nullif(trim(p_google_review_url),''))
  on conflict(artist_business_id) do update set ask_after_visit=excluded.ask_after_visit,google_review_url=excluded.google_review_url,updated_at=now()
  returning * into saved;
  return saved;
end $$;

create or replace function public.mova_review_completion_outbox_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Review request delivery remains off until an email sender is configured.
  return new;
end $$;
create trigger mova_review_completed_outbox after update of status on public.mova_appointments
for each row execute function public.mova_review_completion_outbox_trigger();

-- Service-only access for Edge handlers and scheduled refreshes.
revoke all on function public.mova_reports_refresh_daily(uuid,date) from public,anon,authenticated;
revoke all on function public.mova_reports_summary(uuid,date,date) from public,anon,authenticated;
revoke all on function public.mova_reputation_summary(uuid,boolean) from public,anon,authenticated;
revoke all on function public.mova_track_profile_event(text,text,text,uuid) from public,authenticated;
revoke all on function public.mova_review_submit(bytea,smallint,text[],text,text) from public,anon,authenticated;
revoke all on function public.mova_review_public_context(bytea) from public,anon,authenticated;
revoke all on function public.mova_review_reply_save(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.mova_review_report_create(uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.mova_review_request_create(uuid,uuid,bytea,uuid) from public,anon,authenticated;
revoke all on function public.mova_review_settings_save(uuid,boolean,text,uuid) from public,anon,authenticated;
revoke all on function public.mova_review_completion_outbox_trigger() from public,anon,authenticated;
revoke all on function public.mova_local_interval_start(date,text,time) from public,anon,authenticated;
revoke all on function public.mova_local_interval_end(date,text,time,time) from public,anon,authenticated;
grant execute on function public.mova_reports_refresh_daily(uuid,date),public.mova_reports_summary(uuid,date,date),public.mova_reputation_summary(uuid,boolean),
  public.mova_track_profile_event(text,text,text,uuid),public.mova_review_submit(bytea,smallint,text[],text,text),
  public.mova_review_public_context(bytea),
  public.mova_review_reply_save(uuid,uuid,text,uuid),public.mova_review_report_create(uuid,uuid,text,text,uuid),
  public.mova_review_request_create(uuid,uuid,bytea,uuid),public.mova_review_settings_save(uuid,boolean,text,uuid),public.mova_local_interval_start(date,text,time),
  public.mova_local_interval_end(date,text,time,time) to service_role;
grant all on public.mova_profile_traffic_events,public.mova_reports_daily_rollups,public.mova_review_settings,
  public.mova_review_requests,public.mova_reviews,public.mova_review_reports,public.mova_google_reviews to service_role;
