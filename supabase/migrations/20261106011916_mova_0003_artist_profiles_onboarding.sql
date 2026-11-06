create table public.mova_artist_profiles (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null unique references public.mova_artist_businesses(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  handle text not null,
  specialties text[] not null default '{}',
  bio text not null default '',
  preferred_locale text not null default 'en-US' check (preferred_locale in ('en-US', 'es-US')),
  profile_photo_path text,
  cover_photo_path text,
  photo_variants jsonb not null default '{}'::jsonb check (jsonb_typeof(photo_variants) = 'object'),
  photo_updated_at timestamptz,
  is_published boolean not null default false,
  search_index_enabled boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_artist_profiles_handle_format check (handle ~ '^[a-z0-9-]{3,30}$'),
  constraint mova_artist_profiles_specialties_count check (cardinality(specialties) between 1 and 5)
);

create unique index mova_artist_profiles_handle_lower_uq
  on public.mova_artist_profiles (lower(handle));

create table public.mova_reserved_handles (
  handle text primary key,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint mova_reserved_handles_format check (handle ~ '^[a-z0-9-]{3,30}$')
);

-- The product's current QA contract explicitly names `admin` as reserved.
insert into public.mova_reserved_handles (handle, reason)
values ('admin', 'Reserved platform route')
on conflict (handle) do nothing;

create table public.mova_onboarding_progress (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  current_step text not null default 'profile'
    check (current_step in ('profile', 'photo', 'services', 'location', 'payments', 'publish', 'complete')),
  completed_steps text[] not null default '{}',
  form_data jsonb not null default '{}'::jsonb check (jsonb_typeof(form_data) = 'object'),
  updated_at timestamptz not null default now()
);

create trigger mova_artist_profiles_touch_updated_at
  before update on public.mova_artist_profiles
  for each row execute function public.mova_touch_updated_at();

create trigger mova_onboarding_progress_touch_updated_at
  before update on public.mova_onboarding_progress
  for each row execute function public.mova_touch_updated_at();

create or replace function public.mova_check_artist_handle(p_handle text)
returns table (available boolean, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_handle text := lower(trim(coalesce(p_handle, '')));
begin
  if normalized_handle !~ '^[a-z0-9-]{3,30}$' then
    return query select false, 'invalid'::text;
    return;
  end if;
  if exists (select 1 from public.mova_reserved_handles as reserved where reserved.handle = normalized_handle) then
    return query select false, 'reserved'::text;
    return;
  end if;
  if exists (select 1 from public.mova_artist_profiles as profile where lower(profile.handle) = normalized_handle) then
    return query select false, 'taken'::text;
    return;
  end if;
  return query select true, null::text;
end;
$$;

create or replace function public.mova_claim_artist_profile(
  p_display_name text,
  p_handle text,
  p_specialties text[],
  p_bio text default '',
  p_preferred_locale text default 'en-US'
)
returns table (artist_business_id uuid, profile_id uuid, handle text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
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
  if exists (select 1 from public.mova_reserved_handles where handle = normalized_handle) then
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
$$;

create or replace function public.mova_publish_artist_profile(
  p_artist_business_id uuid,
  p_search_index_enabled boolean default true
)
returns table (handle text, published_at timestamptz)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  published_time timestamptz := now();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.mova_artist_memberships as membership
    where membership.artist_business_id = p_artist_business_id
      and membership.user_id = current_user_id
    and membership.status = 'active'
    and membership.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'OWNER_PROFILE_REQUIRED';
  end if;

  if not exists (
    select 1 from public.mova_artist_profiles as profile
    where profile.artist_business_id = p_artist_business_id
  ) then
    raise exception using errcode = '42501', message = 'OWNER_PROFILE_REQUIRED';
  end if;

  update public.mova_artist_profiles as profile
  set is_published = true,
      published_at = coalesce(profile.published_at, published_time),
      search_index_enabled = coalesce(p_search_index_enabled, true)
  where profile.artist_business_id = p_artist_business_id;

  update public.mova_onboarding_progress
  set current_step = 'complete',
      completed_steps = array(select distinct steps.step from unnest(public.mova_onboarding_progress.completed_steps || array['publish', 'complete']) as steps(step))
  where public.mova_onboarding_progress.artist_business_id = p_artist_business_id;

  return query
    select profile.handle, profile.published_at
    from public.mova_artist_profiles as profile
    where profile.artist_business_id = p_artist_business_id;
end;
$$;

create or replace function public.mova_public_sitemap()
returns table (handle text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profile.handle, profile.updated_at
  from public.mova_artist_profiles as profile
  where profile.is_published = true
    and profile.search_index_enabled = true
  order by profile.handle;
$$;

revoke all on function public.mova_public_sitemap() from public, anon, authenticated;
grant execute on function public.mova_public_sitemap() to service_role;

create or replace function public.mova_update_artist_profile(
  p_artist_business_id uuid,
  p_display_name text,
  p_handle text,
  p_specialties text[],
  p_bio text,
  p_preferred_locale text
)
returns table (handle text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
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
  if exists (select 1 from public.mova_reserved_handles where handle = normalized_handle) then
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
$$;

alter table public.mova_artist_profiles enable row level security;
alter table public.mova_reserved_handles enable row level security;
alter table public.mova_onboarding_progress enable row level security;

create policy mova_artist_profiles_member_select
  on public.mova_artist_profiles for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));
create policy mova_artist_profiles_member_update
  on public.mova_artist_profiles for update to authenticated
  using (public.mova_has_artist_membership(artist_business_id))
  with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_onboarding_progress_member_select
  on public.mova_onboarding_progress for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));
create policy mova_onboarding_progress_member_update
  on public.mova_onboarding_progress for update to authenticated
  using (public.mova_has_artist_membership(artist_business_id))
  with check (public.mova_has_artist_membership(artist_business_id));

grant select on public.mova_artist_profiles to authenticated;
grant update (display_name, specialties, bio, preferred_locale) on public.mova_artist_profiles to authenticated;
grant select, update (current_step, completed_steps, form_data) on public.mova_onboarding_progress to authenticated;
revoke all on public.mova_reserved_handles from public, anon, authenticated;
revoke all on function public.mova_check_artist_handle(text) from public;
grant execute on function public.mova_check_artist_handle(text) to anon, authenticated;
revoke all on function public.mova_claim_artist_profile(text, text, text[], text, text) from public, anon;
grant execute on function public.mova_claim_artist_profile(text, text, text[], text, text) to authenticated;
revoke all on function public.mova_publish_artist_profile(uuid, boolean) from public, anon;
grant execute on function public.mova_publish_artist_profile(uuid, boolean) to authenticated;
revoke all on function public.mova_update_artist_profile(uuid, text, text, text[], text, text) from public, anon;
grant execute on function public.mova_update_artist_profile(uuid, text, text, text[], text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mova_profile_photos', 'mova_profile_photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy mova_profile_storage_member_select on storage.objects
  for select to authenticated using (
    bucket_id = 'mova_profile_photos'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  );
create policy mova_profile_storage_member_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'mova_profile_photos'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  );
create policy mova_profile_storage_member_update on storage.objects
  for update to authenticated using (
    bucket_id = 'mova_profile_photos'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  ) with check (
    bucket_id = 'mova_profile_photos'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  );
create policy mova_profile_storage_member_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'mova_profile_photos'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  );
