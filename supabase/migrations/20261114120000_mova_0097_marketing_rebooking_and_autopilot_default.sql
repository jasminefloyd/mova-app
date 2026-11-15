-- Distinguish personal rebooking reminders from lapsed-client win-back campaigns.
alter table public.mova_marketing_campaigns drop constraint if exists mova_marketing_campaigns_goal_check;
alter table public.mova_marketing_campaigns add constraint mova_marketing_campaigns_goal_check
  check (goal in ('fill_opening','rebook','rebooking_reminder','offer','showcase'));

-- Rebooking autopilot is opt-in per stylist. The separate `autopilot` platform switch
-- remains the system-wide emergency stop used by job-dispatch.
alter table public.mova_autopilot_settings alter column enabled set default false;
update public.mova_autopilot_settings set enabled = false, updated_at = now() where enabled = true;

create or replace function public.mova_stylist_features(p_artist_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'rebooking_autopilot', coalesce((select enabled from public.mova_autopilot_settings where artist_business_id = p_artist_business_id), false),
    'seat_filler_autopilot', coalesce((select slot_texts_autopilot from public.mova_autopilot_settings where artist_business_id = p_artist_business_id), true),
    'review_requests', coalesce((select ask_after_visit from public.mova_review_settings where artist_business_id = p_artist_business_id), true),
    'google_review_import', coalesce((select google_import_enabled from public.mova_review_settings where artist_business_id = p_artist_business_id), true),
    'wallet_card', coalesce((select wallet_card from public.mova_feature_settings where artist_business_id = p_artist_business_id), true),
    'social_share', coalesce((select social_share from public.mova_feature_settings where artist_business_id = p_artist_business_id), true)
  );
$$;
revoke all on function public.mova_stylist_features(uuid) from public, anon, authenticated;
grant execute on function public.mova_stylist_features(uuid) to service_role;
