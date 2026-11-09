-- P6 screens: "Home studio" is a place type on the New location screen (board 19a).
-- Adds one value to the location type check. Existing rows are untouched.
alter table public.mova_locations drop constraint mova_locations_location_type_check;
alter table public.mova_locations add constraint mova_locations_location_type_check
  check (location_type in ('suite','booth','commission_salon','mobile','home_studio'));
