-- 0090: campaigns are a Pro and AI + Growth feature (tiers doc), and the web push platform switch
-- uses the same key as its plan feature: marketing_web_push. Email, social and web push stay off on Free.

update public.mova_plan_catalog set entitlements = jsonb_set(
  jsonb_set(jsonb_set(entitlements,
    '{features,marketing_email}', to_jsonb(plan_key in ('pro','ai_growth')), true),
    '{features,marketing_social}', to_jsonb(plan_key in ('pro','ai_growth')), true),
    '{features,marketing_web_push}', to_jsonb(plan_key in ('pro','ai_growth')), true),
  updated_at = now()
where plan_key in ('free','pro','ai_growth');

alter table public.mova_platform_switches drop constraint if exists mova_platform_switches_key_check;
alter table public.mova_platform_switches add constraint mova_platform_switches_key_check
  check (key in ('autopilot','concierge','seat_filler','zelle','reviews','spanish','tap_to_pay','marketing_email','marketing_social','marketing_push','marketing_web_push','marketing_wallet'));

update public.mova_platform_switches set key = 'marketing_web_push'
where key = 'marketing_push'
  and not exists (select 1 from public.mova_platform_switches as existing where existing.key = 'marketing_web_push');

alter table public.mova_platform_switches drop constraint if exists mova_platform_switches_key_check;
alter table public.mova_platform_switches add constraint mova_platform_switches_key_check
  check (key in ('autopilot','concierge','seat_filler','zelle','reviews','spanish','tap_to_pay','marketing_email','marketing_social','marketing_web_push','marketing_wallet'));
