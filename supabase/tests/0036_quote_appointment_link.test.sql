begin;
select plan(4);

select has_column('public','mova_quote_requests','appointment_id','TC-MODEL-02 quote requests can point to their resulting appointment');
select ok((select count(*)=1 from pg_constraint where conrelid='public.mova_quote_requests'::regclass and conname='mova_quote_requests_appointment_fk' and contype='f'),'TC-RLS-LINKS-01 quote appointment links enforce same-tenant ownership');
select ok((select confdeltype='n' from pg_constraint where conname='mova_quote_requests_appointment_fk'),'TC-MODEL-02 deleting an appointment clears only the nullable quote link');
select ok((select count(*)=1 from pg_indexes where schemaname='public' and indexname='mova_quote_requests_appointment_idx'),'TC-MODEL-02 appointment-linked quote lookup is indexed');

select * from finish();
rollback;
