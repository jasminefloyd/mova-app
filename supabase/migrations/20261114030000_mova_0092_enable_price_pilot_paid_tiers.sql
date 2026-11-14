-- PricePilot is available on Pro and AI + Growth, with usage limited by 0091.
-- Free remains disabled with a zero lookup allowance.
update public.mova_plan_catalog
set entitlements = jsonb_set(entitlements, '{features,ai_price_pilot}', 'true'::jsonb, true)
where plan_key in ('pro', 'ai_growth');

update public.mova_plan_catalog
set entitlements = jsonb_set(entitlements, '{features,ai_price_pilot}', 'false'::jsonb, true)
where plan_key = 'free';

update public.mova_plan_catalog
set entitlements = case
  when jsonb_typeof(entitlements->'coming_soon') = 'array' then
    case
      when jsonb_array_length(entitlements->'coming_soon') <= 1
        and entitlements->'coming_soon' @> '["ai_price_pilot"]'::jsonb
        then entitlements - 'coming_soon'
      else jsonb_set(entitlements, '{coming_soon}', (
        select coalesce(jsonb_agg(value), '[]'::jsonb)
        from jsonb_array_elements(entitlements->'coming_soon') as item(value)
        where value <> '"ai_price_pilot"'::jsonb
      ), true)
    end
  else entitlements
end
where plan_key in ('pro', 'ai_growth');
