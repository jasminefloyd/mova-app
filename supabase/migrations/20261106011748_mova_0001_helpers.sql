-- Mova-owned database helpers. This migration installs no PostgreSQL extensions.
create or replace function public.mova_has_artist_membership(p_artist_business_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or p_artist_business_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.mova_artist_memberships as membership
    where membership.artist_business_id = p_artist_business_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
end;
$$;

create or replace function public.mova_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.mova_has_artist_membership(uuid) from public;
grant execute on function public.mova_has_artist_membership(uuid) to authenticated;
revoke all on function public.mova_touch_updated_at() from public, anon, authenticated;
