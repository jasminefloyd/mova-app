-- Final owner-approved plan matrix (2026-11-13). Historical payment snapshots remain immutable.
update public.mova_plan_catalog
set display_name = 'Free', mova_fee_basis_points = 150,
    entitlements = '{"features":{"booking_page":true,"calendar_multi_location":true,"unlimited_clients":true,"unlimited_bookings":true,"unlimited_locations":true,"client_notes_photos":true,"guest_booking":true,"payments_deposits_links":true,"booking_emails":true,"bilingual_en_es":true,"reports_basic":true,"reviews_private":true,"reviews_public":false,"reports_advanced":false,"seat_filler":false,"text_autopilot":false,"text_reminders":false,"rebooking_assist":false,"google_calendar_sync":false,"custom_cover":false,"custom_handle":false,"rebooking_autopilot":false,"concierge":false,"concierge_instagram":false,"wallet_client_card":false,"reports_ai_revenue":false,"missed_call_textback":false,"ai_price_pilot":false},"allowances":{"message_credits_monthly":50,"concierge_replies_monthly":0}}'::jsonb,
    updated_at = now()
where plan_key = 'free';

update public.mova_plan_catalog
set display_name = 'Pro', mova_fee_basis_points = 100,
    entitlements = '{"features":{"booking_page":true,"calendar_multi_location":true,"unlimited_clients":true,"unlimited_bookings":true,"unlimited_locations":true,"client_notes_photos":true,"guest_booking":true,"payments_deposits_links":true,"booking_emails":true,"bilingual_en_es":true,"reports_basic":true,"reviews_private":true,"reviews_public":true,"reports_advanced":true,"seat_filler":true,"text_autopilot":true,"text_reminders":true,"rebooking_assist":true,"google_calendar_sync":true,"custom_cover":true,"custom_handle":true,"rebooking_autopilot":false,"concierge":false,"concierge_instagram":false,"wallet_client_card":false,"reports_ai_revenue":false,"missed_call_textback":false,"ai_price_pilot":false},"allowances":{"message_credits_monthly":250,"concierge_replies_monthly":0}}'::jsonb,
    updated_at = now()
where plan_key = 'pro';

update public.mova_plan_catalog
set display_name = 'AI + Growth', mova_fee_basis_points = 75,
    entitlements = '{"features":{"booking_page":true,"calendar_multi_location":true,"unlimited_clients":true,"unlimited_bookings":true,"unlimited_locations":true,"client_notes_photos":true,"guest_booking":true,"payments_deposits_links":true,"booking_emails":true,"bilingual_en_es":true,"reports_basic":true,"reviews_private":true,"reviews_public":true,"reports_advanced":true,"seat_filler":true,"text_autopilot":true,"text_reminders":true,"rebooking_assist":true,"google_calendar_sync":true,"custom_cover":true,"custom_handle":true,"rebooking_autopilot":true,"concierge":true,"concierge_instagram":true,"wallet_client_card":true,"reports_ai_revenue":true,"missed_call_textback":true,"ai_price_pilot":false},"allowances":{"message_credits_monthly":1000,"concierge_replies_monthly":1000},"coming_soon":["ai_price_pilot"]}'::jsonb,
    updated_at = now()
where plan_key = 'ai_growth';

create table public.mova_business_feature_overrides (
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (artist_business_id, feature_key)
);

create table public.mova_client_feature_overrides (
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  customer_account_id uuid not null references public.mova_customer_accounts(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (artist_business_id, customer_account_id, feature_key)
);

alter table public.mova_business_feature_overrides enable row level security;
alter table public.mova_client_feature_overrides enable row level security;
revoke all on public.mova_business_feature_overrides, public.mova_client_feature_overrides from public, anon, authenticated;
grant all on public.mova_business_feature_overrides, public.mova_client_feature_overrides to service_role;

create function public.mova_plan_feature_keys()
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select array[
    'booking_page','calendar_multi_location','unlimited_clients','unlimited_bookings','unlimited_locations',
    'client_notes_photos','guest_booking','payments_deposits_links','booking_emails','bilingual_en_es',
    'reports_basic','reviews_private','reviews_public','reports_advanced','seat_filler','text_autopilot',
    'text_reminders','rebooking_assist','google_calendar_sync','custom_cover','custom_handle',
    'rebooking_autopilot','concierge','concierge_instagram','wallet_client_card','reports_ai_revenue',
    'missed_call_textback','ai_price_pilot'
  ]::text[]
$$;

create function public.mova_set_business_feature_override(
  p_artist_business_id uuid, p_feature_key text, p_enabled boolean, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_plan_enabled boolean;
begin
  if v_user is null or not public.mova_has_artist_membership(p_artist_business_id) then
    raise exception using errcode = '42501', message = 'ARTIST_MEMBERSHIP_REQUIRED';
  end if;
  if not (p_feature_key = any(public.mova_plan_feature_keys())) or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'FEATURE_OVERRIDE_INVALID';
  end if;
  select coalesce((c.entitlements->'features'->>p_feature_key)::boolean, false) into v_plan_enabled
  from public.mova_business_plan_assignments a join public.mova_plan_catalog c on c.plan_key=a.plan_key and c.status='active'
  where a.artist_business_id=p_artist_business_id and a.assignment_status='current';
  if coalesce(p_enabled,false) and not coalesce(v_plan_enabled,false) then
    raise exception using errcode = '42501', message = 'FEATURE_NOT_INCLUDED_IN_PLAN';
  end if;
  insert into public.mova_business_feature_overrides(artist_business_id,feature_key,enabled,reason,updated_by)
    values(p_artist_business_id,p_feature_key,p_enabled,btrim(p_reason),v_user)
    on conflict(artist_business_id,feature_key) do update set enabled=excluded.enabled,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
  return jsonb_build_object('feature_key',p_feature_key,'enabled',p_enabled);
end $$;

create function public.mova_set_client_feature_override(
  p_artist_business_id uuid, p_customer_account_id uuid, p_feature_key text, p_enabled boolean, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists(select 1 from public.mova_customer_accounts a where a.id=p_customer_account_id and a.user_id=v_user and a.status='active') then
    raise exception using errcode = '42501', message = 'CUSTOMER_ACCOUNT_REQUIRED';
  end if;
  if not (p_feature_key = any(public.mova_plan_feature_keys())) or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'FEATURE_OVERRIDE_INVALID';
  end if;
  if not exists(select 1 from public.mova_client_customer_links l where l.artist_business_id=p_artist_business_id and l.customer_account_id=p_customer_account_id and l.unlinked_at is null) then
    raise exception using errcode = '42501', message = 'CLIENT_BUSINESS_LINK_REQUIRED';
  end if;
  if p_enabled then raise exception using errcode = '42501', message = 'CLIENT_FEATURES_CANNOT_BE_GRANTED'; end if;
  insert into public.mova_client_feature_overrides(artist_business_id,customer_account_id,feature_key,enabled,reason,updated_by)
    values(p_artist_business_id,p_customer_account_id,p_feature_key,false,btrim(p_reason),v_user)
    on conflict(artist_business_id,customer_account_id,feature_key) do update set enabled=false,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
  return jsonb_build_object('feature_key',p_feature_key,'enabled',false);
end $$;

create function public.mova_feature_gate(p_artist_business_id uuid, p_feature_key text, p_customer_account_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_plan_enabled boolean := false; v_enabled boolean; v_override boolean; v_source text := 'plan';
begin
  if not (p_feature_key = any(public.mova_plan_feature_keys())) then
    return jsonb_build_object('enabled',false,'source','unknown_feature');
  end if;
  select coalesce((c.entitlements->'features'->>p_feature_key)::boolean,false) into v_plan_enabled
  from public.mova_business_plan_assignments a join public.mova_plan_catalog c on c.plan_key=a.plan_key and c.status='active'
  where a.artist_business_id=p_artist_business_id and a.assignment_status='current';
  v_enabled := coalesce(v_plan_enabled,false);
  select o.enabled into v_override from public.mova_business_feature_overrides o
  where o.artist_business_id=p_artist_business_id and o.feature_key=p_feature_key;
  if found then v_enabled := v_override; v_source := 'stylist_override'; end if;
  if p_customer_account_id is not null then
    select o.enabled into v_override from public.mova_client_feature_overrides o
    where o.artist_business_id=p_artist_business_id and o.customer_account_id=p_customer_account_id and o.feature_key=p_feature_key;
    if found then v_enabled := v_override; v_source := 'client_override'; end if;
  end if;
  return jsonb_build_object('enabled',coalesce(v_enabled,false),'source',v_source,'plan_enabled',coalesce(v_plan_enabled,false));
end $$;

create function public.mova_business_features(p_artist_business_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(key, (public.mova_feature_gate(p_artist_business_id,key,null)->>'enabled')::boolean), '{}'::jsonb)
  from unnest(public.mova_plan_feature_keys()) as feature(key)
$$;

revoke all on function public.mova_plan_feature_keys() from public, anon, authenticated;
revoke all on function public.mova_set_business_feature_override(uuid,text,boolean,text) from public, anon;
revoke all on function public.mova_set_client_feature_override(uuid,uuid,text,boolean,text) from public, anon;
revoke all on function public.mova_feature_gate(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.mova_business_features(uuid) from public, anon, authenticated;
grant execute on function public.mova_set_business_feature_override(uuid,text,boolean,text) to authenticated, service_role;
grant execute on function public.mova_set_client_feature_override(uuid,uuid,text,boolean,text) to authenticated, service_role;
grant execute on function public.mova_feature_gate(uuid,text,uuid) to service_role;
grant execute on function public.mova_business_features(uuid) to service_role;
