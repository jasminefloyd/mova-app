-- P6 auth (2026-11-09): open sign-up. Anyone can create a stylist account, so the invite-only
-- Before User Created gate from 20261107174713 now allows every address. The early-access allowlist
-- table and its rows are kept; nothing is deleted. The hook is also switched off in supabase/config.toml.
create or replace function public.mova_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Open sign-up: no invite check. The payload is ignored on purpose.
  return '{}'::jsonb;
end;
$$;

revoke all on function public.mova_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mova_before_user_created(jsonb) to supabase_auth_admin;
