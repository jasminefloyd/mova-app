-- EM11 Welcome to Mova is now sent when onboarding finishes (the page is published), not when the
-- profile is first claimed. The email shows the live page link, so it needs the handle, and it links
-- the three steps to Settings, so it needs the business number. The greeting uses the private first
-- name from mova_account_names (0098), falling back to the sign-up metadata, then the display name.
-- Requires 0098.

create or replace function public.mova_stylist_welcome_email_context(p_artist_business_id uuid)
returns jsonb language sql stable security definer set search_path = public, auth, pg_temp as $$
  select jsonb_build_object(
    'artist_business_id', b.id,
    'business_number', b.business_number,
    'handle', p.handle,
    'locale', coalesce(p.preferred_locale, 'en-US'),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', u.email,
        'first_name', coalesce(nullif(trim(n.first_name), ''), nullif(trim(u.raw_user_meta_data->>'first_name'), '')),
        'name', coalesce(nullif(trim(n.first_name), ''), nullif(trim(u.raw_user_meta_data->>'first_name'), ''), u.raw_user_meta_data->>'full_name', p.display_name, b.name)))
      from public.mova_artist_memberships m
      join auth.users u on u.id = m.user_id
      left join public.mova_account_names n on n.user_id = u.id
      where m.artist_business_id = b.id and m.status = 'active' and m.role in ('owner', 'admin') and u.email is not null
    ), '[]'::jsonb),
    'vars', jsonb_build_object('clientName', coalesce(p.display_name, b.name), 'businessName', coalesce(p.display_name, b.name, 'Mova'),
      'serviceName', 'Mova', 'startsAt', now(), 'timeZone', 'UTC', 'locationName', 'Mova',
      'bookingUrl', 'https://mova-beauty.co/login')
  )
  from public.mova_artist_businesses b join public.mova_artist_profiles p on p.artist_business_id = b.id
  where b.id = p_artist_business_id;
$$;

revoke all on function public.mova_stylist_welcome_email_context(uuid) from public, anon, authenticated;
grant execute on function public.mova_stylist_welcome_email_context(uuid) to service_role;

-- Queue the welcome email when onboarding reaches 'complete'. The idempotency key is unchanged
-- ('artist-welcome:<business id>'), so anyone already welcomed under the old trigger is not emailed twice.
drop trigger if exists mova_artist_welcome_outbox on public.mova_artist_profiles;

drop trigger if exists mova_artist_welcome_outbox_on_complete on public.mova_onboarding_progress;
create trigger mova_artist_welcome_outbox_on_complete
  after update of current_step on public.mova_onboarding_progress
  for each row
  when (new.current_step = 'complete' and old.current_step is distinct from 'complete')
  execute function public.mova_artist_welcome_outbox_trigger();
