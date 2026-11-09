-- P6 Unsplash: the profile cover can be a free Unsplash photo instead of an upload. The app hotlinks the
-- image URL Unsplash returns (as their API guidelines require) and shows the photographer credit with
-- links to their Unsplash profile and to Unsplash. Only the service role writes these columns.
-- Uploaded covers (cover_photo_path) are untouched; cover_source says which one the page shows.
--
-- Rollback note: revert the code. The new columns can stay (they are unused when cover_source = 'upload').

alter table public.mova_artist_profiles
  add column if not exists cover_source text not null default 'upload' check (cover_source in ('upload','unsplash')),
  add column if not exists cover_unsplash_photo_id text check (cover_unsplash_photo_id is null or length(cover_unsplash_photo_id) between 1 and 100),
  add column if not exists cover_image_url text check (cover_image_url is null or (length(cover_image_url) <= 2048 and cover_image_url like 'https://images.unsplash.com/%')),
  add column if not exists cover_credit_name text check (cover_credit_name is null or length(cover_credit_name) between 1 and 120),
  add column if not exists cover_credit_url text check (cover_credit_url is null or (length(cover_credit_url) <= 2048 and cover_credit_url like 'https://unsplash.com/@%')),
  add column if not exists cover_unsplash_url text check (cover_unsplash_url is null or (length(cover_unsplash_url) <= 2048 and cover_unsplash_url like 'https://unsplash.com/%')),
  add column if not exists cover_chosen_at timestamptz;

alter table public.mova_artist_profiles drop constraint if exists mova_artist_profiles_unsplash_cover_complete;
alter table public.mova_artist_profiles add constraint mova_artist_profiles_unsplash_cover_complete check (
  cover_source = 'upload' or (cover_image_url is not null and cover_unsplash_photo_id is not null
    and cover_credit_name is not null and cover_credit_url is not null and cover_unsplash_url is not null)
);

-- Stylists keep updating their name, specialties, bio and locale through the profile RPC. The cover
-- columns above are written only by the service role, so a direct PostgREST update cannot set them.
-- Column-level grants do not narrow a table-level grant, so the table grant is removed first.
revoke update on table public.mova_artist_profiles from authenticated;
grant update (display_name, specialties, bio, preferred_locale) on public.mova_artist_profiles to authenticated;
