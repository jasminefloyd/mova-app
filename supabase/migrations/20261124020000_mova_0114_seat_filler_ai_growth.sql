-- Seat Filler is part of the AI Revenue Center and comes with AI + Growth only (owner decision, 2026-11-23).
-- Pro loses it; Free never had it. slot-campaign, slot-claim and the wave sender in job-dispatch check
-- the plan on every call, so after this a Pro account can't start a campaign, send a wave or take a claim.
update public.mova_plan_catalog
set entitlements = jsonb_set(entitlements, '{features,seat_filler}', to_jsonb(plan_key = 'ai_growth'), true),
    updated_at = now()
where plan_key in ('free', 'pro', 'ai_growth');
