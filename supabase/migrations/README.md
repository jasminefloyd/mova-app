# Migration order (spec §4.5)

1. `0001_extensions_and_helpers.sql`
2. `0002_tenancy_identity.sql`
3. `0003_artist_profiles_onboarding.sql`
4. `0004_services_deposits_portfolio.sql`
5. `0005_locations_policies_availability.sql`
6. `0006_clients_consents_import.sql`
7. `0007_appointments_holds_events.sql`
8. `0008_notes_visits_media.sql`
9. `0009_payments_ledger_paylinks_webhooks.sql`
10. `0010_calendar_integrations.sql`
11. `0011_customer_identity_links_otp.sql`
12. `0012_wallet_passes_card_tokens.sql`
13. `0013_messaging_identities_templates_messages_suppressions.sql`
14. `0014_rebooking_predictions_opportunities_autopilot.sql`
15. `0015_slot_events_candidates_copy.sql`
16. `0016_concierge.sql`
17. `0017_reviews_requests.sql`
18. `0018_metrics_forecasts_traffic.sql`
19. `0019_plans_entitlements.sql`
20. `0020_outbox_jobs_audit_platform_events.sql`
21. `0021_acquisition_waitlist.sql`
22. `0022_rls_policies_all.sql`

The full RLS matrix test must pass at `0022`, whether policies are per-migration or collected there.
