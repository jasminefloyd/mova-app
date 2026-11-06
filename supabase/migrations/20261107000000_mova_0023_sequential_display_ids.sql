-- Stable, sequential labels for people-facing references. UUIDs remain the
-- relational and authorization keys; these numbers are not credentials.
create sequence public.mova_business_id_seq;
create sequence public.mova_client_id_seq;
create sequence public.mova_appointment_id_seq;

alter table public.mova_artist_businesses add column business_number bigint;
alter table public.mova_clients add column client_number bigint;
alter table public.mova_appointments add column appointment_number bigint;

with numbered as (
  select id, row_number() over (
    order by case when lower(trim(name))='rooted beauty' then 0 else 1 end, created_at, id
  ) as display_number
  from public.mova_artist_businesses
)
update public.mova_artist_businesses as businesses
set business_number=numbered.display_number
from numbered where numbered.id=businesses.id;

with numbered as (
  select id, row_number() over (order by created_at, id) as display_number
  from public.mova_clients
)
update public.mova_clients as clients
set client_number=numbered.display_number
from numbered where numbered.id=clients.id;

with numbered as (
  select id, row_number() over (order by created_at, id) as display_number
  from public.mova_appointments
)
update public.mova_appointments as appointments
set appointment_number=numbered.display_number
from numbered where numbered.id=appointments.id;

select setval('public.mova_business_id_seq', greatest(coalesce((select max(business_number) from public.mova_artist_businesses),0),1), coalesce((select max(business_number) from public.mova_artist_businesses),0)>0);
select setval('public.mova_client_id_seq', greatest(coalesce((select max(client_number) from public.mova_clients),0),1), coalesce((select max(client_number) from public.mova_clients),0)>0);
select setval('public.mova_appointment_id_seq', greatest(coalesce((select max(appointment_number) from public.mova_appointments),0),1), coalesce((select max(appointment_number) from public.mova_appointments),0)>0);

alter table public.mova_artist_businesses alter column business_number set default nextval('public.mova_business_id_seq');
alter table public.mova_clients alter column client_number set default nextval('public.mova_client_id_seq');
alter table public.mova_appointments alter column appointment_number set default nextval('public.mova_appointment_id_seq');
alter table public.mova_artist_businesses alter column business_number set not null;
alter table public.mova_clients alter column client_number set not null;
alter table public.mova_appointments alter column appointment_number set not null;

alter table public.mova_artist_businesses add constraint mova_artist_businesses_business_number_uq unique(business_number);
alter table public.mova_clients add constraint mova_clients_client_number_uq unique(client_number);
alter table public.mova_appointments add constraint mova_appointments_appointment_number_uq unique(appointment_number);
alter table public.mova_artist_businesses add constraint mova_artist_businesses_business_number_positive check(business_number > 0);
alter table public.mova_clients add constraint mova_clients_client_number_positive check(client_number > 0);
alter table public.mova_appointments add constraint mova_appointments_appointment_number_positive check(appointment_number > 0);

comment on column public.mova_artist_businesses.business_number is 'Sequential display identifier; format BID n. Not an authorization credential.';
comment on column public.mova_clients.client_number is 'Sequential display identifier; format CID n. Not an authorization credential.';
comment on column public.mova_appointments.appointment_number is 'Sequential display identifier; format AID n. Not an authorization credential.';

revoke all on sequence public.mova_business_id_seq,public.mova_client_id_seq,public.mova_appointment_id_seq from public,anon,authenticated;
grant usage on sequence public.mova_business_id_seq,public.mova_client_id_seq,public.mova_appointment_id_seq to authenticated;
