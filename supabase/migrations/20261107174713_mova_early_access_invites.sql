begin;

create table public.mova_early_access_invites (
  email_normalized text primary key,
  created_at timestamptz not null default now(),
  constraint mova_early_access_invites_email_normalized_check
    check (email_normalized = lower(btrim(email_normalized)) and position('@' in email_normalized) > 1)
);

alter table public.mova_early_access_invites enable row level security;
revoke all on table public.mova_early_access_invites from public, anon, authenticated, service_role;

create or replace function public.mova_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_email text;
begin
  invite_email := lower(btrim(event #>> '{user,email}'));

  if invite_email is not null and invite_email <> '' and exists (
    select 1
    from public.mova_early_access_invites as invite
    where invite.email_normalized = invite_email
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Mova is invite-only for now; join the waitlist.'
    )
  );
end;
$$;

revoke all on function public.mova_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.mova_before_user_created(jsonb) to supabase_auth_admin;

commit;
