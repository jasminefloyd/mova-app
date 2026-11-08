-- 0040: revoke table write grants that have no matching RLS policy (rls_matrix, finding H-05).
-- RLS already denied these writes; revoking makes the denial explicit and keeps the grant/policy matrix consistent.
-- The app writes these tables only through SECURITY DEFINER functions, except the listed policies that stay:
-- mova_artist_profiles UPDATE, mova_onboarding_progress UPDATE, mova_portfolio_service_links INSERT/DELETE.
revoke insert, update, delete on table public.mova_artist_businesses from authenticated;
revoke insert, update, delete on table public.mova_artist_memberships from authenticated;
revoke insert, delete on table public.mova_artist_profiles from authenticated;
revoke insert, delete on table public.mova_onboarding_progress from authenticated;
revoke update on table public.mova_portfolio_service_links from authenticated;
