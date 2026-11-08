# Migration history

Mova shares the configured Supabase project with other applications. The remote project already had 83 migration records before Mova's schema was applied. Mova migrations were applied through the Supabase Management API using `mova_`-prefixed migration names. The production migration history was read back on 2026-11-07; it contains the Mova records listed below, alongside unrelated application records.

The applied Mova remote migration records are mirrored by these local timestamped files so Supabase CLI migration-history checks recognize them. Versions 0030 and 0031 were applied on 2026-11-07 after explicit product-owner approval. On 2026-11-08, 0033, 0035, 0036, and 0037 were applied transactionally through the Management API SQL path after explicit owner approval; matching history rows were written in the same transaction. Versions 0032 and 0034 remain unapplied. The CLI `db push` command cannot reconcile the 83 unrelated remote records that have no corresponding local migration files.

| Remote version | Remote name | Local file |
|---|---|---|
| `20261106011748` | `mova_0001_helpers` | `20261106011748_mova_0001_helpers.sql` |
| `20261106011827` | `mova_0002_tenancy_identity` | `20261106011827_mova_0002_tenancy_identity.sql` |
| `20261106011916` | `mova_0003_artist_profiles_onboarding` | `20261106011916_mova_0003_artist_profiles_onboarding.sql` |
| `20261106011941` | `mova_0004_services_portfolio` | `20261106011941_mova_0004_services_portfolio.sql` |
| `20261106011943` | `mova_0005_locations_policies_availability` | `20261106011943_mova_0005_locations_policies_availability.sql` |
| `20261106011945` | `mova_0007_appointments_holds_events` | `20261106011945_mova_0007_appointments_holds_events.sql` |
| `20261106022127` | `mova_0006_clients_consents_import` | `20261106022127_mova_0006_clients_consents_import.sql` |
| `20261106022138` | `mova_0008_client_notes_visits_media` | `20261106022138_mova_0008_client_notes_visits_media.sql` |
| `20261106054028` | `mova_0008a_booking_request_options` | `20261106054028_mova_0008a_booking_request_options.sql` |
| `20261106120000` | `mova_0009_payments_ledger` | `20261106120000_mova_0009_payments_ledger.sql` |
| `20261106130000` | `mova_0010_calendar_integrations` | `20261106130000_mova_0010_calendar_integrations.sql` |
| `20261106140000` | `mova_0011_customer_identity` | `20261106140000_mova_0011_customer_identity.sql` |
| `20261106140100` | `mova_0012_wallet_passes_qr` | `20261106140100_mova_0012_wallet_passes_qr.sql` |
| `20261106150000` | `mova_0013_messaging` | `20261106150000_mova_0013_messaging.sql` |
| `20261106160000` | `mova_0014_rebooking_autopilot` | `20261106160000_mova_0014_rebooking_autopilot.sql` |
| `20261106170000` | `mova_0015_slot_campaigns` | `20261106170000_mova_0015_slot_campaigns.sql` |
| `20261106180000` | `mova_0018_forecasts` | `20261106180000_mova_0018_forecasts.sql` |
| `20261106190000` | `mova_0016_concierge` | `20261106190000_mova_0016_concierge.sql` |
| `20261106210000` | `mova_0021_acquisition_waitlist` | `20261106210000_mova_0021_acquisition_waitlist.sql` |
| `20261107000000` | `mova_0023_sequential_display_ids` | `20261107000000_mova_0023_sequential_display_ids.sql` |
| `20261107174244` | `mova_0024_reports_reviews` | `20261107174244_mova_0024_reports_reviews.sql` |
| `20261107174339` | `mova_0025_plans_entitlements` | `20261107174339_mova_0025_plans_entitlements.sql` |
| `20261107174340` | `mova_0026_privacy_ops` | `20261107174340_mova_0026_privacy_ops.sql` |
| `20261107174712` | `mova_0027_zelle_hidden` | `20261107174712_mova_0027_zelle_hidden.sql` |
| `20261107174713` | `mova_early_access_invites` | `20261107174713_mova_early_access_invites.sql` |
| `20261107180456` | `mova_0028_reports_status_qualification` | `20261107180456_mova_0028_reports_status_qualification.sql` |
| `20261107180652` | `mova_0029_reports_interval_helper_arity` | `20261107180652_mova_0029_reports_interval_helper_arity.sql` |
| `20261107180730` | `mova_0030_messages_web_chat` | `20261107180730_mova_0030_messages_web_chat.sql` |
| `20261107195000` | `mova_0031_block_deposit_bookings_until_checkout` | `20261107195000_mova_0031_block_deposit_bookings_until_checkout.sql` |
| `20261107200000` | `mova_0032_revoke_anon_tenant_select` | `20261107200000_mova_0032_revoke_anon_tenant_select.sql` (local only; not applied remotely) |
| `20261107210000` | `mova_0033_booking_consents` | `20261107210000_mova_0033_booking_consents.sql` (applied remotely 2026-11-08) |
| `20261107220000` | `mova_0034_durable_jobs` | `20261107220000_mova_0034_durable_jobs.sql` (local only; not applied remotely) |
| `20261107230000` | `mova_0035_stripe_test_checkout` | `20261107230000_mova_0035_stripe_test_checkout.sql` (applied remotely 2026-11-08; test-mode-only schema, not release-ready) |
| `20261107233000` | `mova_0036_quote_appointment_link` | `20261107233000_mova_0036_quote_appointment_link.sql` (applied remotely 2026-11-08) |
| `20261108000000` | `mova_0037_multi_service_appointments` | `20261108000000_mova_0037_multi_service_appointments.sql` (applied remotely 2026-11-08) |
| `20261108010000` | `mova_0038_profile_handle_fix` | `20261108010000_mova_0038_profile_handle_fix.sql` (local only; see `docs/runbooks/production-catch-up.md`) |
| `20261108011000` | `mova_0039_deposit_bookings_flag` | `20261108011000_mova_0039_deposit_bookings_flag.sql` (local only) |
| `20261108012000` | `mova_0040_revoke_unused_write_grants` | `20261108012000_mova_0040_revoke_unused_write_grants.sql` (local only) |
| `20261108020000` | `mova_0041_support_messages` | `20261108020000_mova_0041_support_messages.sql` (local only) |
| `20261108030000` | `mova_0042_sms_policy` | `20261108030000_mova_0042_sms_policy.sql` (local only) |
| `20261108031000` | `mova_0043_appointment_emails` | `20261108031000_mova_0043_appointment_emails.sql` (local only) |
| `20261108032000` | `mova_0044_payment_fee_rate` | `20261108032000_mova_0044_payment_fee_rate.sql` (local only) |

The P06 `0007` migration does not reference a `mova_clients` table. P07 migrations were applied in dependency order. The Management API assigned the returned versions above, which are mirrored locally.

The migrations above install no PostgreSQL extensions. Every Mova-created table, function, index, constraint, trigger, policy, and storage bucket uses the `mova_` prefix. Earlier remote catalog checks verified RLS on Mova tables. The 2026-11-07 post-apply catalog check verified the 0030 channel constraint accepts `web_chat`, and 0031 replaced the expected `jsonb` booking RPC while preserving `service_role`-only execute privileges. This catalog inspection does not replace pgTAP or end-to-end behavior testing.

Migrations 0032 and 0034 remain unapplied; 0033, 0035, 0036, and 0037 were history-verified on 2026-11-08. The 0037 catalog/backfill checks and a rollback-scoped two-service booking runtime assertion passed; its pgTAP file is present but was not run because a local PostgreSQL/Supabase test runtime is unavailable. Application-level database behavior is not uniformly validated: tenant-isolation, concurrency, Edge HTTP, and provider integration tests remain incomplete. P09 depends on P08 migration 0009; P10 depends on P08 and P06; P11–P13 also depend on earlier phases. The forecast migration uses version label `0018` for the P12 forecast slice; migrations 0019–0020 and 0022 remain reserved for the roadmap in `docs/product/ENGINEERING_SPEC.md` §4.5. Production waitlist submissions remain blocked by open A-14 until privacy, anti-bot, and domain checks are verified. P07, 0021, and 0023 schema/history application still require behavioral integration verification.

As of 2026-11-08 every migration through 0041 passes the full pgTAP suite locally (`pnpm db:test`: 26/26 files, 720/720 assertions, with and without the seed). Migrations 0032, 0034 and 0038–0044 are not in production; `docs/runbooks/production-catch-up.md` lists the order, checks and rollback, and needs owner approval (O14) before anything is applied.
