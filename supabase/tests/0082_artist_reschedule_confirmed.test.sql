begin;
select plan(5);
select has_function('public'::name, 'mova_booking_reschedule_artist'::name, array['uuid','uuid','timestamp with time zone','text','uuid']::name[]);
select ok((select prosecdef from pg_proc where oid='public.mova_booking_reschedule_artist(uuid,uuid,timestamptz,text,uuid)'::regprocedure),'artist reschedule uses a security-definer transaction');
select ok((select proconfig @> array['search_path=public, auth, pg_temp'] from pg_proc where oid='public.mova_booking_reschedule_artist(uuid,uuid,timestamptz,text,uuid)'::regprocedure),'artist reschedule pins its search path');
select ok(not has_function_privilege('anon','public.mova_booking_reschedule_artist(uuid,uuid,timestamptz,text,uuid)','execute'),'anonymous callers cannot execute artist reschedule');
select ok(has_function_privilege('service_role','public.mova_booking_reschedule_artist(uuid,uuid,timestamptz,text,uuid)','execute'),'trusted service_role can execute artist reschedule');
select * from finish();
rollback;
