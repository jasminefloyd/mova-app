# Phase 6 production rollout commands

Status: **production rollout complete for the authorized database, function, Auth-hook, and web release steps as of 2026-11-10.** The eight missing migrations (0060, 0061, 0071, 0073, 0076, 0078, 0080, 0081) were applied individually through the Supabase Management API and returned HTTP 200. Earlier Phase 6 migrations 0066–0070, 0072, 0074–0077 were already present in production history. Migration 0077's canonical repository version `20261109051000` is recorded in history. No database backup was made, per the owner's instruction. The Before User Created hook is disabled. The 11 required functions were deployed, `guides-public` with `--no-verify-jwt`; retired functions `waitlist-signup` and `waitlist-admin` were deleted. Existing core dispatch, worker, admin, and public-site secrets were present. Typecheck, lint, unit tests, locale validation, and the production build passed locally. Remaining work is limited to external/owner-dependent setup: approved Google and Unsplash credentials and token key are absent, so their live-provider settings and automatic listing push remain disabled; admin-host DNS and preview rewrite verification are not recorded as complete. Do not run `supabase db push` or `supabase migration up` against production because its history contains migrations not present in this repository.

## Apply migrations one at a time

Use a Supabase Management API token scoped for database migrations, the production project ref, and `jq`. The migration endpoint runs each SQL migration and records it in Supabase migration history. Apply one file per request, check the response, and stop at the first error. The API endpoint and payload are documented in the [Supabase Management API migration reference](https://supabase.com/docs/reference/api/v1-apply-a-migration).

```sh
: "${SUPABASE_ACCESS_TOKEN:?Set a scoped Supabase Management API token}"
: "${SUPABASE_PROJECT_REF:?Set the production project ref}"

apply_migration() {
  migration_file="$1"
  filename="${migration_file##*/}"
  migration_name="${filename#*_}"
  migration_name="${migration_name%.sql}"
  jq -n --arg name "$migration_name" --rawfile query "$migration_file" '{name: $name, query: $query}' \
    | curl --fail-with-body --silent --show-error \
        --request POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/migrations" \
        --header "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
        --header 'Content-Type: application/json' \
        --data-binary @-
}
```

Apply the migration files below in order, one command at a time, reviewing each response before continuing. Version 0079 is unused. The latest repo-only follow-up migrations are 0080 and 0081.

```sh
apply_migration supabase/migrations/20261109010000_mova_0060_open_signup.sql
apply_migration supabase/migrations/20261109011000_mova_0061_retire_waitlist.sql
apply_migration supabase/migrations/20261109030000_mova_0066_admin_foundation.sql
apply_migration supabase/migrations/20261109031000_mova_0067_blog_posts.sql
apply_migration supabase/migrations/20261109032000_mova_0068_blog_admin_functions.sql
apply_migration supabase/migrations/20261109033000_mova_0069_admin_reads.sql
apply_migration supabase/migrations/20261109034000_mova_0070_admin_operations.sql
apply_migration supabase/migrations/20261109035000_mova_0071_admin_health.sql
apply_migration supabase/migrations/20261109040000_mova_0072_google_connection.sql
apply_migration supabase/migrations/20261109041000_mova_0073_google_listing_sync.sql
apply_migration supabase/migrations/20261109042000_mova_0074_google_review_replies.sql
apply_migration supabase/migrations/20261109043000_mova_0075_profile_unsplash_cover.sql
apply_migration supabase/migrations/20261109050000_mova_0076_home_studio_location_type.sql
apply_migration supabase/migrations/20261109051000_mova_0077_block_time_label.sql
apply_migration supabase/migrations/20261109052000_mova_0078_artist_appointment_create.sql
apply_migration supabase/migrations/20261109053000_mova_0080_artist_appointment_lead_time.sql
apply_migration supabase/migrations/20261109054000_mova_0081_admin_suspend_stylist.sql
```

## Deploy and remove Edge Functions

Deploy `guides-public` without JWT verification because it serves public guide pages. Deploy the remaining functions with the verification settings in `supabase/config.toml`.

```sh
: "${SUPABASE_PROJECT_REF:?Set the production project ref}"

supabase functions deploy guides-public --no-verify-jwt --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy artist-appointment-create --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy profile-cover --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy google-business-sync --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy location-save --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy calendar-google-connect --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy calendar-google-callback --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy calendar-sync-run --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy google-reviews-sync --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy review-management --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy job-worker --project-ref "$SUPABASE_PROJECT_REF"
supabase functions delete waitlist-signup --project-ref "$SUPABASE_PROJECT_REF"
supabase functions delete waitlist-admin --project-ref "$SUPABASE_PROJECT_REF"
```

Set or rotate function secrets separately using the platform's approved secret store. Do not place values in this runbook, source control, or shell history. Core Phase 6 function secrets are already present. Google OAuth credentials, the provider-token encryption key, and an Unsplash access key are not configured; keep those live-provider settings disabled until the owner supplies approved credentials. Keep all listing auto-push cron schedules off until approval. The Before User Created hook is disabled.

## Web deployment

The Vercel production site was already serving the prior `main` commit before this rollout. Release the current website changes only after committing them and confirming the database and function steps above are complete. Confirm the admin-host rewrite on preview before adding its production DNS record; that DNS/rewrite work remains an ops follow-up.
