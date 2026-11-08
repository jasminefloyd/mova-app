begin;
select no_plan();

insert into auth.users (id, aud, role, email, email_confirmed_at) values
  ('f4444444-4444-4444-8444-444444444451', 'authenticated', 'authenticated', 'same-client@example.invalid', now()),
  ('f4444444-4444-4444-8444-444444444452', 'authenticated', 'authenticated', 'other-client@example.invalid', now())
on conflict (id) do nothing;

insert into public.mova_artist_businesses (id, name, status) values
  ('f4444444-4444-4444-8444-444444444441', 'RLS customer adversary fixture', 'active'),
  ('f5555555-5555-4555-8555-555555555551', 'RLS second tenant fixture', 'active')
on conflict (id) do nothing;

insert into public.mova_clients (id, artist_business_id, display_name, email, email_normalized, source) values
  ('f4444444-4444-4444-8444-444444444461', 'f4444444-4444-4444-8444-444444444441', 'Same tenant client fixture', 'same-client@example.invalid', 'same-client@example.invalid', 'manual'),
  ('f5555555-5555-4555-8555-555555555561', 'f5555555-5555-4555-8555-555555555551', 'Other tenant client fixture', 'other-client@example.invalid', 'other-client@example.invalid', 'manual')
on conflict (id) do nothing;

insert into public.mova_customer_accounts (id, user_id, display_name) values
  ('f4444444-4444-4444-8444-444444444471', 'f4444444-4444-4444-8444-444444444451', 'Same stylist client'),
  ('f5555555-5555-4555-8555-555555555571', 'f4444444-4444-4444-8444-444444444452', 'Other stylist client')
on conflict (id) do nothing;

insert into public.mova_client_customer_links (artist_business_id, client_id, customer_account_id, linked_via) values
  ('f4444444-4444-4444-8444-444444444441', 'f4444444-4444-4444-8444-444444444461', 'f4444444-4444-4444-8444-444444444471', 'claim_verified'),
  ('f5555555-5555-4555-8555-555555555551', 'f5555555-5555-4555-8555-555555555561', 'f5555555-5555-4555-8555-555555555571', 'claim_verified')
on conflict do nothing;

create function public.mova_test_customer_adversary(
  p_case text,
  p_business_id uuid
) returns setof text
language plpgsql
as $customer_adversary$
declare
  table_row record;
  visible_rows bigint;
  updated_rows bigint;
  deleted_rows bigint;
  changed_column text;
begin
  for table_row in
    select group_row.group_id, group_row.table_name
    from (values
      ('TENANTCFG','mova_artist_profiles'),('TENANTCFG','mova_services'),('TENANTCFG','mova_service_locations'),('TENANTCFG','mova_locations'),('TENANTCFG','mova_location_hours'),('TENANTCFG','mova_location_exceptions'),('TENANTCFG','mova_location_policies'),('TENANTCFG','mova_availability_blocks'),('TENANTCFG','mova_portfolio_items'),('TENANTCFG','mova_portfolio_service_links'),('TENANTCFG','mova_onboarding_progress'),
      ('CLIENTS','mova_clients'),('CLIENTS','mova_client_consents'),('CLIENTS','mova_client_import_batches'),
      ('NOTES','mova_client_notes'),('NOTES','mova_client_note_history'),('NOTES','mova_visit_notes'),('NOTES','mova_visit_note_media'),
      ('APPTS','mova_appointments'),('APPTS','mova_booking_holds'),('APPTS','mova_appointment_events'),
      ('MONEY','mova_payments'),('MONEY','mova_payment_ledger'),('MONEY','mova_payment_refunds'),('MONEY','mova_paylinks'),
      ('CUST','mova_customer_accounts'),('CUST','mova_customer_contact_methods'),
      ('LINKS','mova_client_customer_links'),('LINKS','mova_client_link_suggestions'),
      ('MSG','mova_sending_identities'),('MSG','mova_message_templates'),('MSG','mova_messages'),('MSG','mova_conversations'),('MSG','mova_concierge_turns'),('MSG','mova_handoffs'),('MSG','mova_quote_requests'),
      ('AUTO','mova_growth_opportunities'),('AUTO','mova_autopilot_settings'),('AUTO','mova_autopilot_decisions'),('AUTO','mova_slot_events'),('AUTO','mova_slot_candidates'),('AUTO','mova_slot_campaign_copy'),
      ('REVIEWS','mova_review_settings'),('REVIEWS','mova_review_requests'),('REVIEWS','mova_reviews'),('REVIEWS','mova_review_reports'),('REVIEWS','mova_google_reviews'),
      ('METRICS','mova_reports_daily_rollups'),('METRICS','mova_forecasts'),('METRICS','mova_profile_traffic_events'),
      ('AUDIT','mova_security_audit_events')
    ) as group_row(group_id, table_name)
    order by group_row.group_id, group_row.table_name
  loop
    if has_table_privilege(current_user, format('public.%I', table_row.table_name), 'SELECT') then
      execute format('select count(*) from public.%I where artist_business_id = $1', table_row.table_name)
        into visible_rows using p_business_id;
      if has_table_privilege(current_user, format('public.%I', table_row.table_name), 'UPDATE') then
        select column_name into changed_column from information_schema.columns
          where table_schema='public' and table_name=table_row.table_name and column_name in ('updated_at','id')
          order by case column_name when 'updated_at' then 0 else 1 end limit 1;
        if changed_column is not null then
          execute format('update public.%I set %I = %I where artist_business_id = $1', table_row.table_name, changed_column, changed_column)
            using p_business_id;
          get diagnostics updated_rows = row_count;
        else
          updated_rows := 0;
        end if;
      else updated_rows := 0;
      end if;
      if has_table_privilege(current_user, format('public.%I', table_row.table_name), 'DELETE') then
        execute format('delete from public.%I where artist_business_id = $1', table_row.table_name)
          using p_business_id;
        get diagnostics deleted_rows = row_count;
      else deleted_rows := 0;
      end if;
    else
      visible_rows := 0; updated_rows := 0; deleted_rows := 0;
    end if;
    return query select ok(visible_rows = 0 and updated_rows = 0 and deleted_rows = 0,
      format('TC-RLS-%s-%s: %s has no visible tenant rows and adversary cannot update/delete them', table_row.group_id, p_case, table_row.table_name));
  end loop;
end;
$customer_adversary$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4444444-4444-4444-8444-444444444451', true);
select * from public.mova_test_customer_adversary('SAMECLIENT', 'f4444444-4444-4444-8444-444444444441');
select set_config('request.jwt.claim.sub', 'f4444444-4444-4444-8444-444444444452', true);
select * from public.mova_test_customer_adversary('OTHERCLIENT', 'f4444444-4444-4444-8444-444444444441');

-- An expired guest/claim/card credential cannot authenticate as a tenant member.
-- At the SQL boundary it is therefore checked under anon; token-specific expiry
-- remains enforced by the corresponding Edge Function before service-role reads.
reset role;
set local role anon;
select * from public.mova_test_customer_adversary('EXPTOKEN', 'f4444444-4444-4444-8444-444444444441');

reset role;
select * from finish();
rollback;
