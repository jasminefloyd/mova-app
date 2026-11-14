-- Store only the public postal-region fields needed to scope menu evidence.
-- They expire with the existing 45-day observation window and are never exposed verbatim.
alter table public.mova_price_pilot_sources
  add column market_region text check (market_region is null or length(market_region) between 1 and 80),
  add column market_postal_code text check (market_postal_code is null or length(market_postal_code) between 3 and 20),
  add column market_country_code char(2) check (market_country_code is null or market_country_code ~ '^[A-Z]{2}$'),
  add column market_location_expires_at timestamptz;

comment on column public.mova_price_pilot_sources.market_region is 'Region explicitly extracted from the authorized public menu page; used only for exact local-market matching.';
comment on column public.mova_price_pilot_sources.market_postal_code is 'Postal code explicitly extracted from the authorized public menu page; retained only through market_location_expires_at.';
comment on column public.mova_price_pilot_sources.market_country_code is 'Two-letter country code explicitly extracted from the authorized public menu page.';
comment on column public.mova_price_pilot_sources.market_location_expires_at is 'Address-derived market evidence expiration; set to 45 days after successful menu import.';

create function public.mova_price_pilot_expire_market_locations() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare expired_count integer;
begin
  update public.mova_price_pilot_sources
  set market_region=null, market_postal_code=null, market_country_code=null, market_location_expires_at=null
  where market_location_expires_at <= now()
    and (market_region is not null or market_postal_code is not null or market_country_code is not null);
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;
revoke all on function public.mova_price_pilot_expire_market_locations() from public, anon, authenticated;
grant execute on function public.mova_price_pilot_expire_market_locations() to service_role;
