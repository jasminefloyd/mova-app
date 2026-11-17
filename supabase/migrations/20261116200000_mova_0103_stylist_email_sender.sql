-- 0103: client emails come from the stylist's own Mova address ({handle}@mova-beauty.co) until custom
-- domains exist. Replies go to the stylist: their sign-up email by default, or one they choose in Settings.
-- Emails to the stylist themselves (sign-in, welcome, alerts) keep coming from hello@.

alter table public.mova_artist_profiles
  add column if not exists reply_to_email text;

alter table public.mova_artist_profiles
  drop constraint if exists mova_artist_profiles_reply_to_email_format;
alter table public.mova_artist_profiles
  add constraint mova_artist_profiles_reply_to_email_format
  check (reply_to_email is null or (length(reply_to_email) <= 320 and reply_to_email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'));

-- The owner's sign-up email, used when no reply-to address is set.
create or replace function public.mova_artist_owner_email(p_artist_business_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select auth_user.email::text
  from public.mova_artist_memberships as membership
  join auth.users as auth_user on auth_user.id = membership.user_id
  where membership.artist_business_id = p_artist_business_id
    and membership.role = 'owner'
    and membership.status = 'active'
  order by membership.created_at
  limit 1;
$$;

revoke all on function public.mova_artist_owner_email(uuid) from public, anon, authenticated;
grant execute on function public.mova_artist_owner_email(uuid) to service_role;

-- What the email sender needs for a client email: the handle (sending address) and where replies go.
create or replace function public.mova_artist_email_sender(p_artist_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'handle', lower(profile.handle),
    'reply_to', coalesce(profile.reply_to_email, public.mova_artist_owner_email(p_artist_business_id))
  )
  from public.mova_artist_profiles as profile
  where profile.artist_business_id = p_artist_business_id;
$$;

revoke all on function public.mova_artist_email_sender(uuid) from public, anon, authenticated;
grant execute on function public.mova_artist_email_sender(uuid) to service_role;

-- Settings: the stylist sees their sending address and reply-to, and can change the reply-to.
create or replace function public.mova_client_email_settings(p_artist_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.mova_artist_memberships as membership
    where membership.artist_business_id = p_artist_business_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  ) then
    raise exception 'ARTIST_ACCESS_DENIED' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'sender', lower(profile.handle) || '@mova-beauty.co',
    'reply_to', coalesce(profile.reply_to_email, public.mova_artist_owner_email(p_artist_business_id)),
    'reply_to_is_default', profile.reply_to_email is null
  ) into result
  from public.mova_artist_profiles as profile
  where profile.artist_business_id = p_artist_business_id;
  return result;
end;
$$;

create or replace function public.mova_set_client_reply_to(p_artist_business_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if not exists (
    select 1 from public.mova_artist_memberships as membership
    where membership.artist_business_id = p_artist_business_id
      and membership.user_id = auth.uid()
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'ARTIST_ACCESS_DENIED' using errcode = '42501';
  end if;
  if normalized is not null and (length(normalized) > 320 or normalized !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$') then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;
  -- Clearing it, or choosing the sign-up email again, goes back to the default.
  if normalized = lower(public.mova_artist_owner_email(p_artist_business_id)) then
    normalized := null;
  end if;
  update public.mova_artist_profiles
    set reply_to_email = normalized
    where artist_business_id = p_artist_business_id;
  return public.mova_client_email_settings(p_artist_business_id);
end;
$$;

revoke all on function public.mova_client_email_settings(uuid) from public, anon;
revoke all on function public.mova_set_client_reply_to(uuid, text) from public, anon;
grant execute on function public.mova_client_email_settings(uuid) to authenticated, service_role;
grant execute on function public.mova_set_client_reply_to(uuid, text) to authenticated, service_role;
