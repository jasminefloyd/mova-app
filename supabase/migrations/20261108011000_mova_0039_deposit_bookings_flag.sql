-- 0039: expose the deposit-booking switch that mova_booking_create already checks,
-- so availability-search stops offering times that the booking function would refuse (finding H-06).
-- The switch itself is unchanged: deposits stay closed until mova.allow_deposit_bookings is 'on'.
create or replace function public.mova_deposit_bookings_enabled()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('mova.allow_deposit_bookings', true), 'off') = 'on'
$$;

revoke all on function public.mova_deposit_bookings_enabled() from public, anon, authenticated;
grant execute on function public.mova_deposit_bookings_enabled() to service_role;
