-- Task 3.5: stylist feedback (canvas 16e). Stylists insert and read only their own messages; the
-- admin inbox that reads all of them is out of scope. Screenshots live in a private bucket that
-- only the service role touches (the support-feedback Edge Function issues signed upload URLs).
create table public.mova_support_messages (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('idea', 'broken', 'question')),
  message text not null check (length(btrim(message)) between 1 and 4000),
  screenshot_path text check (screenshot_path is null or (length(screenshot_path) <= 300 and screenshot_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$')),
  screen text check (screen is null or length(screen) <= 200),
  device text check (device is null or length(device) <= 300),
  app_version text check (app_version is null or length(app_version) <= 60),
  locale text not null default 'en-US' check (locale in ('en-US', 'es-US')),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  created_at timestamptz not null default now()
);

create index mova_support_messages_business_created_idx on public.mova_support_messages (artist_business_id, created_at desc);
create index mova_support_messages_user_created_idx on public.mova_support_messages (user_id, created_at desc);

alter table public.mova_support_messages enable row level security;

create policy mova_support_messages_own_select on public.mova_support_messages
  for select to authenticated
  using (user_id = auth.uid() and public.mova_has_artist_membership(artist_business_id));

create policy mova_support_messages_own_insert on public.mova_support_messages
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'new' and public.mova_has_artist_membership(artist_business_id));

revoke all on public.mova_support_messages from public, anon, authenticated;
grant select, insert on public.mova_support_messages to authenticated;
grant all on public.mova_support_messages to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mova_support_screenshots', 'mova_support_screenshots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
