alter table public.mova_services
  add column if not exists description text not null default '';

alter table public.mova_services
  add constraint mova_services_description_length_check
  check (char_length(description) <= 140);
