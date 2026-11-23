# Mova Beauty database migration scope

**Status** · Planning draft, 2026-11-21. Repository baseline `875aed0`. Production catalog, row counts, object counts and provider configuration still require source discovery.

**Companion** · [Dedicated destination specification](database-migration-destination.md)

## 1. Extraction boundary

Move the Mova Beauty application out of the shared Supabase project into a dedicated Supabase project and PostgreSQL database. Preserve Mova's internal account boundaries: each stylist business remains isolated through membership checks, row-level security (RLS) and business-scoped Storage policies. Customer identities, stylist client lists and platform operator roles retain their distinct authorization rules. The recommended scope includes dedicated Auth, Storage and Edge Functions so Mova can operate independently of the shared project's endpoints, credentials and managed services. Confirm this scope before selecting an extraction method.

The repository uses `public.mova_*` for application objects and `mova_*` bucket IDs. Treat these as **candidate inventory selectors**. Establish ownership from migrations, application references, dependency graphs and live catalog evidence before including an object or row. The historical runbook records 83 unrelated migrations in the shared project, as of that rollout. A whole-project restore would carry unrelated records into the target. Use an allowlisted logical extraction with explicit filters for shared managed data. [Production catch-up runbook](runbooks/production-catch-up.md) · [Supabase whole-project restore coverage](https://supabase.com/docs/guides/platform/clone-project)

| Boundary | Proposed disposition |
| --- | --- |
| Mova business records | Move the approved Mova businesses and their complete relational dependencies. Preserve primary keys, foreign keys, lifecycle states, timestamps, display numbers, public handles, currency and timezone data, and business authorization. |
| Mova-wide records | Include approved catalog, flags, fee policy, handles, editorial data, admin and compliance records that lack a business ID. Review each global table independently, including suppression records and any provider-wide deduplication state. |
| Shared project services | Extract only approved Mova identities, assets, custom objects and historical records through explicit allowlists. Recreate required project-specific settings on the destination. |
| Third-party systems | Preserve Mova provider IDs, states and relationships required for continuity. The external accounts and their independent histories stay with the providers. Record callback, credentials, account ownership and any required reconnect action. |
| Other products and development fixtures | Exclude other products' tables, roles, users, objects, keys, logs, schedules and migration history. Exclude local/CI seeds. Classify Rooted Beauty and any other hosted demo business explicitly; document any public demo dependency and isolate synthetic activity from real provider traffic. |

## 2. Database objects and row disposition

The repository contains 95 SQL migration files through 0104, with 114 declared application tables, two declared views and three explicit display-number sequences. These are repository counts. The appendix lists the declared tables as a starting point for the approved export manifest. Capture the effective catalog from production before freezing the scope. Include relevant indexes, constraints, defaults, grants, RLS policies, policies on managed schemas, triggers, function signatures and bodies, function owners and search paths, ownership, identity sequences, publications and extension dependencies where present. Preserve effective definitions, including forward fixes and live-only Mova objects once reviewed. Account for the documented 0024 drift and corrective migrations 0028/0029, and match by logical migration plus reviewed SQL because some deployed history versions differ from the filenames. [Change requests](engineering/CHANGE_REQUESTS.md) · [Phase log](engineering/PHASE_STATUS.md) · [Migration sources](../supabase/migrations/)

| Domain | What belongs in scope |
| --- | --- |
| Businesses and storefront | Business and membership links, private account names, onboarding, profiles and reserved handles, published and draft content, services and location assignments, portfolio and linked services, locations, hours, exceptions, policies and blocks. Include suspended and inactive state, including the references that make historical bookings intelligible. |
| Bookings and calendar | Appointments, per-appointment service snapshots, alternate/reschedule state, holds, appointment events and relevant outbox state. Preserve pending and future scheduling state, manage-link hashes, idempotency keys and historic fee/location context. For Google Calendar include settings, events or an agreed rebuild, feed token hashes, and an explicit decision on legacy and current encrypted connection tables. |
| Client data and privacy | Stylist client lists, import history subject to retention, contacts, consent provenance and withdrawals, notes and history, visit notes and linked media, Mova-wide customer accounts and links, privacy requests and security audit history. Preserve deletions and suppressions according to the approved policy and prevent revival from older snapshots. |
| Financial and billing | Stripe connection IDs, payment settings, payments, ledger, fees and overrides, refunds, paylinks, provider webhook deduplication, plan catalog and assignment, billing subscriptions and usage. Compare money by currency, amount in minor units, collector and state. Keep historical fee amounts and rates, Stripe mode, and external IDs. Never recreate customers, subscriptions, charges or refunds simply to rebuild local links. |
| Communications and growth | Sending identities, templates, messages, suppression records, inbox and notification preferences, approved push subscriptions, marketing campaigns/channels/deliveries, autopilot and seat-filler state, Concierge conversations/handoffs/quotes, forecasts and PricePilot evidence/plans/metering. Preserve consent, spend and usage counters that still apply in the current window. |
| Reputation, content and operations | Reviews, requests and reports, Google review/listing state, report inputs and rollups, guides and editorial records, admin grants and activity, support messages and replies, system logs, platform switches and feature overrides. Include only approved Mova records and applicable retention windows. |
| Legacy acquisition | Waitlist signup and early-access invite tables were retained after retirement of the flows. Classify the records for retained history or separately approved archive. Preserve open signup and the retired flow's disabled state. [Retired early access runbook](runbooks/early-access-invites.md) |
| Derived or transient state | Decide table by table. Reports, forecasts and external calendar snapshots are candidates to rebuild only if underlying data, time windows and expected output match. OAuth states and active Auth challenges are candidates to expire with a restart path. Rate limits, log maintenance and alert claims need an explicit transfer/reset decision. Queue and webhook state require the reconciliation below. |

### Row selection rules

| Ownership evidence | How to scope rows |
| --- | --- |
| Direct business ownership | Start from approved `mova_artist_businesses.id` values. Select business-scoped records by `artist_business_id`. Follow the full composite key where an FK includes a business ID and another identifier. Keep inactive owners and location or service dependencies needed by retained history. |
| Parent or user ownership | Follow approved parent IDs or confirmed Mova Auth UUIDs when no business column exists. Include only the customer/account links within the approved business set. A shared contact, linked identity or actor reference can require a parent record without bringing along all its other activity. |
| Product-wide configuration | Approve Mova-wide rows in `mova_plan_catalog`, `mova_platform_fee_versions`, `mova_platform_switches`, `mova_reserved_handles`, `mova_price_pilot_settings` and comparable tables individually or through a recorded whole-table rule. Preserve the effective combination of seeded defaults, production overrides, provider settings and feature switches. |
| Nullable business ownership or external IDs | Use provider account/mode and event IDs, verified actor IDs, object and request IDs or approved event provenance. Apply explicit rules to `mova_webhook_events`, `mova_suppressions`, `mova_privacy_requests`, `mova_security_audit_events`, `mova_system_logs`, `mova_outbox_events` and nullable job ownership. Review provider event payloads and JSON references separately. A null business ID can represent product-wide state, a deleted reference, or an unresolved record. |
| Shared dependencies and ambiguous records | Record each foreign key or runtime dependency that crosses the boundary. Decide whether to include a Mova-owned projection, rebuild approved reference data, or stop and resolve the dependency with the source owner. Hold ambiguous rows in a restricted exception list until the disposition is approved. Record the business impact if a required dependency cannot move. |

Retain applicable Mova-wide email and SMS suppressions with a null `artist_business_id`. Current send gates consult those rows across businesses. Require a disposition before enabling the affected sends. The admin log function reads managed `auth.audit_log_entries` from the project alongside Mova application logs. Preserve target-generated Auth audit visibility and make a separate retention decision for verifiably Mova historical Auth events. Raw shared Auth logs stay at the source. [SMS policy](../supabase/migrations/20261108030000_mova_0042_sms_policy.sql) · [Email suppression gate](../supabase/migrations/20261108031000_mova_0043_appointment_emails.sql) · [Admin logging migration](../supabase/migrations/20261113230000_mova_0085_system_logs.sql)

Preserve `business_number`, `client_number` and `appointment_number` with the high-water marks of `mova_business_id_seq`, `mova_client_id_seq` and `mova_appointment_id_seq`. Verify every discovered sequence, including generated identity sequences such as the one for `mova_system_logs.id`. Sequence advancement on the destination must clear both the highest imported value and any approved reserved or issued numbers, including gaps. Recreate `mova_blog_live_posts` and `mova_background_job_dead_letters` from effective definitions, with equivalent grants and access behavior.

### In-flight work and token continuity

- Classify outbox events, jobs, dead-letter alerts, reminders, payment/refund/fee work, marketing deliveries and provider events by state. Keep terminal history and deduplication where needed. Reconcile pending and leased work with the provider, respecting existing idempotency keys. A source-side effect may have succeeded before its database acknowledgment.
- Build a list of still-valid public booking, ICS feed, review, paylink, slot-claim, wallet and client-card URLs. Record whether each uses the Mova domain, a direct source-project URL or a provider callback. Preserve hashes, identifiers, expiry and revocation state where continuity is required. Approve reissue or a time-bounded routing arrangement for direct source URLs before cutover.
- Record the treatment of sends already queued by a provider, subscription and refund updates, webhook retries, and calendar sync cursors. Establish which project accepts each event stream through transition. Retain a reconciliation cursor or timestamp that can account for delayed and repeated events.
- Capture a consistent snapshot across related rows and an explicit Storage/provider watermark. The later cutover plan must account for inserts, updates, deletes and object changes since the initial copy. Shared-project writers unrelated to Mova remain outside the migration boundary.

## 3. Auth, identity and application secrets

- Build a reviewed set of `auth.users` IDs from Mova memberships, customer accounts, approved platform admins and other in-scope user references. Scan actual foreign keys and indirect references such as actor IDs in audit and job payloads. Include confirmed Mova-only signups that did not finish onboarding using reviewed provenance. Investigate ambiguous users and people with accounts used by both products. Email domain, metadata, or mere project membership is insufficient evidence of a Mova account.
- Review `mova_account_names` with special care. Migration 0098 installs an `auth.users` insert trigger and backfills from Auth metadata with first and last names. In a shared project, matching metadata can produce a `mova_account_names` row for a person outside Mova. Use independently established Mova ownership before including that row or using it to select a user. [Migration 0098](../supabase/migrations/20261116120000_mova_0098_stylist_account_names.sql)
- Preserve approved Auth UUIDs and the identity records, verified contacts and vetted metadata needed for sign-in and referential integrity. Scope any account used by both products to its approved Mova identity data and leave its source account available to the other product. Resolve conflicts and historical actor references explicitly before import. Approve handling of metadata and any legacy password hashes within the supported, rehearsed transfer mechanism. Confirm which MFA factors can be transferred safely or which admins must re-enroll.
- Recommend fresh destination signing material, new sessions and a planned sign-in prompt. Treat source refresh tokens, sessions, pending OTPs, sign-in challenges and unrelated audit data as excluded. Plan customer profile rollout separately under A-18. The latest code uses email codes in stylist and admin flows, whereas older operations notes describe links or passwords. Capture current hosted settings and validate against the selected deployed code. [Auth migration guidance](https://supabase.com/kb/troubleshooting/migrating-auth-users-between-projects) · [Decision log](engineering/DECISION_LOG.md)
- Confirm access to the Mova door-code and sensitive-notes keys, Google/provider token encryption key and client-card HMAC key. Choose approved continuity or a rehearsed re-encryption/reissue plan. Verify retained ciphertext against the destination key strategy with authorized samples and without exposing plaintext in the evidence. Capture secret names and custody references only in the migration manifest. Shared project signing keys and unrelated credentials stay outside the extraction.

## 4. Storage and externally hosted assets

The repository declares four private buckets. Approve each bucket and exact object paths. Verify business ownership, path prefixes and references, handle orphaned objects or incomplete uploads explicitly, and preserve object bytes, names, content types, relevant metadata and authorization-dependent ownership. SQL bucket/object metadata is insufficient to restore the file payloads. [Supabase restore coverage](https://supabase.com/docs/guides/platform/clone-project)

| Bucket | Objects to account for | Checked-in limit and allowed formats |
| --- | --- | --- |
| `mova_profile_photos` | Profile photos, uploaded covers and generated variants referenced by `mova_artist_profiles`. | 10 MiB · JPEG, PNG, WebP, HEIC, HEIF |
| `mova_portfolio_media` | Portfolio images and generated variants referenced by `mova_portfolio_items`. | 10 MiB · JPEG, PNG, WebP, HEIC, HEIF |
| `mova_visit_private` | Private visit attachments referenced by `mova_visit_note_media`. | 10 MiB · JPEG, PNG, WebP |
| `mova_support_screenshots` | Screenshots referenced by approved `mova_support_messages`. | 5 MiB · JPEG, PNG, WebP |

Find any live-only Mova buckets or assets stored in shared buckets or third-party services. Keep source project signed URLs out of persistent destination configuration and regenerate them from destination paths. For external URLs such as Unsplash covers and guide images, inventory dependencies and verify ownership, attribution and rendering. Use object counts and bytes by bucket, per-object checksums or equivalent integrity evidence, and a reference-to-object match. Verify authorized reads and anonymous/cross-business denial for private objects.

## 5. Runtime dependencies to carry into destination planning

- **Edge and web:** pinned web build, Edge Functions and shared modules, browser and server project bindings, allowed origins, domains, PWA behavior, direct project URLs, hosting routes and proxies. Match live function status and versions to the selected source and feature gates. For every Mova write path, record how to fence source writes during cutover, including installed PWAs and older tabs, public guest booking links, direct REST/RPC clients, server routes, webhooks and schedulers. Verify that the fence leaves other products' writes available.
- **Schedulers:** Vercel job dispatch/worker, booking expiry, calendar sync and reports refresh. Inventory any remote database jobs, webhooks, queues or publication entries the repository cannot establish. Identify code with side effects on import, including onboarding welcome and notification/outbox triggers. [Background jobs](runbooks/background-jobs.md)
- **Providers:** Stripe Connect and billing, Resend/SMTP, Twilio, Google Calendar and Business Profile/reviews, hCaptcha, web push, Meta/Instagram, Wallet, Unsplash, and Concierge/PricePilot model and data services. Include configured endpoints, feature switches and modes; record current usage as a discovery item. The destination document maps these to configuration and validation requirements.

## 6. Source discovery deliverables and decisions

| Needed evidence | Acceptance |
| --- | --- |
| Project and release inventory | Identify the exact shared project and Mova web deployment, app hosts, last deployed Edge versions, migration history and catalog baseline. Record source snapshot timestamps and distinguish code, historical notes and live evidence. |
| Object and row manifest | For each object record its owner, dependencies, source migration or live definition, disposition, and reviewer. For each table give the exact selector or full-table justification, primary/composite key, data classification, source count at a named snapshot, expected target count, and exclusions by class. Record key-set reconciliation, any transformations, who approved each exception, and the method for capturing updates and deletions. Resolve foreign keys crossing the allowlist, managed-schema references, and ambiguous global data before approving export. |
| Auth and Storage manifests | Record approved IDs/paths in restricted artifacts, with provenance, association and exceptions. Reconcile expected user/identity relationships, Storage paths, bytes and integrity checks. Keep personal data, provider payloads and keys out of Git. |
| Provider and job inventory | List external account ownership/mode, callback URLs and owners, key source, queues/workers, states, retry behavior and enabled gates. Approve treatment of pending or stale work, direct URLs and any reconnect/re-enrollment. |
| Retention and rollback inputs | Confirm archive classes, owner-held data, privacy requests and retention holds; agree permitted capture, storage, rollback window, backup scope, and later removal from the shared source. A-08 remains open in the repository. [Retention policy notes](security/retention.md) |
| Approval | Product owner confirms boundary, demo/legacy decisions and continuity expectations. Database, Auth and provider operators review the scoped manifests. Production work proceeds under separately approved change scope. |

## Appendix · Repository-declared application tables

All tables below are in `public`. Grouping follows the migration that declares each table. Use the catalog and approved row rules above to finalize the manifest.

| Migration | Tables |
| --- | --- |
| [0002 tenancy identity](../supabase/migrations/20261106011827_mova_0002_tenancy_identity.sql) | `mova_artist_businesses`, `mova_artist_memberships` |
| [0003 artist profiles onboarding](../supabase/migrations/20261106011916_mova_0003_artist_profiles_onboarding.sql) | `mova_artist_profiles`, `mova_reserved_handles`, `mova_onboarding_progress` |
| [0004 services portfolio](../supabase/migrations/20261106011941_mova_0004_services_portfolio.sql) | `mova_services`, `mova_service_locations`, `mova_portfolio_items`, `mova_portfolio_service_links` |
| [0005 locations policies availability](../supabase/migrations/20261106011943_mova_0005_locations_policies_availability.sql) | `mova_locations`, `mova_location_hours`, `mova_location_exceptions`, `mova_location_policies`, `mova_availability_blocks` |
| [0007 appointments holds events](../supabase/migrations/20261106011945_mova_0007_appointments_holds_events.sql) | `mova_appointments`, `mova_booking_holds`, `mova_appointment_events`, `mova_outbox_events` |
| [0006 clients consents import](../supabase/migrations/20261106022127_mova_0006_clients_consents_import.sql) | `mova_clients`, `mova_client_consents`, `mova_client_import_batches` |
| [0008 client notes visits media](../supabase/migrations/20261106022138_mova_0008_client_notes_visits_media.sql) | `mova_client_notes`, `mova_client_note_history`, `mova_visit_notes`, `mova_visit_note_media` |
| [0009 payments ledger](../supabase/migrations/20261106120000_mova_0009_payments_ledger.sql) | `mova_platform_fee_versions`, `mova_payment_method_settings`, `mova_stripe_connections`, `mova_payments`, `mova_payment_ledger`, `mova_payment_refunds`, `mova_paylinks`, `mova_webhook_events` |
| [0010 calendar integrations](../supabase/migrations/20261106130000_mova_0010_calendar_integrations.sql) | `mova_google_calendar_connections`, `mova_calendar_sync_settings`, `mova_google_oauth_states`, `mova_external_calendar_events`, `mova_calendar_feed_tokens` |
| [0011 customer identity](../supabase/migrations/20261106140000_mova_0011_customer_identity.sql) | `mova_customer_accounts`, `mova_customer_contact_methods`, `mova_client_customer_links`, `mova_client_link_suggestions` |
| [0012 wallet passes qr](../supabase/migrations/20261106140100_mova_0012_wallet_passes_qr.sql) | `mova_client_card_tokens`, `mova_wallet_passes`, `mova_wallet_device_registrations`, `mova_artist_qr_scans` |
| [0013 messaging](../supabase/migrations/20261106150000_mova_0013_messaging.sql) | `mova_sending_identities`, `mova_message_templates`, `mova_messages`, `mova_suppressions`, `mova_notification_preferences`, `mova_notification_inbox`, `mova_push_subscriptions` |
| [0014 rebooking autopilot](../supabase/migrations/20261106160000_mova_0014_rebooking_autopilot.sql) | `mova_growth_opportunities`, `mova_autopilot_settings`, `mova_autopilot_decisions` |
| [0015 slot campaigns](../supabase/migrations/20261106170000_mova_0015_slot_campaigns.sql) | `mova_slot_events`, `mova_slot_candidates`, `mova_slot_campaign_copy`, `mova_social_share_events` |
| [0018 forecasts](../supabase/migrations/20261106180000_mova_0018_forecasts.sql) | `mova_forecasts` |
| [0016 concierge](../supabase/migrations/20261106190000_mova_0016_concierge.sql) | `mova_concierge_settings`, `mova_concierge_knowledge`, `mova_conversations`, `mova_concierge_turns`, `mova_handoffs`, `mova_quote_requests` |
| [0021 acquisition waitlist](../supabase/migrations/20261106210000_mova_0021_acquisition_waitlist.sql) | `mova_waitlist_signups` |
| [0024 reports reviews](../supabase/migrations/20261107174244_mova_0024_reports_reviews.sql) | `mova_profile_traffic_events`, `mova_reports_daily_rollups`, `mova_review_settings`, `mova_review_requests`, `mova_reviews`, `mova_review_reports`, `mova_google_reviews` |
| [0025 plans entitlements](../supabase/migrations/20261107174339_mova_0025_plans_entitlements.sql) | `mova_plan_catalog`, `mova_business_plan_assignments`, `mova_usage_meter_events` |
| [0026 privacy ops](../supabase/migrations/20261107174340_mova_0026_privacy_ops.sql) | `mova_privacy_requests`, `mova_security_audit_events` |
| [early access invites](../supabase/migrations/20261107174713_mova_early_access_invites.sql) | `mova_early_access_invites` |
| [0034 durable jobs](../supabase/migrations/20261107220000_mova_0034_durable_jobs.sql) | `mova_background_jobs`, `mova_background_job_alerts` |
| [0035 stripe test checkout](../supabase/migrations/20261107230000_mova_0035_stripe_test_checkout.sql) | `mova_stripe_oauth_states` |
| [0037 multi service appointments](../supabase/migrations/20261108000000_mova_0037_multi_service_appointments.sql) | `mova_appointment_services` |
| [0041 support messages](../supabase/migrations/20261108020000_mova_0041_support_messages.sql) | `mova_support_messages` |
| [0053 stylist feature defaults](../supabase/migrations/20261108043000_mova_0053_stylist_feature_defaults.sql) | `mova_feature_settings` |
| [0055 plans confirmed](../supabase/migrations/20261108045000_mova_0055_plans_confirmed.sql) | `mova_billing_subscriptions` |
| [0066 admin foundation](../supabase/migrations/20261109030000_mova_0066_admin_foundation.sql) | `mova_platform_admins`, `mova_admin_activity` |
| [0067 blog posts](../supabase/migrations/20261109031000_mova_0067_blog_posts.sql) | `mova_blog_categories`, `mova_blog_posts` |
| [0070 admin operations](../supabase/migrations/20261109034000_mova_0070_admin_operations.sql) | `mova_stylist_fee_overrides`, `mova_platform_switches`, `mova_support_replies` |
| [0072 google connection](../supabase/migrations/20261109040000_mova_0072_google_connection.sql) | `mova_google_connections` |
| [0073 google listing sync](../supabase/migrations/20261109041000_mova_0073_google_listing_sync.sql) | `mova_google_listing_settings`, `mova_google_listing_snapshots` |
| [0084 plan tiers feature flags](../supabase/migrations/20261113220000_mova_0084_plan_tiers_feature_flags.sql) | `mova_business_feature_overrides`, `mova_client_feature_overrides` |
| [0085 system logs](../supabase/migrations/20261113230000_mova_0085_system_logs.sql) | `mova_system_logs`, `mova_client_log_limits`, `mova_system_log_maintenance`, `mova_system_log_alert_claims` |
| [0086 price pilot](../supabase/migrations/20261113235000_mova_0086_price_pilot.sql) | `mova_price_pilot_sources`, `mova_price_pilot_observations` |
| [0087 marketing campaigns](../supabase/migrations/20261113235500_mova_0087_marketing_campaigns.sql) | `mova_marketing_campaigns`, `mova_marketing_campaign_channels`, `mova_marketing_deliveries` |
| [0091 price pilot plans metering](../supabase/migrations/20261113260000_mova_0091_price_pilot_plans_metering.sql) | `mova_price_pilot_settings`, `mova_price_plans`, `mova_price_pilot_usage` |
| [0098 stylist account names](../supabase/migrations/20261116120000_mova_0098_stylist_account_names.sql) | `mova_account_names` |
| [0102 pwa push notifications](../supabase/migrations/20261116190000_mova_0102_pwa_push_notifications.sql) | `mova_user_app_state` |
