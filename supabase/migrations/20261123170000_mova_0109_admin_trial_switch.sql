-- Let platform admins launch or pause trials through the audited switches RPC.
create or replace function public.mova_admin_set_platform_switch(p_key text, p_enabled boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before boolean; v_admin uuid := public.mova_require_platform_admin();
begin
  if p_key not in ('autopilot','concierge','seat_filler','zelle','reviews','spanish','tap_to_pay','marketing_email','marketing_social','marketing_push','marketing_wallet','trial_enabled') then
    raise exception using errcode = '22023', message = 'SWITCH_INVALID';
  end if;
  if p_key = 'tap_to_pay' and p_enabled then raise exception using errcode = '55000', message = 'SWITCH_NOT_BUILT'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  select enabled into v_before from public.mova_platform_switches where key=p_key for update;
  update public.mova_platform_switches set enabled=p_enabled,reason=btrim(p_reason),updated_by=v_admin,updated_at=now() where key=p_key;
  perform public.mova_admin_log('switch.updated','platform_switch',p_key,null,p_reason,jsonb_build_object('from',v_before,'to',p_enabled));
  return public.mova_admin_switches();
end $$;
