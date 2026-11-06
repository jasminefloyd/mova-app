create table public.mova_artist_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_artist_businesses_name_nonempty check (length(trim(name)) > 0)
);

create table public.mova_artist_memberships (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'artist', 'assistant')),
  status text not null default 'active' check (status in ('invited', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mova_artist_memberships_business_user_uq unique (artist_business_id, user_id)
);

create index mova_artist_memberships_user_active_idx
  on public.mova_artist_memberships (user_id, artist_business_id)
  where status = 'active';

create trigger mova_artist_businesses_touch_updated_at
  before update on public.mova_artist_businesses
  for each row execute function public.mova_touch_updated_at();

create trigger mova_artist_memberships_touch_updated_at
  before update on public.mova_artist_memberships
  for each row execute function public.mova_touch_updated_at();

alter table public.mova_artist_businesses enable row level security;
alter table public.mova_artist_memberships enable row level security;

create policy mova_artist_businesses_member_select
  on public.mova_artist_businesses for select to authenticated
  using (public.mova_has_artist_membership(id));

create policy mova_artist_memberships_member_select
  on public.mova_artist_memberships for select to authenticated
  using (public.mova_has_artist_membership(artist_business_id));

grant select on public.mova_artist_businesses, public.mova_artist_memberships to authenticated;
revoke all on public.mova_artist_businesses, public.mova_artist_memberships from anon;
