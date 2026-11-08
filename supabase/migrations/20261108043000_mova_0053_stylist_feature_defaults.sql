-- Owner decision O11 (Nov 8): stylist-level switches default ON for rebooking autopilot, seat-filler
-- autopilot, review requests, Google review import, the wallet client card and social share. Platform
-- flags (Edge Function env such as MOVA_SMS_PROVIDER, MOVA_WALLET_CLIENT_CARD_ENABLED,
-- MOVA_GOOGLE_REVIEWS_ENABLED) stay OFF until each provider is live, so nothing reaches a client yet.
-- Only defaults change: rows a stylist already saved keep their values. A missing row means the default.
alter table public.mova_autopilot_settings alter column enabled set default true;
alter table public.mova_autopilot_settings alter column slot_texts_autopilot set default true;
alter table public.mova_review_settings alter column ask_after_visit set default true;
alter table public.mova_review_settings add column if not exists google_import_enabled boolean not null default true;

create table public.mova_feature_settings (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  wallet_card boolean not null default true,
  social_share boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.mova_feature_settings enable row level security;
revoke all on public.mova_feature_settings from public, anon, authenticated;
grant select on public.mova_feature_settings to authenticated;
grant all on public.mova_feature_settings to service_role;
create policy mova_feature_settings_member_select on public.mova_feature_settings for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));

-- Effective stylist-level switches, defaults included, for Edge Functions (service role only).
create or replace function public.mova_stylist_features(p_artist_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'rebooking_autopilot', coalesce((select enabled from public.mova_autopilot_settings where artist_business_id = p_artist_business_id), true),
    'seat_filler_autopilot', coalesce((select slot_texts_autopilot from public.mova_autopilot_settings where artist_business_id = p_artist_business_id), true),
    'review_requests', coalesce((select ask_after_visit from public.mova_review_settings where artist_business_id = p_artist_business_id), true),
    'google_review_import', coalesce((select google_import_enabled from public.mova_review_settings where artist_business_id = p_artist_business_id), true),
    'wallet_card', coalesce((select wallet_card from public.mova_feature_settings where artist_business_id = p_artist_business_id), true),
    'social_share', coalesce((select social_share from public.mova_feature_settings where artist_business_id = p_artist_business_id), true)
  );
$$;
revoke all on function public.mova_stylist_features(uuid) from public, anon, authenticated;
grant execute on function public.mova_stylist_features(uuid) to service_role;
