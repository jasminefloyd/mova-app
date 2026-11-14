begin;
select plan(3);

select is((select entitlements#>>'{features,marketing_web_push}' from public.mova_plan_catalog where plan_key='free'),'false','TC-MKT-PLAN-01 Free has no campaign web push');
select is((select entitlements#>>'{features,marketing_social}' from public.mova_plan_catalog where plan_key='pro'),'true','TC-MKT-PLAN-01 Pro includes campaign social posts');
select ok(exists(select 1 from public.mova_platform_switches where key='marketing_web_push') and not exists(select 1 from public.mova_platform_switches where key='marketing_push'),'TC-MKT-PLAN-02 web push platform switch uses the feature key');

select * from finish();
rollback;
