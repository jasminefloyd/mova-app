alter table public.mova_quote_requests
  add column appointment_id uuid,
  add constraint mova_quote_requests_appointment_fk
    foreign key (appointment_id, artist_business_id)
    references public.mova_appointments(id, artist_business_id)
    on delete set null (appointment_id);

create index mova_quote_requests_appointment_idx
  on public.mova_quote_requests(artist_business_id, appointment_id)
  where appointment_id is not null;
