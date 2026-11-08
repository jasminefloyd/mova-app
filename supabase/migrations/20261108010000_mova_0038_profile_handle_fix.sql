-- 0038: fix "column reference handle is ambiguous" in the profile claim and update functions.
-- Both functions return a column named handle and also queried mova_reserved_handles.handle unqualified,
-- so PostgreSQL rejected every call. Only the reserved-handle check changes; signatures and grants are kept.

CREATE OR REPLACE FUNCTION public.mova_claim_artist_profile(p_display_name text, p_handle text, p_specialties text[], p_bio text DEFAULT ''::text, p_preferred_locale text DEFAULT 'en-US'::text)
 RETURNS TABLE(artist_business_id uuid, profile_id uuid, handle text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_handle text := lower(trim(coalesce(p_handle, '')));
  business_id uuid;
  profile_id_value uuid;
  violated_constraint text;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from auth.users as auth_user
    where auth_user.id = current_user_id and auth_user.email_confirmed_at is not null
  ) then
    raise exception using errcode = '28000', message = 'EMAIL_NOT_VERIFIED';
  end if;
  if length(trim(coalesce(p_display_name, ''))) = 0 then
    raise exception using errcode = '22023', message = 'DISPLAY_NAME_INVALID';
  end if;
  if normalized_handle !~ '^[a-z0-9-]{3,30}$' then
    raise exception using errcode = '22023', message = 'HANDLE_INVALID';
  end if;
  if coalesce(array_length(p_specialties, 1), 0) not between 1 and 5 then
    raise exception using errcode = '22023', message = 'SPECIALTIES_INVALID';
  end if;
  if coalesce(p_preferred_locale, 'en-US') not in ('en-US', 'es-US') then
    raise exception using errcode = '22023', message = 'LOCALE_INVALID';
  end if;
  if exists (select 1 from public.mova_reserved_handles as reserved where reserved.handle = normalized_handle) then
    raise exception using errcode = '23505', message = 'HANDLE_RESERVED';
  end if;
  if exists (select 1 from public.mova_artist_profiles where lower(mova_artist_profiles.handle) = normalized_handle) then
    raise exception using errcode = '23505', message = 'HANDLE_TAKEN';
  end if;

  insert into public.mova_artist_businesses (name)
  values (trim(p_display_name))
  returning id into business_id;

  insert into public.mova_artist_memberships (artist_business_id, user_id, role, status)
  values (business_id, current_user_id, 'owner', 'active');

  insert into public.mova_artist_profiles (
    artist_business_id, display_name, handle, specialties, bio, preferred_locale
  ) values (
    business_id,
    trim(p_display_name),
    normalized_handle,
    p_specialties,
    coalesce(p_bio, ''),
    coalesce(p_preferred_locale, 'en-US')
  ) returning id into profile_id_value;

  insert into public.mova_onboarding_progress (artist_business_id, current_step, form_data)
  values (business_id, 'photo', jsonb_build_object(
    'display_name', trim(p_display_name), 'handle', normalized_handle,
    'specialties', to_jsonb(p_specialties), 'bio', coalesce(p_bio, ''),
    'preferred_locale', coalesce(p_preferred_locale, 'en-US')
  ));

  return query select business_id, profile_id_value, normalized_handle;
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'mova_artist_profiles_handle_lower_uq' then
      raise exception using errcode = '23505', message = 'HANDLE_TAKEN';
    end if;
    raise;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.mova_update_artist_profile(p_artist_business_id uuid, p_display_name text, p_handle text, p_specialties text[], p_bio text, p_preferred_locale text)
 RETURNS TABLE(handle text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_handle text := lower(trim(coalesce(p_handle, '')));
  violated_constraint text;
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
  if length(trim(coalesce(p_display_name, ''))) = 0 then
    raise exception using errcode = '22023', message = 'DISPLAY_NAME_INVALID';
  end if;
  if normalized_handle !~ '^[a-z0-9-]{3,30}$' then
    raise exception using errcode = '22023', message = 'HANDLE_INVALID';
  end if;
  if coalesce(array_length(p_specialties, 1), 0) not between 1 and 5 then
    raise exception using errcode = '22023', message = 'SPECIALTIES_INVALID';
  end if;
  if coalesce(p_preferred_locale, 'en-US') not in ('en-US', 'es-US') then
    raise exception using errcode = '22023', message = 'LOCALE_INVALID';
  end if;
  if exists (select 1 from public.mova_reserved_handles as reserved where reserved.handle = normalized_handle) then
    raise exception using errcode = '23505', message = 'HANDLE_RESERVED';
  end if;

  update public.mova_artist_profiles as profile
  set display_name = trim(p_display_name), handle = normalized_handle,
      specialties = p_specialties, bio = coalesce(p_bio, ''),
      preferred_locale = coalesce(p_preferred_locale, 'en-US')
  where profile.artist_business_id = p_artist_business_id;
  if not found then raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND'; end if;
  return query select profile.handle from public.mova_artist_profiles as profile
    where profile.artist_business_id = p_artist_business_id;
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'mova_artist_profiles_handle_lower_uq' then
      raise exception using errcode = '23505', message = 'HANDLE_TAKEN';
    end if;
    raise;
end;
$function$

;

