-- 0091 used jsonb_set with a nested path before the limits object existed,
-- which left production plans without usable PricePilot monthly allowances.
update public.mova_plan_catalog
set entitlements = jsonb_set(
  jsonb_set(
    coalesce(entitlements, '{}'::jsonb),
    '{limits}',
    coalesce(entitlements->'limits', '{}'::jsonb),
    true
  ),
  '{limits,price_pilot_lookups_monthly}',
  to_jsonb(case plan_key when 'pro' then 25 when 'ai_growth' then 100 else 0 end),
  true
),
updated_at = now()
where plan_key in ('free', 'pro', 'ai_growth');
