-- Private first and last name for each stylist account (onboarding step 1).
-- Clients never see these: public pages show only the artist display name and handle.
-- Names arrive as sign-up metadata on the passwordless email-link request and are copied here
-- when the auth user is created.

create table if not exists public.mova_account_names (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name text not null check (length(trim(last_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mova_account_names is
  'Private first and last name of a Mova account holder. Never exposed on public pages or to clients.';

alter table public.mova_account_names enable row level security;

drop policy if exists mova_account_names_select_own on public.mova_account_names;
create policy mova_account_names_select_own on public.mova_account_names
  for select to authenticated using (user_id = auth.uid());

drop policy if exists mova_account_names_insert_own on public.mova_account_names;
create policy mova_account_names_insert_own on public.mova_account_names
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists mova_account_names_update_own on public.mova_account_names;
create policy mova_account_names_update_own on public.mova_account_names
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.mova_account_names from anon;
revoke delete, truncate on public.mova_account_names from authenticated;
grant select, insert, update on public.mova_account_names to authenticated;

drop trigger if exists mova_account_names_touch_updated_at on public.mova_account_names;
create trigger mova_account_names_touch_updated_at
  before update on public.mova_account_names
  for each row execute function public.mova_touch_updated_at();

-- Copy names supplied at sign-up (auth user metadata) into the private table.
-- Never blocks account creation: any problem is swallowed and the client fills the row later.
create or replace function public.mova_capture_account_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  first_value text := left(trim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), 80);
  last_value text := left(trim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), 80);
begin
  if first_value <> '' and last_value <> '' then
    insert into public.mova_account_names (user_id, first_name, last_name)
    values (new.id, first_value, last_value)
    on conflict (user_id) do nothing;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.mova_capture_account_name() from public, anon, authenticated;

drop trigger if exists mova_capture_account_name on auth.users;
create trigger mova_capture_account_name
  after insert on auth.users
  for each row execute function public.mova_capture_account_name();

-- Backfill accounts that already carry names in their metadata.
insert into public.mova_account_names (user_id, first_name, last_name)
select id,
       left(trim(raw_user_meta_data ->> 'first_name'), 80),
       left(trim(raw_user_meta_data ->> 'last_name'), 80)
from auth.users
where coalesce(trim(raw_user_meta_data ->> 'first_name'), '') <> ''
  and coalesce(trim(raw_user_meta_data ->> 'last_name'), '') <> ''
on conflict (user_id) do nothing;
