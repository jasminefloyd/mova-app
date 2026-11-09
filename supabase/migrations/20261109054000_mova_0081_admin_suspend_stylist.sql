-- Admin follow-up: suspending a stylist locks their tenant out through the shared membership helper.
-- Existing data remains intact; restoring a suspended account returns it to active.
create or replace function public.mova_has_artist_membership(p_artist_business_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
begin
  if auth.uid() is null or p_artist_business_id is null then return false; end if;
  return exists (
    select 1 from public.mova_artist_memberships membership
    join public.mova_artist_businesses business on business.id = membership.artist_business_id
    where membership.artist_business_id = p_artist_business_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and business.status = 'active'
  );
end;
$$;

create function public.mova_admin_set_stylist_suspension(
  p_artist_business_id uuid, p_suspended boolean, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin uuid := public.mova_require_platform_admin();
  v_status text;
  v_next text;
begin
  if p_suspended is null or length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;
  select status into v_status from public.mova_artist_businesses
    where id = p_artist_business_id and status <> 'deleted' for update;
  if not found then raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND'; end if;
  v_next := case when p_suspended then 'suspended' else 'active' end;
  if v_status <> v_next then
    update public.mova_artist_businesses set status = v_next, updated_at = now() where id = p_artist_business_id;
    perform public.mova_admin_log(
      case when p_suspended then 'stylist.suspended' else 'stylist.restored' end,
      'artist_business', p_artist_business_id::text, p_artist_business_id, p_reason,
      jsonb_build_object('from', v_status, 'to', v_next, 'actor', v_admin)
    );
  end if;
  return jsonb_build_object('status', v_next);
end;
$$;

revoke all on function public.mova_admin_set_stylist_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.mova_admin_set_stylist_suspension(uuid, boolean, text) to authenticated, service_role;
