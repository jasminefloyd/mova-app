begin;
select plan(6);
select has_function('public'::name, 'mova_payment_record_manual'::name, array['uuid','uuid','text','bigint','text','text','text','text','uuid']::name[]);
select ok((select column_default like '%false%' from information_schema.columns where table_schema='public' and table_name='mova_payment_method_settings' and column_name='zelle_recorded_enabled'),'Zelle setting defaults disabled');
select ok(not has_function_privilege('authenticated','public.mova_payment_record_manual(uuid,uuid,text,bigint,text,text,text,text,uuid)','EXECUTE'),'authenticated users cannot bypass payment edge function');
select ok(has_function_privilege('service_role','public.mova_payment_record_manual(uuid,uuid,text,bigint,text,text,text,text,uuid)','EXECUTE'),'service role retains approved manual payment path');
select ok(has_function('public'::name, 'mova_payment_record_manual_legacy'::name, array['uuid','uuid','text','bigint','text','text','text','text','uuid']::name[]),'legacy recorder is retained only for wrapper delegation');
select throws_ok($$
  select public.mova_payment_record_manual(
    '00000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-4000-8000-000000000002'::uuid,
    'zelle_recorded',100,'artist',null,null,'zelle-a16-disabled','00000000-0000-4000-8000-000000000003'::uuid
  )
$$,'22023','PAYMENT_METHOD_UNAVAILABLE','server rejects Zelle even if a client submits the disabled method');
select * from finish();
rollback;
