begin;
select plan(5);
select has_function('public','mova_payment_record_manual',array['uuid','uuid','text','bigint','text','text','text','text','uuid']);
select ok((select column_default like '%false%' from information_schema.columns where table_schema='public' and table_name='mova_payment_method_settings' and column_name='zelle_recorded_enabled'),'Zelle setting defaults disabled');
select ok(not has_function_privilege('authenticated','public.mova_payment_record_manual(uuid,uuid,text,bigint,text,text,text,text,uuid)','EXECUTE'),'authenticated users cannot bypass payment edge function');
select ok(has_function_privilege('service_role','public.mova_payment_record_manual(uuid,uuid,text,bigint,text,text,text,text,uuid)','EXECUTE'),'service role retains approved manual payment path');
select ok(has_function('public','mova_payment_record_manual_legacy',array['uuid','uuid','text','bigint','text','text','text','text','uuid']),'legacy recorder is retained only for wrapper delegation');
select * from finish();
rollback;
