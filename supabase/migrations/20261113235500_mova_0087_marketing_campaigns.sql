-- Marketing campaign authoring and rollout controls. Provider delivery remains disabled until reviewed.
alter table public.mova_platform_switches drop constraint if exists mova_platform_switches_key_check;
alter table public.mova_platform_switches add constraint mova_platform_switches_key_check
  check (key in ('autopilot','concierge','seat_filler','zelle','reviews','spanish','tap_to_pay','marketing_email','marketing_social','marketing_push','marketing_wallet'));
insert into public.mova_platform_switches(key,enabled,reason) values
 ('marketing_email',false,'Marketing delivery awaits sender identity, postal address and compliance review.'),
 ('marketing_social',false,'Social publishing awaits platform app review and account connection flow.'),
 ('marketing_push',false,'Web Push delivery awaits VAPID configuration and recipient opt-in.'),
 ('marketing_wallet',false,'Wallet notifications await issuer credentials and channel-specific approval.')
on conflict(key) do nothing;

create or replace function public.mova_plan_feature_keys()
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select array[
    'booking_page','calendar_multi_location','unlimited_clients','unlimited_bookings','unlimited_locations',
    'client_notes_photos','guest_booking','payments_deposits_links','booking_emails','bilingual_en_es',
    'reports_basic','reviews_private','reviews_public','reports_advanced','seat_filler','text_autopilot',
    'text_reminders','rebooking_assist','google_calendar_sync','custom_cover','custom_handle',
    'rebooking_autopilot','concierge','concierge_instagram','wallet_client_card','reports_ai_revenue',
    'missed_call_textback','ai_price_pilot','marketing_email','marketing_social','marketing_web_push','marketing_wallet'
  ]::text[]
$$;

-- The approved 50/250/1,000 monthly campaign and AI message credits cover client campaign channels.
-- Wallet marketing uses the Wallet client card capability and therefore remains AI + Growth only.
update public.mova_plan_catalog set entitlements=jsonb_set(
  jsonb_set(jsonb_set(jsonb_set(entitlements,'{features,marketing_email}','true'::jsonb,true),
    '{features,marketing_social}','true'::jsonb,true),
    '{features,marketing_web_push}','true'::jsonb,true),
    '{features,marketing_wallet}',to_jsonb(plan_key='ai_growth'),true),updated_at=now()
where plan_key in ('free','pro','ai_growth');

create table public.mova_marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check(length(btrim(name)) between 1 and 120),
  goal text not null check(goal in ('fill_opening','rebook','offer','showcase')),
  audience jsonb not null default '{}'::jsonb check(jsonb_typeof(audience)='object'),
  status text not null default 'draft' check(status in ('draft','scheduled','sending','sent','partial','failed','cancelled')),
  scheduled_at timestamptz,
  recipient_timezone text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint mova_marketing_scheduled_check check(status<>'scheduled' or scheduled_at is not null)
);
create index mova_marketing_campaigns_business_recent_idx on public.mova_marketing_campaigns(artist_business_id,created_at desc);

create table public.mova_marketing_campaign_channels (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.mova_marketing_campaigns(id) on delete cascade,
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  channel text not null check(channel in ('email','social','web_push','wallet')),
  provider text check(provider in ('resend','instagram','facebook','google_business','web_push','google_wallet')),
  content jsonb not null default '{}'::jsonb check(jsonb_typeof(content)='object'),
  status text not null default 'draft' check(status in ('draft','scheduled','sending','sent','partial','failed','unavailable','cancelled')),
  provider_reference text, error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(campaign_id,channel), unique(id,artist_business_id)
);
create index mova_marketing_channels_business_idx on public.mova_marketing_campaign_channels(artist_business_id,created_at desc);

create table public.mova_marketing_deliveries (
  id uuid primary key default gen_random_uuid(), campaign_channel_id uuid not null references public.mova_marketing_campaign_channels(id) on delete cascade,
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  client_id uuid, channel text not null check(channel in ('email','social','web_push','wallet')),
  status text not null default 'queued' check(status in ('queued','sent','delivered','failed','suppressed','cancelled')),
  scheduled_at timestamptz, sent_at timestamptz, provider_reference text, error_code text,
  created_at timestamptz not null default now(), unique(campaign_channel_id,client_id)
);
create index mova_marketing_deliveries_queue_idx on public.mova_marketing_deliveries(status,scheduled_at) where status='queued';

alter table public.mova_marketing_campaigns enable row level security;
alter table public.mova_marketing_campaign_channels enable row level security;
alter table public.mova_marketing_deliveries enable row level security;
revoke all on public.mova_marketing_campaigns,public.mova_marketing_campaign_channels,public.mova_marketing_deliveries from public,anon,authenticated;
grant all on public.mova_marketing_campaigns,public.mova_marketing_campaign_channels,public.mova_marketing_deliveries to service_role;

comment on table public.mova_marketing_campaigns is 'Stylist-authored campaigns. Provider execution is separately gated; never store message bodies in system logs.';
comment on table public.mova_marketing_deliveries is 'Per-recipient campaign outcomes; consent and suppression are rechecked at send time.';

create or replace function public.mova_marketing_eligible_count(p_artist_business_id uuid,p_client_ids uuid[],p_channel text,p_purpose text)
returns integer language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if auth.role()<>'service_role' or p_channel not in ('email','push') or p_purpose not in ('offers','rebooking_reminders') or coalesce(cardinality(p_client_ids),0)>500 then
    raise exception using errcode='42501',message='MARKETING_PREVIEW_FORBIDDEN';
  end if;
  select count(*)::integer into v_count from unnest(coalesce(p_client_ids,'{}'::uuid[])) as input(client_id)
  cross join lateral public.mova_can_send(p_artist_business_id,input.client_id,p_channel,p_purpose,now()) gate
  where gate->>'allowed'='true';
  return coalesce(v_count,0);
end $$;
revoke all on function public.mova_marketing_eligible_count(uuid,uuid[],text,text) from public,anon,authenticated;
grant execute on function public.mova_marketing_eligible_count(uuid,uuid[],text,text) to service_role;

create or replace function public.mova_admin_set_platform_switch(p_key text, p_enabled boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before boolean; v_admin uuid := public.mova_require_platform_admin();
begin
  if p_key not in ('autopilot','concierge','seat_filler','zelle','reviews','spanish','tap_to_pay','marketing_email','marketing_social','marketing_push','marketing_wallet') then
    raise exception using errcode = '22023', message = 'SWITCH_INVALID';
  end if;
  if p_key = 'tap_to_pay' and p_enabled then raise exception using errcode = '55000', message = 'SWITCH_NOT_BUILT'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception using errcode = '22023', message = 'REASON_REQUIRED'; end if;
  select enabled into v_before from public.mova_platform_switches where key=p_key for update;
  update public.mova_platform_switches set enabled=p_enabled,reason=btrim(p_reason),updated_by=v_admin,updated_at=now() where key=p_key;
  perform public.mova_admin_log('switch.updated','platform_switch',p_key,null,p_reason,jsonb_build_object('from',v_before,'to',p_enabled));
  return public.mova_admin_switches();
end $$;
