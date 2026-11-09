-- A0-A11 admin portal foundation (P6 admin stream, 2026-11-09). Platform staff only.
-- Every admin function (0067-0071) calls mova_require_platform_admin(), which needs BOTH a row in
-- mova_platform_admins AND a two-step session (JWT aal2). The tables below have no client policies, so
-- browsers reach them only through security-definer functions. The activity log is append-only.
-- Default privileges in this project grant EXECUTE on new public functions to anon and authenticated,
-- so every function below is revoked explicitly.

create table public.mova_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.mova_platform_admins enable row level security;
revoke all on public.mova_platform_admins from public, anon, authenticated;
grant select, insert, update, delete on public.mova_platform_admins to service_role;

create table public.mova_admin_activity (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (length(action) between 1 and 80),
  object_type text not null check (length(object_type) between 1 and 60),
  object_id text check (object_id is null or length(object_id) <= 120),
  artist_business_id uuid references public.mova_artist_businesses(id) on delete restrict,
  reason text check (reason is null or length(reason) <= 500),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index mova_admin_activity_created_idx on public.mova_admin_activity (created_at desc);
create index mova_admin_activity_business_idx on public.mova_admin_activity (artist_business_id, created_at desc);
alter table public.mova_admin_activity enable row level security;
revoke all on public.mova_admin_activity from public, anon, authenticated;
grant select, insert on public.mova_admin_activity to service_role;

create function public.mova_admin_activity_append_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode = '42501', message = 'ADMIN_ACTIVITY_IS_APPEND_ONLY';
end $$;
revoke all on function public.mova_admin_activity_append_only() from public, anon, authenticated;
create trigger mova_admin_activity_append_only before update or delete on public.mova_admin_activity
  for each row execute function public.mova_admin_activity_append_only();

create function public.mova_is_platform_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from public.mova_platform_admins a where a.user_id = auth.uid());
$$;
revoke all on function public.mova_is_platform_admin() from public, anon;
grant execute on function public.mova_is_platform_admin() to authenticated, service_role;

create function public.mova_require_platform_admin() returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.mova_is_platform_admin() then
    raise exception using errcode = '42501', message = 'PLATFORM_ADMIN_REQUIRED';
  end if;
  return auth.uid();
end $$;
revoke all on function public.mova_require_platform_admin() from public, anon, authenticated;

-- Internal writer used by the admin functions. Runs as the function owner; never granted to clients.
create function public.mova_admin_log(
  p_action text, p_object_type text, p_object_id text, p_business_id uuid, p_reason text, p_details jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.mova_admin_activity (admin_user_id, action, object_type, object_id, artist_business_id, reason, details)
  values (auth.uid(), p_action, p_object_type, nullif(left(btrim(coalesce(p_object_id, '')), 120), ''), p_business_id,
    nullif(left(btrim(coalesce(p_reason, '')), 500), ''), coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function public.mova_admin_log(text, text, text, uuid, text, jsonb) from public, anon, authenticated;

-- Bootstrap: the first admin is granted from the SQL editor (postgres role) or with the service role.
-- Create the staff user in Supabase Auth first (no public sign-up), then run:
--   select public.mova_grant_platform_admin('<auth user uuid>', 'Jasmine F.');
-- The user then enrolls an authenticator app on first sign-in at /admin/signin (two-step is required).
create function public.mova_grant_platform_admin(p_user_id uuid, p_display_name text) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.mova_platform_admins (user_id, display_name)
  values (p_user_id, p_display_name)
  on conflict (user_id) do update set display_name = excluded.display_name;
$$;
revoke all on function public.mova_grant_platform_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.mova_grant_platform_admin(uuid, text) to service_role;

create function public.mova_admin_whoami() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.mova_is_platform_admin() then
    return jsonb_build_object('is_admin', false);
  end if;
  return (select jsonb_build_object('is_admin', true, 'display_name', a.display_name)
    from public.mova_platform_admins a where a.user_id = auth.uid());
end $$;
revoke all on function public.mova_admin_whoami() from public, anon;
grant execute on function public.mova_admin_whoami() to authenticated, service_role;

create function public.mova_admin_record_sign_in(p_device text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.mova_require_platform_admin();
  perform public.mova_admin_log('admin.signed_in', 'session', null, null, null,
    jsonb_build_object('method', '2-step', 'device', left(coalesce(p_device, ''), 120)));
end $$;
revoke all on function public.mova_admin_record_sign_in(text) from public, anon;
grant execute on function public.mova_admin_record_sign_in(text) to authenticated, service_role;
