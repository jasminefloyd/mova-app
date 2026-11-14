-- 0091: PricePilot saved price plans, a per-stylist comparison radius, monthly lookup metering,
-- and an atomic menu replacement. Plan allowances: Free 0, Pro 25, AI + Growth 100 lookups a month.

create table public.mova_price_pilot_settings (
  artist_business_id uuid primary key references public.mova_artist_businesses(id) on delete cascade,
  radius_miles smallint not null default 5 check (radius_miles between 1 and 15),
  updated_at timestamptz not null default now()
);

create table public.mova_price_plans (
  id uuid primary key default gen_random_uuid(),
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  location_id uuid not null references public.mova_locations(id) on delete cascade,
  service_id uuid not null references public.mova_services(id) on delete cascade,
  current_price_minor bigint not null check (current_price_minor >= 0),
  target_price_minor bigint not null check (target_price_minor >= 1),
  reference_median_minor bigint check (reference_median_minor is null or reference_median_minor >= 0),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_business_id, location_id, service_id)
);

create table public.mova_price_pilot_usage (
  artist_business_id uuid not null references public.mova_artist_businesses(id) on delete cascade,
  period_start date not null,
  used integer not null default 0 check (used >= 0),
  primary key (artist_business_id, period_start)
);

alter table public.mova_price_pilot_settings enable row level security;
alter table public.mova_price_plans enable row level security;
alter table public.mova_price_pilot_usage enable row level security;
revoke all on public.mova_price_pilot_settings, public.mova_price_plans, public.mova_price_pilot_usage from public, anon, authenticated;
grant all on public.mova_price_pilot_settings, public.mova_price_plans, public.mova_price_pilot_usage to service_role;

update public.mova_plan_catalog set entitlements = jsonb_set(entitlements, '{limits,price_pilot_lookups_monthly}',
  to_jsonb(case plan_key when 'pro' then 25 when 'ai_growth' then 100 else 0 end), true), updated_at = now()
where plan_key in ('free', 'pro', 'ai_growth');

create or replace function public.mova_price_pilot_monthly_limit(p_artist_business_id uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((c.entitlements#>>'{limits,price_pilot_lookups_monthly}')::integer, 0)
  from public.mova_business_plan_assignments a
  join public.mova_plan_catalog c on c.plan_key = a.plan_key and c.status = 'active'
  where a.artist_business_id = p_artist_business_id and a.assignment_status = 'current'
  limit 1
$$;

-- Counts one paid lookup (business search or menu check) for the current UTC month. Raises when the allowance is used up.
create or replace function public.mova_price_pilot_consume(p_artist_business_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_period date := date_trunc('month', now() at time zone 'UTC')::date;
  v_limit integer := public.mova_price_pilot_monthly_limit(p_artist_business_id);
  v_used integer;
begin
  insert into public.mova_price_pilot_usage (artist_business_id, period_start, used)
  values (p_artist_business_id, v_period, 0)
  on conflict (artist_business_id, period_start) do nothing;
  update public.mova_price_pilot_usage set used = used + 1
  where artist_business_id = p_artist_business_id and period_start = v_period and used < v_limit
  returning used into v_used;
  if v_used is null then
    raise exception using errcode = 'P0001', message = 'PRICE_PILOT_LIMIT_REACHED';
  end if;
  return v_used;
end $$;

-- Replaces one source's prices in a single transaction: old rows are removed only if the new rows are written.
create or replace function public.mova_price_pilot_replace_observations(p_artist_business_id uuid, p_source_id uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.mova_price_pilot_sources as s where s.id = p_source_id and s.artist_business_id = p_artist_business_id) then
    raise exception using errcode = 'P0002', message = 'SOURCE_NOT_FOUND';
  end if;
  delete from public.mova_price_pilot_observations where source_id = p_source_id and artist_business_id = p_artist_business_id;
  insert into public.mova_price_pilot_observations (source_id, artist_business_id, service_name, category, duration_minutes,
    price_min_minor, price_max_minor, currency, pricing_basis, extraction_confidence)
  select p_source_id, p_artist_business_id, r.service_name, r.category, r.duration_minutes,
    r.price_min_minor, r.price_max_minor, r.currency, r.pricing_basis, r.extraction_confidence
  from jsonb_to_recordset(p_rows) as r(service_name text, category text, duration_minutes integer,
    price_min_minor integer, price_max_minor integer, currency text, pricing_basis text, extraction_confidence numeric);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.mova_price_pilot_monthly_limit(uuid) from public, anon, authenticated;
revoke all on function public.mova_price_pilot_consume(uuid) from public, anon, authenticated;
revoke all on function public.mova_price_pilot_replace_observations(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mova_price_pilot_monthly_limit(uuid), public.mova_price_pilot_consume(uuid), public.mova_price_pilot_replace_observations(uuid, uuid, jsonb) to service_role;
