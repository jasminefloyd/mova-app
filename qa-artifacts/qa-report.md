# Mova local QA report

**Run date** November 22, 2026 ET

**Revision** `56ec1a1` plus the QA fixes in the working tree at test time listed in [defects.md](defects.md).

**Release assessment** Hold. Four supplied cases still diverge from the workbook, the mock-backed browser suite has 16 failures, and several release-critical paths have incomplete end-to-end evidence, including payment, provider delivery, and Storage.

## Coverage

The five primary CSVs match the corresponding workbook rows for IDs, steps and expected outcomes. The 12 workbook tabs also include prior runs, dropdown data, one additional calendar scenario and two historical technical checks. The 102 primary cases plus CAL-01b give 103 product cases. The two technical checks, TESTS and BUILD, passed as recorded in the workbook. [Case inventory](evidence/supplied-cases.json), [additional workbook rows](evidence/workbook-additional-checks.json)

| Product outcome | Count |
| --- | ---: |
| PASS | 31 |
| FAIL | 4 |
| BLOCKED | 63 |
| NOT APPLICABLE | 5 |
| **Total** | **103** |

Every product ID has a browser or local-service attempt and an entry in [test-results.md](test-results.md). A blocked result includes provider constraints or an incomplete assertion, fixture or scenario. A successful route load, code review, mock success, or successful subset does not establish the full case. The password variants ONB-01 through ONB-05 are inapplicable to the current stylist flow. The run exercised account creation and sign-in using local six-digit OTP delivery.

**Open product failures** ONB-09 advances to Where you work after skipping a photo, while the workbook says Services. ONB-17 signs a verified client into `/me` but omits their matching upcoming guest appointment. ONB-19 linked the correct past booking, but the profile hid it after the claim. BKG-18 opened the correct stylist with a different service. The workbook and the engineering spec differ on the history this screen should display. [Defects and reproduction](defects.md)

**Verified fixes** Client/stylist sign-in routing, guest continuation, early/late and overlapping calendar events, Admin Auth log projection, advertised booking buffers, preserving booking requests in Home when a supplemental feed fails, and editing existing review replies. Original failure and retest evidence is linked in [defects.md](defects.md).

**Remaining execution gaps** Stripe sandbox, signed webhook and Connect access prevented actual subscription and card payment flows. Local Auth email was available. Application email, SMS, push, and Storage were unavailable. The team still needs a configured local delivery and upload path and additional execution for unresolved scenarios in onboarding, availability, reviews, campaign, and AI workflows. Some scenarios reached the screen or wrote state, then stopped at an assertion or fixture. These rows are labeled BLOCKED individually and are part of the remaining QA work. [Case results](test-results.md), [payment log](payment-test-log.md)

## Environment and checks

The Supabase CLI startup was attempted. Podman’s local socket did not become usable, so execution used a disposable native stack. Chromium connected to Vite at `127.0.0.1:4175` and a loopback Deno gateway at `127.0.0.1:55421`. That gateway served the checked-in Edge Function handlers and forwarded to PostgREST 16.6 and GoTrue 2.197.0 on ports 55426 and 55425. PostgreSQL 18.7 ran on a local Unix socket at port 55432 with an isolated database, migrations, and Rooted Beauty seed records. A local SMTP sink on 55424 captured Auth email. Chromium used synthetic accounts with 390 px and 1280 px widths where required. The native gateway did not include hosted Supabase’s Storage or gateway enforcement. Outbound production providers and production Stripe configuration were excluded. Some normally gated UI switches were enabled locally for the supplied feature scenarios.

| Check | Result |
| --- | --- |
| Optimized build and locale validation | PASS. [Build log](evidence/build.txt) |
| TypeScript type check | PASS. [Type log](evidence/typecheck.txt) |
| Vitest and static Node checks | 382 Vitest and 4 Node tests passed. [Unit log](evidence/unit.txt) |
| Database pgTAP | 67 of 67 files and 1,206 of 1,206 assertions passed. [SQL log](evidence/database.txt) |
| Edge Function checks | 73 checked and 21 Deno tests passed. [Edge log](evidence/edge.txt) |
| Mock-backed Playwright | 96 passed, 16 failed. Failures include stale password and magic-link tests and unresolved onboarding, profile, scheduling, and guide assertions. [Failure inventory](evidence/playwright.txt) |
| Playwright visual and accessibility suite | 4 passed. [Visual log](evidence/visual.txt) |

## Reproduce on the QA workstation

Run from the project root. The pointer files refer to this run’s disposable loopback processes and temporary local credentials. The settings file is deliberately excluded from the artifacts. The full browser run writes temporary fixtures. Use a clean disposable database or reset the QA fixtures between complete reruns.

```sh
cd /Users/jasminefloyd/Desktop/Vibes/Projects/mova-app
qa_native=$(cat /tmp/mova-qa-native-pointer)
source "$qa_native/settings.sh"

corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:e2e -- --workers=5 --timeout=12000
corepack pnpm test:visual
PGHOST="$(cat /tmp/mova-qa-postgres-pointer)" PGPORT=55432 PGUSER=postgres corepack pnpm db:test
DENO=/tmp/mova-qa-deno corepack pnpm fn:check
```

The live local stack can be exercised with a new run ID or with explicit case IDs to reproduce a subset.

```sh
QA_RUN_ID="rerun-$(date +%s)" node qa-artifacts/run-local-qa.mjs
QA_RUN_ID="booking-$(date +%s)" node qa-artifacts/run-local-qa.mjs BKG-02 BKG-04 BKG-13
QA_RUN_ID="identity-$(date +%s)" node qa-artifacts/run-local-qa.mjs ONB-09 ONB-16 ONB-17 ONB-18 ONB-19 BKG-18
QA_RUN_ID="ledger-$(date +%s)" node qa-artifacts/run-local-qa.mjs CAL-08 CAL-13 CAL-14 CAL-01b
```

If the temporary processes have expired, recreate an isolated local environment using the [repository’s environment instructions](../docs/operations/environments.md). The workaround used this run is recorded in [harness notes](harness/README.md). For a Stripe retest, use the sandbox configuration and verification steps in [payment-test-log.md](payment-test-log.md).
