-- P6 Google: replies written in Mova post to the Google review. A reply is "none" until the stylist
-- writes one, "queued" while it is sent, "posted" once Google accepts it, or "failed". Deleting a reply
-- on Google clears the body and returns the status to "none". Existing rows are unchanged (status none).
--
-- The awaiting-reply count now includes Google reviews without a reply when Google is connected.
--
-- Rollback note: revert the Edge Functions and summary function body (0024 version). The new columns
-- hold only reply text the stylist wrote; keep them unless owner approves removing them.

alter table public.mova_google_reviews
  add column if not exists reply_body text check (reply_body is null or length(reply_body) <= 2000),
  add column if not exists reply_status text not null default 'none' check (reply_status in ('none','queued','posted','failed')),
  add column if not exists reply_posted_at timestamptz,
  add column if not exists reply_updated_at timestamptz;

alter table public.mova_google_reviews drop constraint if exists mova_google_reviews_reply_consistent;
alter table public.mova_google_reviews add constraint mova_google_reviews_reply_consistent
  check ((reply_status = 'none') = (reply_body is null));

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
      case when p_include_google then coalesce((select sum(rating)::int from public.mova_google_reviews where artist_business_id=p_artist_business_id),0) else 0 end as google_rating_sum,
      case when p_include_google then (select count(*)::int from public.mova_google_reviews where artist_business_id=p_artist_business_id and reply_status='none') else 0 end as google_awaiting_reply
  )
  select jsonb_build_object('count',summary.total+source_summary.google_count,
    'average',case when summary.total+source_summary.google_count=0 then null else round((summary.rating_sum+source_summary.google_rating_sum)::numeric/(summary.total+source_summary.google_count),1) end,
    'awaiting_reply',summary.awaiting_reply+source_summary.google_awaiting_reply,'stars',jsonb_build_object('1',coalesce((select count from ratings where rating=1),0),
      '2',coalesce((select count from ratings where rating=2),0),'3',coalesce((select count from ratings where rating=3),0),
      '4',coalesce((select count from ratings where rating=4),0),'5',coalesce((select count from ratings where rating=5),0)),
    'mova_count',source_summary.mova_count,'mova_average',case when source_summary.mova_count=0 then null else round(source_summary.mova_rating_sum::numeric/source_summary.mova_count,1) end,
    'google_count',source_summary.google_count,'google_average',case when source_summary.google_count=0 then null else round(source_summary.google_rating_sum::numeric/source_summary.google_count,1) end
  ) from summary cross join source_summary
$$;
