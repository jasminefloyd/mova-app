create table public.mova_client_card_tokens (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  client_id uuid not null,
  customer_account_id uuid not null references public.mova_customer_accounts(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint mova_client_card_tokens_client_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade
);
create unique index mova_client_card_tokens_active_uq on public.mova_client_card_tokens(artist_business_id,client_id,customer_account_id) where revoked_at is null;

create table public.mova_wallet_passes (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check(subject_type in ('client_card','artist_card')),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  client_id uuid,
  customer_account_id uuid references public.mova_customer_accounts(id) on delete cascade,
  platform text not null check(platform in ('apple','google')),
  serial text not null,
  auth_token_hash text not null unique check(auth_token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check(status in ('pending','active','revoked','error')),
  last_payload_hash text,
  last_pushed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mova_wallet_passes_client_fk foreign key(client_id,artist_business_id) references public.mova_clients(id,artist_business_id) on delete cascade,
  constraint mova_wallet_passes_subject_check check ((subject_type='client_card' and client_id is not null and customer_account_id is not null) or (subject_type='artist_card' and client_id is null))
);
create unique index mova_wallet_passes_serial_uq on public.mova_wallet_passes(platform,serial);

create table public.mova_wallet_device_registrations (
  id uuid primary key default gen_random_uuid(),
  wallet_pass_id uuid not null references public.mova_wallet_passes(id) on delete cascade,
  device_library_id text not null,
  push_token_encrypted bytea not null,
  registered_at timestamptz not null default now(),
  unregistered_at timestamptz,
  constraint mova_wallet_device_registrations_pass_device_uq unique(wallet_pass_id,device_library_id)
);

create table public.mova_artist_qr_scans (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  scan_session_hash text not null check(scan_session_hash ~ '^[0-9a-f]{64}$'),
  scanned_at timestamptz not null default now(),
  constraint mova_artist_qr_scans_session_uq unique(artist_business_id,scan_session_hash)
);

alter table public.mova_client_card_tokens enable row level security;
alter table public.mova_wallet_passes enable row level security;
alter table public.mova_wallet_device_registrations enable row level security;
alter table public.mova_artist_qr_scans enable row level security;
revoke all on public.mova_client_card_tokens,public.mova_wallet_passes,public.mova_wallet_device_registrations,public.mova_artist_qr_scans from public,anon,authenticated;
