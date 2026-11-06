create table public.mova_client_notes (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null,
  client_id uuid not null,
  category text not null check (category in ('hair','color','products','preferences','personal','free')),
  body text not null default '',
  sensitive_ciphertext text,
  sensitive_key_version text,
  is_sensitive boolean not null default false,
  is_pinned boolean not null default false,
  show_next_visit boolean not null default false,
  next_appointment_id uuid references public.mova_appointments(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_client_notes_client_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade,
  constraint mova_client_notes_sensitive_ciphertext_ck check ((is_sensitive and sensitive_ciphertext is not null and body='') or (not is_sensitive and sensitive_ciphertext is null and sensitive_key_version is null))
);
create index mova_client_notes_client_idx on public.mova_client_notes(artist_business_id,client_id,updated_at desc);
create index mova_client_notes_next_visit_idx on public.mova_client_notes(artist_business_id,client_id,updated_at desc) where show_next_visit;
create trigger mova_client_notes_touch_updated_at before update on public.mova_client_notes for each row execute function public.mova_touch_updated_at();

create table public.mova_client_note_history (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null,
  client_id uuid not null,
  note_id uuid not null,
  category text not null,
  body text not null default '',
  sensitive_ciphertext text,
  sensitive_key_version text,
  is_sensitive boolean not null,
  is_pinned boolean not null,
  show_next_visit boolean not null,
  next_appointment_id uuid references public.mova_appointments(id) on delete set null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint mova_client_note_history_client_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade
);
create index mova_client_note_history_note_idx on public.mova_client_note_history(artist_business_id,note_id,changed_at desc);

create table public.mova_visit_notes (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null,
  client_id uuid not null,
  appointment_id uuid not null,
  what_was_done text not null default '',
  products_settings jsonb not null default '[]'::jsonb check(jsonb_typeof(products_settings)='array'),
  for_next_time text not null default '',
  show_next_visit boolean not null default false,
  next_appointment_id uuid references public.mova_appointments(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_visit_notes_client_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade,
  constraint mova_visit_notes_appointment_fk foreign key(appointment_id,artist_business_id) references public.mova_appointments(id,artist_business_id) on delete cascade,
  constraint mova_visit_notes_appointment_uq unique(appointment_id)
);
create index mova_visit_notes_client_idx on public.mova_visit_notes(artist_business_id,client_id,created_at desc);
create index mova_visit_notes_next_visit_idx on public.mova_visit_notes(artist_business_id,client_id,created_at desc) where show_next_visit;
create trigger mova_visit_notes_touch_updated_at before update on public.mova_visit_notes for each row execute function public.mova_touch_updated_at();

create table public.mova_visit_note_media (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null,
  client_id uuid not null,
  visit_note_id uuid not null references public.mova_visit_notes(id) on delete cascade,
  kind text not null check(kind in ('before','after')),
  storage_path text not null unique,
  content_type text not null check(content_type in ('image/jpeg','image/png','image/webp')),
  created_at timestamptz not null default now(),
  constraint mova_visit_note_media_client_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade
);
create index mova_visit_note_media_visit_idx on public.mova_visit_note_media(artist_business_id,visit_note_id,created_at);

create or replace function public.mova_client_note_assign_next_visit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.show_next_visit then
    select a.id into new.next_appointment_id from public.mova_appointments a where a.artist_business_id=new.artist_business_id and a.client_id=new.client_id and a.status in ('confirmed','pending_artist','pending_payment') and a.starts_at>now() order by a.starts_at limit 1;
  else new.next_appointment_id:=null; end if;
  return new;
end $$;
create trigger mova_client_notes_assign_next_visit before insert or update of show_next_visit,client_id on public.mova_client_notes for each row execute function public.mova_client_note_assign_next_visit();

create or replace function public.mova_visit_note_assign_next_visit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare current_start timestamptz;
begin
  if new.show_next_visit then
    select starts_at into current_start from public.mova_appointments where id=new.appointment_id and artist_business_id=new.artist_business_id and client_id=new.client_id;
    select a.id into new.next_appointment_id from public.mova_appointments a where a.artist_business_id=new.artist_business_id and a.client_id=new.client_id and a.status in ('confirmed','pending_artist','pending_payment') and a.starts_at>coalesce(current_start,now()) order by a.starts_at limit 1;
  else new.next_appointment_id:=null; end if;
  return new;
end $$;
create trigger mova_visit_notes_assign_next_visit before insert or update of show_next_visit,appointment_id,client_id on public.mova_visit_notes for each row execute function public.mova_visit_note_assign_next_visit();

create or replace function public.mova_refresh_next_visit_notes(p_artist_business_id uuid,p_client_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare next_id uuid;
begin
  select id into next_id from public.mova_appointments where artist_business_id=p_artist_business_id and client_id=p_client_id and status in ('confirmed','pending_artist','pending_payment') and starts_at>now() order by starts_at limit 1;
  update public.mova_client_notes set next_appointment_id=next_id where artist_business_id=p_artist_business_id and client_id=p_client_id and show_next_visit;
  update public.mova_visit_notes vn set next_appointment_id=(select a.id from public.mova_appointments a where a.artist_business_id=p_artist_business_id and a.client_id=p_client_id and a.status in ('confirmed','pending_artist','pending_payment') and a.starts_at>(select current_appointment.starts_at from public.mova_appointments current_appointment where current_appointment.id=vn.appointment_id) order by a.starts_at limit 1) where vn.artist_business_id=p_artist_business_id and vn.client_id=p_client_id and vn.show_next_visit;
end $$;
revoke all on function public.mova_refresh_next_visit_notes(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mova_refresh_next_visit_notes(uuid,uuid) to service_role;

create or replace function public.mova_appointments_refresh_next_visit_trigger() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.client_id is not null and (old.client_id is distinct from new.client_id or old.status is distinct from new.status or old.starts_at is distinct from new.starts_at) then perform public.mova_refresh_next_visit_notes(old.artist_business_id,old.client_id); end if;
  if new.client_id is not null then perform public.mova_refresh_next_visit_notes(new.artist_business_id,new.client_id); end if;
  return new;
end $$;
create trigger mova_appointments_refresh_next_visit after insert or update of client_id,status,starts_at on public.mova_appointments for each row execute function public.mova_appointments_refresh_next_visit_trigger();
revoke all on function public.mova_appointments_refresh_next_visit_trigger() from public,anon,authenticated;
revoke all on function public.mova_client_note_assign_next_visit() from public,anon,authenticated;
revoke all on function public.mova_visit_note_assign_next_visit() from public,anon,authenticated;

alter table public.mova_client_notes enable row level security;
alter table public.mova_client_note_history enable row level security;
alter table public.mova_visit_notes enable row level security;
alter table public.mova_visit_note_media enable row level security;
create policy mova_client_notes_artist_select on public.mova_client_notes for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_client_note_history_artist_select on public.mova_client_note_history for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_visit_notes_artist_select on public.mova_visit_notes for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
create policy mova_visit_note_media_artist_select on public.mova_visit_note_media for select to authenticated using(public.mova_has_artist_membership(artist_business_id));
revoke all on public.mova_client_notes,public.mova_client_note_history,public.mova_visit_notes,public.mova_visit_note_media from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('mova_visit_private','mova_visit_private',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy mova_visit_media_artist_read on storage.objects for select to authenticated using(bucket_id='mova_visit_private' and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid));
revoke all on function public.mova_touch_updated_at() from public,anon,authenticated;
