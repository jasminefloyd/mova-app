-- Qualify slot status in the reports rollup join to avoid ambiguity with appointment status.
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
    select count(*) filter(where se.status='filled')::int slot_fills,
      coalesce(sum(case when se.status='filled' then coalesce(se.value_minor,a.service_price_minor,0) else 0 end),0)::bigint slot_recovered_minor
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
    select coalesce(sum(extract(epoch from (public.mova_local_interval_end(p_local_date,l.time_zone,h.opens_at,h.closes_at)-public.mova_local_interval_start(p_local_date,l.time_zone,h.opens_at))))::bigint,0) seconds
    from public.mova_locations l join public.mova_location_hours h on h.artist_business_id=l.artist_business_id and h.location_id=l.id
    where l.artist_business_id=p_artist_business_id and l.is_active and l.booking_mode='instant' and h.weekday=extract(dow from p_local_date)::int
      and not exists(select 1 from public.mova_location_exceptions e where e.location_id=l.id and e.exception_date=p_local_date)
  ), exceptions as (
    select coalesce(sum(extract(epoch from (public.mova_local_interval_end(p_local_date,l.time_zone,(x->>'opens_at')::time,(x->>'closes_at')::time)-public.mova_local_interval_start(p_local_date,l.time_zone,(x->>'opens_at')::time))))::bigint,0) seconds
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
