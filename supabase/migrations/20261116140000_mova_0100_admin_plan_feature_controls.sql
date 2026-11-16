-- Admin controls for plan assignment and individual plan entitlements.
-- Entitlements follow the current plan automatically. Overrides are reset whenever the plan changes.

create or replace function public.mova_plan_assignment_changed_clear_feature_overrides()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    delete from public.mova_business_feature_overrides where artist_business_id = new.artist_business_id;
  elsif old.plan_key is distinct from new.plan_key then
    delete from public.mova_business_feature_overrides where artist_business_id = new.artist_business_id;
  end if;
  return new;
end $$;
revoke all on function public.mova_plan_assignment_changed_clear_feature_overrides() from public, anon, authenticated;

drop trigger if exists mova_plan_assignment_clear_feature_overrides on public.mova_business_plan_assignments;
drop trigger if exists mova_plan_assignment_insert_clear_feature_overrides on public.mova_business_plan_assignments;
create trigger mova_plan_assignment_insert_clear_feature_overrides
  after insert on public.mova_business_plan_assignments
  for each row execute function public.mova_plan_assignment_changed_clear_feature_overrides();
create trigger mova_plan_assignment_clear_feature_overrides
  after update of plan_key on public.mova_business_plan_assignments
  for each row execute function public.mova_plan_assignment_changed_clear_feature_overrides();

create or replace function public.mova_admin_stylist_feature_controls(p_artist_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_plan_key text; v_plan_name text; v_result jsonb;
begin
  perform public.mova_require_platform_admin();
  if not exists(select 1 from public.mova_artist_businesses where id=p_artist_business_id and status <> 'deleted') then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;
  select c.plan_key, c.display_name into v_plan_key, v_plan_name
  from public.mova_business_plan_assignments a join public.mova_plan_catalog c on c.plan_key=a.plan_key and c.status='active'
  where a.artist_business_id=p_artist_business_id and a.assignment_status='current';
  v_plan_key := coalesce(v_plan_key, 'free');
  v_plan_name := coalesce(v_plan_name, 'Free');

  select jsonb_build_object(
    'current_plan', jsonb_build_object('plan_key',v_plan_key,'display_name',v_plan_name),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_key',c.plan_key,'display_name',c.display_name,
      'monthly_price_minor',c.monthly_price_minor,'entitlements',c.entitlements) order by c.monthly_price_minor)
      from public.mova_plan_catalog c where c.status='active'),'[]'::jsonb),
    'features', coalesce((select jsonb_agg(jsonb_build_object(
      'feature_key',k.feature_key,
      'plan_enabled',coalesce((c.entitlements->'features'->>k.feature_key)::boolean,false),
      'override_enabled',o.enabled,
      'enabled',coalesce(o.enabled,(c.entitlements->'features'->>k.feature_key)::boolean,false),
      'reason',o.reason,'updated_at',o.updated_at,'updated_by',pa.display_name
    ) order by k.feature_key)
      from unnest(public.mova_plan_feature_keys()) as k(feature_key)
      cross join public.mova_plan_catalog c
      left join public.mova_business_feature_overrides o on o.artist_business_id=p_artist_business_id and o.feature_key=k.feature_key
      left join public.mova_platform_admins pa on pa.user_id=o.updated_by
      where c.plan_key=v_plan_key),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.mova_admin_set_stylist_feature(
  p_artist_business_id uuid, p_feature_key text, p_enabled boolean, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := public.mova_require_platform_admin(); v_plan_enabled boolean; v_before boolean;
begin
  if not exists(select 1 from public.mova_artist_businesses where id=p_artist_business_id and status <> 'deleted') then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;
  if not (p_feature_key = any(public.mova_plan_feature_keys())) then
    raise exception using errcode = '22023', message = 'FEATURE_OVERRIDE_INVALID';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;
  select coalesce((c.entitlements->'features'->>p_feature_key)::boolean,false) into v_plan_enabled
    from public.mova_business_plan_assignments a join public.mova_plan_catalog c on c.plan_key=a.plan_key and c.status='active'
    where a.artist_business_id=p_artist_business_id and a.assignment_status='current';
  v_plan_enabled := coalesce(v_plan_enabled,false);
  select coalesce(o.enabled,v_plan_enabled) into v_before from (select 1) seed
    left join public.mova_business_feature_overrides o on o.artist_business_id=p_artist_business_id and o.feature_key=p_feature_key;
  if p_enabled = v_plan_enabled then
    delete from public.mova_business_feature_overrides where artist_business_id=p_artist_business_id and feature_key=p_feature_key;
  else
    insert into public.mova_business_feature_overrides(artist_business_id,feature_key,enabled,reason,updated_by)
      values(p_artist_business_id,p_feature_key,p_enabled,btrim(p_reason),v_admin)
      on conflict(artist_business_id,feature_key) do update set enabled=excluded.enabled,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
  end if;
  perform public.mova_admin_log('stylist.feature_override.updated','feature_override',p_feature_key,p_artist_business_id,btrim(p_reason),
    jsonb_build_object('from',v_before,'to',p_enabled,'plan_enabled',v_plan_enabled,'follows_plan',p_enabled=v_plan_enabled));
  return public.mova_admin_stylist_feature_controls(p_artist_business_id);
end $$;

create or replace function public.mova_admin_set_stylist_plan(
  p_artist_business_id uuid, p_plan_key text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := public.mova_require_platform_admin(); v_before text;
begin
  if not exists(select 1 from public.mova_artist_businesses where id=p_artist_business_id and status <> 'deleted') then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;
  if not exists(select 1 from public.mova_plan_catalog where plan_key=p_plan_key and status='active') then
    raise exception using errcode = '22023', message = 'PLAN_INVALID';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;
  select plan_key into v_before from public.mova_business_plan_assignments
    where artist_business_id=p_artist_business_id and assignment_status='current' for update;
  insert into public.mova_business_plan_assignments(artist_business_id,plan_key,assignment_status)
    values(p_artist_business_id,p_plan_key,'current')
    on conflict(artist_business_id) do update set plan_key=excluded.plan_key,assignment_status='current',updated_at=now();
  perform public.mova_admin_log('stylist.plan_assigned','artist_business',p_artist_business_id::text,p_artist_business_id,btrim(p_reason),
    jsonb_build_object('from',coalesce(v_before,'free'),'to',p_plan_key,'source','admin'));
  return public.mova_admin_stylist_feature_controls(p_artist_business_id);
end $$;

create or replace function public.mova_admin_stylist_runtime_switches(p_artist_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_prefs jsonb;
begin
  perform public.mova_require_platform_admin();
  if not exists(select 1 from public.mova_artist_businesses where id=p_artist_business_id and status <> 'deleted') then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;
  select coalesce(public.mova_stylist_features(p_artist_business_id),'{}'::jsonb) || jsonb_build_object(
    'zelle_recorded',coalesce((select zelle_recorded_enabled from public.mova_payment_method_settings where artist_business_id=p_artist_business_id),true),
    'ai_concierge',coalesce((select enabled from public.mova_concierge_settings where artist_business_id=p_artist_business_id),false)
  ) into v_prefs;
  return v_prefs;
end $$;

create or replace function public.mova_admin_set_stylist_runtime_switch(
  p_artist_business_id uuid, p_switch_key text, p_enabled boolean, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := public.mova_require_platform_admin(); v_before boolean;
begin
  if not exists(select 1 from public.mova_artist_businesses where id=p_artist_business_id and status <> 'deleted') then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;
  if p_switch_key not in ('zelle_recorded','rebooking_autopilot','seat_filler_autopilot','review_requests','google_review_import','ai_concierge','wallet_card','social_share') then
    raise exception using errcode = '22023', message = 'STYLIST_SWITCH_INVALID';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;
  v_before := coalesce((public.mova_admin_stylist_runtime_switches(p_artist_business_id)->>p_switch_key)::boolean,false);
  case p_switch_key
    when 'zelle_recorded' then
      insert into public.mova_payment_method_settings(artist_business_id,zelle_recorded_enabled,updated_by,updated_at)
        values(p_artist_business_id,p_enabled,v_admin,now()) on conflict(artist_business_id) do update
          set zelle_recorded_enabled=excluded.zelle_recorded_enabled,updated_by=excluded.updated_by,updated_at=now();
    when 'rebooking_autopilot' then
      insert into public.mova_autopilot_settings(artist_business_id,enabled,updated_by,updated_at)
        values(p_artist_business_id,p_enabled,v_admin,now()) on conflict(artist_business_id) do update
          set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
    when 'seat_filler_autopilot' then
      insert into public.mova_autopilot_settings(artist_business_id,slot_texts_autopilot,updated_by,updated_at)
        values(p_artist_business_id,p_enabled,v_admin,now()) on conflict(artist_business_id) do update
          set slot_texts_autopilot=excluded.slot_texts_autopilot,updated_by=excluded.updated_by,updated_at=now();
    when 'review_requests' then
      insert into public.mova_review_settings(artist_business_id,ask_after_visit,updated_at)
        values(p_artist_business_id,p_enabled,now()) on conflict(artist_business_id) do update
          set ask_after_visit=excluded.ask_after_visit,updated_at=now();
    when 'google_review_import' then
      insert into public.mova_review_settings(artist_business_id,google_import_enabled,updated_at)
        values(p_artist_business_id,p_enabled,now()) on conflict(artist_business_id) do update
          set google_import_enabled=excluded.google_import_enabled,updated_at=now();
    when 'ai_concierge' then
      insert into public.mova_concierge_settings(artist_business_id,enabled,globally_paused,updated_at)
        values(p_artist_business_id,p_enabled,not p_enabled,now()) on conflict(artist_business_id) do update
          set enabled=excluded.enabled,globally_paused=excluded.globally_paused,updated_at=now();
    when 'wallet_card' then
      insert into public.mova_feature_settings(artist_business_id,wallet_card,updated_by,updated_at)
        values(p_artist_business_id,p_enabled,v_admin,now()) on conflict(artist_business_id) do update
          set wallet_card=excluded.wallet_card,updated_by=excluded.updated_by,updated_at=now();
    when 'social_share' then
      insert into public.mova_feature_settings(artist_business_id,social_share,updated_by,updated_at)
        values(p_artist_business_id,p_enabled,v_admin,now()) on conflict(artist_business_id) do update
          set social_share=excluded.social_share,updated_by=excluded.updated_by,updated_at=now();
  end case;
  perform public.mova_admin_log('stylist.runtime_switch.updated','artist_business',p_switch_key,p_artist_business_id,btrim(p_reason),
    jsonb_build_object('from',v_before,'to',p_enabled));
  return public.mova_admin_stylist_runtime_switches(p_artist_business_id);
end $$;

revoke all on function public.mova_admin_stylist_feature_controls(uuid) from public, anon, authenticated;
revoke all on function public.mova_admin_set_stylist_feature(uuid,text,boolean,text) from public, anon, authenticated;
revoke all on function public.mova_admin_set_stylist_plan(uuid,text,text) from public, anon, authenticated;
revoke all on function public.mova_admin_stylist_runtime_switches(uuid) from public, anon, authenticated;
revoke all on function public.mova_admin_set_stylist_runtime_switch(uuid,text,boolean,text) from public, anon, authenticated;
grant execute on function public.mova_admin_stylist_feature_controls(uuid) to authenticated, service_role;
grant execute on function public.mova_admin_set_stylist_feature(uuid,text,boolean,text) to authenticated, service_role;
grant execute on function public.mova_admin_set_stylist_plan(uuid,text,text) to authenticated, service_role;
grant execute on function public.mova_admin_stylist_runtime_switches(uuid) to authenticated, service_role;
grant execute on function public.mova_admin_set_stylist_runtime_switch(uuid,text,boolean,text) to authenticated, service_role;
