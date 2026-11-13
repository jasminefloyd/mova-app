-- Price Pilot stores only normalized menu facts from URLs a stylist submits
-- and confirms they are authorized to process. Directory API payloads are never persisted.
create table public.mova_price_pilot_sources (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  submitted_url text not null check (length(submitted_url) between 8 and 2048),
  normalized_host text not null check (length(normalized_host) between 1 and 253),
  authorization_confirmed boolean not null default false check (authorization_confirmed),
  status text not null default 'active' check (status in ('active','needs_review','removed')),
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (artist_business_id, submitted_url)
);
create index mova_price_pilot_sources_business_idx on public.mova_price_pilot_sources(artist_business_id,created_at desc) where status='active';

create table public.mova_price_pilot_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.mova_price_pilot_sources(id) on delete cascade,
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  service_name text not null check (length(service_name) between 1 and 120),
  category text check (category is null or length(category)<=80),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 5 and 1440),
  price_min_minor integer not null check (price_min_minor between 0 and 100000000),
  price_max_minor integer not null check (price_max_minor between price_min_minor and 100000000),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  pricing_basis text not null check (pricing_basis in ('fixed','range','starting_at')),
  extraction_confidence numeric(4,3) not null check (extraction_confidence between 0 and 1),
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '45 days'),
  created_at timestamptz not null default now()
);
create index mova_price_pilot_observations_business_idx on public.mova_price_pilot_observations(artist_business_id,observed_at desc);
create index mova_price_pilot_observations_source_idx on public.mova_price_pilot_observations(source_id);

alter table public.mova_price_pilot_sources enable row level security;
alter table public.mova_price_pilot_observations enable row level security;
revoke all on public.mova_price_pilot_sources,public.mova_price_pilot_observations from public,anon,authenticated;
grant select,insert,update,delete on public.mova_price_pilot_sources,public.mova_price_pilot_observations to service_role;

-- No direct client access: the Edge Function enforces membership and the plan/stylist feature override.
comment on table public.mova_price_pilot_sources is 'User-submitted competitor menu URLs with explicit processing authorization; directory provider data is transient only.';
comment on table public.mova_price_pilot_observations is 'Normalized service-price observations extracted from authorized menu URLs; no raw page content or client data.';
