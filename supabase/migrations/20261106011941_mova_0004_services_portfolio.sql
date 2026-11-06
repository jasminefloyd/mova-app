create table public.mova_services (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text not null check (length(trim(category)) > 0),
  duration_minutes integer not null check (duration_minutes between 5 and 1440),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 1440),
  base_price_minor integer not null check (base_price_minor >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  deposit_type text not null default 'none' check (deposit_type in ('none', 'fixed', 'percent')),
  deposit_value integer not null default 0 check (deposit_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_services_deposit_value_valid check (
    (deposit_type = 'none' and deposit_value = 0)
    or (deposit_type = 'fixed')
    or (deposit_type = 'percent' and deposit_value between 1 and 10000)
  )
);

create index mova_services_business_status_idx
  on public.mova_services (artist_business_id, status);

create table public.mova_service_locations (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.mova_services(id) on delete cascade,
  location_id uuid not null,
  price_minor_override integer check (price_minor_override >= 0),
  duration_minutes_override integer check (duration_minutes_override between 5 and 1440),
  created_at timestamptz not null default now(),
  unique (service_id, location_id)
);

create table public.mova_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  media_path text not null,
  alt_text text not null default '',
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_business_id, sort_order)
);

create table public.mova_portfolio_service_links (
  portfolio_item_id uuid not null references public.mova_portfolio_items(id) on delete cascade,
  service_id uuid not null references public.mova_services(id) on delete cascade,
  primary key (portfolio_item_id, service_id)
);

create index mova_portfolio_items_public_order_idx
  on public.mova_portfolio_items (artist_business_id, sort_order) where is_published;

create trigger mova_services_touch_updated_at
  before update on public.mova_services for each row
  execute function public.mova_touch_updated_at();
create trigger mova_portfolio_items_touch_updated_at
  before update on public.mova_portfolio_items for each row
  execute function public.mova_touch_updated_at();

alter table public.mova_services enable row level security;
alter table public.mova_service_locations enable row level security;
alter table public.mova_portfolio_items enable row level security;
alter table public.mova_portfolio_service_links enable row level security;

create policy mova_services_member_select on public.mova_services
  for select to authenticated using (public.mova_has_artist_membership(artist_business_id));
create policy mova_services_member_insert on public.mova_services
  for insert to authenticated with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_services_member_update on public.mova_services
  for update to authenticated using (public.mova_has_artist_membership(artist_business_id))
  with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_services_member_delete on public.mova_services
  for delete to authenticated using (public.mova_has_artist_membership(artist_business_id));

create policy mova_service_locations_member_select on public.mova_service_locations
  for select to authenticated using (
    exists (select 1 from public.mova_services s where s.id = service_id
      and public.mova_has_artist_membership(s.artist_business_id))
  );
create policy mova_service_locations_member_insert on public.mova_service_locations
  for insert to authenticated with check (
    exists (select 1 from public.mova_services s where s.id = service_id
      and public.mova_has_artist_membership(s.artist_business_id))
  );
create policy mova_service_locations_member_update on public.mova_service_locations
  for update to authenticated using (
    exists (select 1 from public.mova_services s where s.id = service_id
      and public.mova_has_artist_membership(s.artist_business_id))
  ) with check (
    exists (select 1 from public.mova_services s where s.id = service_id
      and public.mova_has_artist_membership(s.artist_business_id))
  );
create policy mova_service_locations_member_delete on public.mova_service_locations
  for delete to authenticated using (
    exists (select 1 from public.mova_services s where s.id = service_id
      and public.mova_has_artist_membership(s.artist_business_id))
  );

create policy mova_portfolio_items_member_select on public.mova_portfolio_items
  for select to authenticated using (public.mova_has_artist_membership(artist_business_id));
create policy mova_portfolio_items_member_insert on public.mova_portfolio_items
  for insert to authenticated with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_portfolio_items_member_update on public.mova_portfolio_items
  for update to authenticated using (public.mova_has_artist_membership(artist_business_id))
  with check (public.mova_has_artist_membership(artist_business_id));
create policy mova_portfolio_items_member_delete on public.mova_portfolio_items
  for delete to authenticated using (public.mova_has_artist_membership(artist_business_id));

create policy mova_portfolio_links_member_select on public.mova_portfolio_service_links
  for select to authenticated using (
    exists (
      select 1 from public.mova_portfolio_items i
      join public.mova_services s on s.id = service_id
        and s.artist_business_id = i.artist_business_id
      where i.id = portfolio_item_id
        and public.mova_has_artist_membership(i.artist_business_id)
    )
  );
create policy mova_portfolio_links_member_insert on public.mova_portfolio_service_links
  for insert to authenticated with check (
    exists (
      select 1 from public.mova_portfolio_items i
      join public.mova_services s on s.id = service_id
        and s.artist_business_id = i.artist_business_id
      where i.id = portfolio_item_id
        and public.mova_has_artist_membership(i.artist_business_id)
    )
  );
create policy mova_portfolio_links_member_delete on public.mova_portfolio_service_links
  for delete to authenticated using (
    exists (
      select 1 from public.mova_portfolio_items i
      join public.mova_services s on s.id = service_id
        and s.artist_business_id = i.artist_business_id
      where i.id = portfolio_item_id
        and public.mova_has_artist_membership(i.artist_business_id)
    )
  );

grant select, insert, update, delete on public.mova_services, public.mova_service_locations,
  public.mova_portfolio_items, public.mova_portfolio_service_links to authenticated;

create or replace function public.mova_reorder_portfolio_items(p_artist_business_id uuid, p_item_ids uuid[])
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  owned_count integer;
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.mova_artist_memberships m
    where m.artist_business_id = p_artist_business_id and m.user_id = current_user_id
      and m.status = 'active' and m.role = 'owner'
  ) then raise exception using errcode = '42501', message = 'OWNER_PROFILE_REQUIRED'; end if;
  select count(*) into owned_count from public.mova_portfolio_items i where i.artist_business_id = p_artist_business_id;
  if coalesce(array_length(p_item_ids, 1), 0) <> owned_count
    or (select count(distinct item_id) from unnest(p_item_ids) as requested(item_id)) <> owned_count
    or exists (
      select 1 from unnest(p_item_ids) as requested(item_id)
      left join public.mova_portfolio_items i on i.id = requested.item_id and i.artist_business_id = p_artist_business_id
      where i.id is null
    ) then
    raise exception using errcode = '22023', message = 'PORTFOLIO_ORDER_INVALID';
  end if;
  update public.mova_portfolio_items i set sort_order = i.sort_order + 1000000
  where i.artist_business_id = p_artist_business_id;
  update public.mova_portfolio_items i set sort_order = requested.ordinality - 1
  from unnest(p_item_ids) with ordinality as requested(item_id, ordinality)
  where i.id = requested.item_id and i.artist_business_id = p_artist_business_id;
  return true;
end;
$$;

create or replace function public.mova_set_portfolio_service_links(
  p_artist_business_id uuid,
  p_portfolio_item_id uuid,
  p_service_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.mova_artist_memberships m
    where m.artist_business_id = p_artist_business_id and m.user_id = current_user_id
      and m.status = 'active' and m.role = 'owner'
  ) then raise exception using errcode = '42501', message = 'OWNER_PROFILE_REQUIRED'; end if;
  if not exists (
    select 1 from public.mova_portfolio_items i
    where i.id = p_portfolio_item_id and i.artist_business_id = p_artist_business_id
  ) then raise exception using errcode = 'P0002', message = 'PORTFOLIO_ITEM_NOT_FOUND'; end if;
  if exists (
    select 1 from unnest(coalesce(p_service_ids, '{}'::uuid[])) requested(service_id)
    left join public.mova_services s on s.id = requested.service_id and s.artist_business_id = p_artist_business_id
    where s.id is null
  ) then raise exception using errcode = '22023', message = 'SERVICE_LINK_INVALID'; end if;
  delete from public.mova_portfolio_service_links l where l.portfolio_item_id = p_portfolio_item_id;
  insert into public.mova_portfolio_service_links (portfolio_item_id, service_id)
  select p_portfolio_item_id, requested.service_id
  from unnest(coalesce(p_service_ids, '{}'::uuid[])) requested(service_id);
  return true;
end;
$$;

revoke all on function public.mova_reorder_portfolio_items(uuid, uuid[]) from public, anon;
grant execute on function public.mova_reorder_portfolio_items(uuid, uuid[]) to authenticated;
revoke all on function public.mova_set_portfolio_service_links(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.mova_set_portfolio_service_links(uuid, uuid, uuid[]) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mova_portfolio_media', 'mova_portfolio_media', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy mova_portfolio_storage_member_select on storage.objects
  for select to authenticated using (
    bucket_id = 'mova_portfolio_media'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  );
create policy mova_portfolio_storage_member_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'mova_portfolio_media'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  );
create policy mova_portfolio_storage_member_update on storage.objects
  for update to authenticated using (
    bucket_id = 'mova_portfolio_media'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  ) with check (
    bucket_id = 'mova_portfolio_media'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  );
create policy mova_portfolio_storage_member_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'mova_portfolio_media'
    and public.mova_has_artist_membership((storage.foldername(name))[1]::uuid)
  );
