-- A signed-in account on the System Admin roster can use the portal after email OTP.
create or replace function public.mova_is_platform_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.mova_platform_admins a where a.user_id = auth.uid());
$$;
