begin;
select plan(5);

select has_function('public'::name, 'mova_deposit_bookings_enabled'::name, 'TC-H06-DEPOSIT-02 deposit switch is readable by functions');
select ok(not has_function_privilege('anon', 'public.mova_deposit_bookings_enabled()', 'EXECUTE'), 'TC-H06-DEPOSIT-02 anon cannot call the deposit switch');
select ok(not has_function_privilege('authenticated', 'public.mova_deposit_bookings_enabled()', 'EXECUTE'), 'TC-H06-DEPOSIT-02 stylists cannot call the deposit switch directly');
select is(public.mova_deposit_bookings_enabled(), false, 'TC-H06-DEPOSIT-02 deposits are closed by default');
select set_config('mova.allow_deposit_bookings', 'on', true);
select is(public.mova_deposit_bookings_enabled(), true, 'TC-H06-DEPOSIT-02 the switch follows the same setting as mova_booking_create');

select * from finish();
rollback;
