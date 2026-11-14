-- 0089: public contact and link fields on the stylist profile.
-- Phone and email are required for a published profile; website and social links are optional.
-- The public profile and its structured data read these columns, so the stylist edits them in one place.

alter table public.mova_artist_profiles
  add column contact_phone text,
  add column contact_email text,
  add column website_url text,
  add column social_links jsonb not null default '{}'::jsonb,
  add constraint mova_artist_profiles_contact_phone_format
    check (contact_phone is null or contact_phone ~ '^\+?[0-9 ()\-.]{7,20}$'),
  add constraint mova_artist_profiles_contact_email_format
    check (contact_email is null or (length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add constraint mova_artist_profiles_website_https
    check (website_url is null or website_url ~ '^https://[^\s]+$' and length(website_url) <= 2000),
  add constraint mova_artist_profiles_social_links_shape
    check (
      jsonb_typeof(social_links) = 'object'
      and (social_links - array['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube']) = '{}'::jsonb
    );

create or replace function public.mova_update_artist_contact(
  p_artist_business_id uuid,
  p_contact_phone text,
  p_contact_email text,
  p_website_url text,
  p_social_links jsonb
)
returns table(handle text)
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  current_user_id uuid := auth.uid();
  phone_value text := nullif(trim(coalesce(p_contact_phone, '')), '');
  email_value text := lower(nullif(trim(coalesce(p_contact_email, '')), ''));
  website_value text := nullif(trim(coalesce(p_website_url, '')), '');
  links jsonb := coalesce(p_social_links, '{}'::jsonb);
  link_key text;
  link_value text;
  cleaned_links jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.mova_artist_memberships as membership
    where membership.artist_business_id = p_artist_business_id
      and membership.user_id = current_user_id
      and membership.status = 'active'
      and membership.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'OWNER_PROFILE_REQUIRED';
  end if;
  if phone_value is null or phone_value !~ '^\+?[0-9 ()\-.]{7,20}$' then
    raise exception using errcode = '22023', message = 'CONTACT_PHONE_INVALID';
  end if;
  if email_value is null or length(email_value) > 254 or email_value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = '22023', message = 'CONTACT_EMAIL_INVALID';
  end if;
  if website_value is not null and (website_value !~ '^https://[^\s]+$' or length(website_value) > 2000) then
    raise exception using errcode = '22023', message = 'WEBSITE_INVALID';
  end if;
  if jsonb_typeof(links) <> 'object' then
    raise exception using errcode = '22023', message = 'SOCIAL_LINKS_INVALID';
  end if;
  for link_key in select jsonb_object_keys(links) loop
    if link_key not in ('instagram', 'facebook', 'linkedin', 'tiktok', 'youtube') then
      raise exception using errcode = '22023', message = 'SOCIAL_LINKS_INVALID';
    end if;
  end loop;
  for link_key, link_value in select key, value from jsonb_each_text(links) loop
    if link_value is not null and link_value <> '' and (link_value !~ '^https://[^\s]+$' or length(link_value) > 2000) then
      raise exception using errcode = '22023', message = 'SOCIAL_LINK_INVALID';
    end if;
  end loop;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into cleaned_links
  from jsonb_each_text(links) as entry(key, value)
  where value is not null and value <> '';

  update public.mova_artist_profiles as profile
  set contact_phone = phone_value,
      contact_email = email_value,
      website_url = website_value,
      social_links = cleaned_links,
      updated_at = now()
  where profile.artist_business_id = p_artist_business_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
  end if;

  return query select profile.handle from public.mova_artist_profiles as profile
    where profile.artist_business_id = p_artist_business_id;
end;
$function$;

revoke all on function public.mova_update_artist_contact(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.mova_update_artist_contact(uuid, text, text, text, jsonb) to authenticated;
