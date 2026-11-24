-- PricePilot comes with AI + Growth only, with 50 checks a month (owner decision PT-D2, 2026-11-23).
-- Pro loses it (was 25 checks); AI + Growth drops from 100 to 50. More checks may be sold later.
-- The price-pilot function and worker read both values from the catalog, so nothing else changes.
update public.mova_plan_catalog
set entitlements = jsonb_set(
      jsonb_set(entitlements, '{features,ai_price_pilot}', to_jsonb(plan_key = 'ai_growth'), true),
      '{limits,price_pilot_lookups_monthly}',
      to_jsonb(case plan_key when 'ai_growth' then 50 else 0 end),
      true),
    updated_at = now()
where plan_key in ('free', 'pro', 'ai_growth');
