begin;
select plan(19);
select has_table('public'::name, 'mova_profile_traffic_events'::name);
select has_table('public'::name, 'mova_reports_daily_rollups'::name);
select has_table('public'::name, 'mova_review_requests'::name);
select has_table('public'::name, 'mova_reviews'::name);
select has_table('public'::name, 'mova_google_reviews'::name);
select has_function('public'::name, 'mova_reports_refresh_daily'::name, array['uuid','date']::name[]);
select has_function('public'::name, 'mova_reports_summary'::name, array['uuid','date','date']::name[]);
select has_function('public'::name, 'mova_reputation_summary'::name, array['uuid','boolean']::name[]);
select has_function('public'::name, 'mova_review_submit'::name, array['bytea','smallint','text[]','text','text']::name[]);
select ok((select relrowsecurity from pg_class where oid='public.mova_reviews'::regclass),'review table has RLS');
select ok(not has_table_privilege('anon','public.mova_reviews','SELECT'),'anonymous cannot query reviews directly');
select ok(not has_table_privilege('authenticated','public.mova_reviews','INSERT'),'artists cannot insert reviews directly');
select ok(not has_function_privilege('anon','public.mova_reports_summary(uuid,date,date)','EXECUTE'),'anonymous cannot call private report summary');
select ok(has_function_privilege('service_role','public.mova_reports_summary(uuid,date,date)','EXECUTE'),'service role can build report summary');
select ok(not has_function_privilege('anon','public.mova_reputation_summary(uuid,boolean)','EXECUTE'),'anonymous cannot call private reputation summary');
select ok(not exists(select 1 from public.mova_reviews where public_display_enabled and moderation_status<>'approved'),'public reviews must be approved');
select ok(not exists(select 1 from pg_class where relname='mova_reviews' and not relrowsecurity),'RLS remains enabled');
insert into public.mova_artist_businesses(id,name,status)
values('f6db6de0-1eaa-48c6-9367-817b9ffb8030','Reports summary test','active');
select lives_ok($$select public.mova_reports_summary('f6db6de0-1eaa-48c6-9367-817b9ffb8030'::uuid,current_date-1,current_date)$$,
  'reports summary refreshes rollups without ambiguous status references');
select ok(public.mova_reports_summary('f6db6de0-1eaa-48c6-9367-817b9ffb8030'::uuid,current_date-1,current_date) ? 'current',
  'reports summary returns the current period');
select * from finish();
rollback;
