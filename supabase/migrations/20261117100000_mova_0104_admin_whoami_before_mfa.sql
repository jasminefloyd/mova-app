-- The admin sign-in flow must check roster membership after the email OTP, before it can
-- require/enroll the authenticator factor. Keep privileged admin operations gated at AAL2
-- through mova_require_platform_admin(); this RPC only confirms roster membership.
create or replace function public.mova_admin_whoami()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object('is_admin', true, 'display_name', a.display_name)
       from public.mova_platform_admins a
      where a.user_id = auth.uid()),
    jsonb_build_object('is_admin', false)
  );
$$;

revoke all on function public.mova_admin_whoami() from public, anon;
grant execute on function public.mova_admin_whoami() to authenticated, service_role;
