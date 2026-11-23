begin;
select plan(7);

select ok(not has_table_privilege('anon', 'public.mova_calculator_funnel_daily', 'SELECT'), 'Anonymous cannot read funnel aggregates');
select ok(not has_function_privilege('authenticated', 'public.mova_record_calculator_event(text)', 'EXECUTE'), 'Browser roles cannot call the database recorder');
select ok(not has_function_privilege('anon', 'public.mova_record_calculator_event(text)', 'EXECUTE'), 'Anonymous cannot bypass the web endpoint');
select ok(not has_table_privilege('service_role', 'public.mova_calculator_funnel_daily', 'INSERT'), 'Service role writes through the constrained recorder');

set local role service_role;
select public.mova_record_calculator_event('calculator_used');
select public.mova_record_calculator_event('calculator_used');
select public.mova_record_calculator_event('start_free_clicked');
select results_eq(
  $$select event, total from public.mova_calculator_funnel_daily order by event$$,
  $$values ('calculator_used'::text,2::bigint), ('start_free_clicked'::text,1::bigint)$$,
  'Events aggregate by type with no visitor record'
);
select is((select min(day) from public.mova_calculator_funnel_daily), (now() at time zone 'UTC')::date, 'Reporting groups by UTC day');
select throws_ok($$select public.mova_record_calculator_event('amount=750')$$, '23514', null, 'The recorder rejects data outside the event vocabulary');
reset role;

select * from finish();
rollback;
