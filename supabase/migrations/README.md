# Migration history

Mova shares the configured Supabase project with other applications. The remote project already had 83 migration records before Mova's schema was applied. Mova migrations were applied through the Supabase Management API using `mova_`-prefixed migration names.

The eight applied Mova remote migration records are mirrored by these local timestamped files so Supabase CLI migration-history checks recognize them. `20261106054028_mova_0008a_booking_request_options.sql` is a new local migration for optional alternate time, client note, and portfolio-look booking details and has not been applied remotely.

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
| `20261106054028` | `mova_0008a_booking_request_options` | `20261106054028_mova_0008a_booking_request_options.sql` (pending) |
| `20261106120000` | `mova_0009_payments_ledger` | `20261106120000_mova_0009_payments_ledger.sql` (pending; local only) |
| `20261106130000` | `mova_0010_calendar_integrations` | `20261106130000_mova_0010_calendar_integrations.sql` (pending; local only) |
| `20261106140000` | `mova_0011_customer_identity` | `20261106140000_mova_0011_customer_identity.sql` (pending; local only) |
| `20261106140100` | `mova_0012_wallet_passes_qr` | `20261106140100_mova_0012_wallet_passes_qr.sql` (pending; local only) |
| `20261106150000` | `mova_0013_messaging` | `20261106150000_mova_0013_messaging.sql` (pending; local only) |
| `20261106160000` | `mova_0014_rebooking_autopilot` | `20261106160000_mova_0014_rebooking_autopilot.sql` (pending; local only) |
| `20261106170000` | `mova_0015_slot_campaigns` | `20261106170000_mova_0015_slot_campaigns.sql` (pending; local only) |
| `20261106180000` | `mova_0018_forecasts` | `20261106180000_mova_0018_forecasts.sql` (pending; local only) |
| `20261106190000` | `mova_0016_concierge` | `20261106190000_mova_0016_concierge.sql` (pending; local only) |
| `20261106210000` | `mova_0021_acquisition_waitlist` | `20261106210000_mova_0021_acquisition_waitlist.sql` (pending; local only) |
| `20261107000000` | `mova_0023_sequential_display_ids` | `20261107000000_mova_0023_sequential_display_ids.sql` (pending; local only) |

The P06 `0007` migration does not reference a `mova_clients` table. P07 migrations were applied in dependency order. The Management API assigned the returned versions above, which are mirrored locally.

The migrations above install no PostgreSQL extensions. Every Mova-created table, function, index, constraint, trigger, policy, and storage bucket uses the `mova_` prefix. The current remote Mova catalog was checked after application; all Mova tables have RLS enabled.

Migrations 0009–0016, 0018, 0021, and 0023 have not been applied or validated. P09 depends on P08 migration 0009; P10 depends on P08 and P06; P11–P13 also depend on earlier phases. Run all pending migrations in version order and the corresponding pgTAP, tenant-isolation, and provider integration tests before phase acceptance. The forecast migration uses version label `0018` for the P12 forecast slice; migrations 0019–0020 and 0022 remain reserved for the roadmap in `docs/product/ENGINEERING_SPEC.md` §4.5. Migration 0021 adds the API-only waitlist table and registration function; production waitlist submissions remain blocked by open A-14 until privacy, anti-bot, and domain checks are verified. Migration 0023 adds sequential display identifiers; Rooted Beauty is ordered first for business backfill and receives BID 1 if present when the migration is applied. P07's database objects and migration history are verified remotely; migrations 0021 and 0023 still require database integration verification.
