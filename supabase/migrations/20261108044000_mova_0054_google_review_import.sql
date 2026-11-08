-- Task 5.9: which Google Business Profile location to import reviews from. Set by the stylist when the
-- Google connection is live; the fake provider accepts ids starting with "fake-".
alter table public.mova_review_settings add column if not exists google_location_id text
  check (google_location_id is null or length(google_location_id) between 3 and 200);
alter table public.mova_review_settings add column if not exists google_synced_at timestamptz;
