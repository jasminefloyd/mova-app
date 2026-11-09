-- P6 Google: listing and services sync to Google Business Profile. Mova is the source. Each item Mova
-- has last sent is kept as a snapshot; an item is "waiting" when its current content differs from its
-- snapshot. Only the service role writes these tables (Edge Functions).
--
-- Rollback note: drop nothing in production without owner approval. Reverting the code leaves these
-- tables unused; they can stay.

create table if not exists public.mova_google_listing_settings (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  auto_send boolean not null default true,
  last_synced_at timestamptz,
  last_sync_status text not null default 'never' check (last_sync_status in ('never','synced','failed')),
  updated_at timestamptz not null default now()
);

create table if not exists public.mova_google_listing_snapshots (
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  item_key text not null check (length(item_key) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  synced_at timestamptz not null default now(),
  primary key (artist_business_id, item_key)
);

create trigger mova_google_listing_settings_touch before update on public.mova_google_listing_settings
  for each row execute function public.mova_touch_updated_at();

alter table public.mova_google_listing_settings enable row level security;
alter table public.mova_google_listing_snapshots enable row level security;
create policy mova_google_listing_settings_member_select on public.mova_google_listing_settings for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));
create policy mova_google_listing_snapshots_member_select on public.mova_google_listing_snapshots for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));

revoke all on public.mova_google_listing_settings, public.mova_google_listing_snapshots from public, anon, authenticated;
grant select on public.mova_google_listing_settings, public.mova_google_listing_snapshots to authenticated;
