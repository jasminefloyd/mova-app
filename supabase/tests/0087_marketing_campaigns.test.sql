begin;
select plan(15);

select ok((select relrowsecurity from pg_class where oid='public.mova_marketing_campaigns'::regclass),'campaigns have RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.mova_marketing_campaign_channels'::regclass),'campaign channels have RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.mova_marketing_deliveries'::regclass),'campaign deliveries have RLS enabled');
select ok(not has_table_privilege('anon','public.mova_marketing_campaigns','SELECT'),'anonymous users cannot read campaign drafts');
select ok(not has_table_privilege('authenticated','public.mova_marketing_campaigns','SELECT'),'authenticated users cannot bypass the tenant function for campaign drafts');
select ok(not has_table_privilege('authenticated','public.mova_marketing_deliveries','SELECT'),'authenticated users cannot read campaign recipients directly');

select ok('marketing_email'=any(public.mova_plan_feature_keys()),'email is in the feature gate catalog');
select ok('marketing_social'=any(public.mova_plan_feature_keys()),'social is in the feature gate catalog');
select ok('marketing_web_push'=any(public.mova_plan_feature_keys()),'Web Push is in the feature gate catalog');
select ok('marketing_wallet'=any(public.mova_plan_feature_keys()),'Wallet marketing is in the feature gate catalog');
select is((select entitlements#>>'{features,marketing_email}' from public.mova_plan_catalog where plan_key='free'),'true','Free includes campaign email under its allowance');
select is((select entitlements#>>'{features,marketing_social}' from public.mova_plan_catalog where plan_key='pro'),'true','Pro includes social campaigns under its allowance');
select is((select entitlements#>>'{features,marketing_web_push}' from public.mova_plan_catalog where plan_key='ai_growth'),'true','AI + Growth includes Web Push under its allowance');
select is((select entitlements#>>'{features,marketing_wallet}' from public.mova_plan_catalog where plan_key='free'),'false','Wallet marketing is excluded from Free');
select is((select entitlements#>>'{features,marketing_wallet}' from public.mova_plan_catalog where plan_key='ai_growth'),'true','AI + Growth includes Wallet marketing');

select * from finish();
rollback;
