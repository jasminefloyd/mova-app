# MOVA — Codex File-by-File Implementation & Execution Control Plan
**Version:** 1.1 | **Date:** 2026-11-03 | **Starting state:** EMPTY repository | **Status:** Engineering execution draft; product-owner approvals remain mandatory.

> **Authoritative source:** `MOVA_PRD_Technical_Architecture_Engineering_Handoff_v1.md` (copy unmodified to `docs/product/PRD_BASELINE.md`). This plan operationalizes—not replaces—the PRD. If a requirement is missing or conflicting, STOP, document the discrepancy and seek approval. Do not infer that a proposed integration is live-ready merely because a stub or sandbox test works.

## 1. Fixed product and engineering contract
- **ICP:** Independent hairstylists first: booth/chair renters, commission-based and multi-location artists. Other independently operating beauty professionals second.
- **Web only:** Mobile-first React + TypeScript + Vite **PWA**, hosted on **Vercel**. No Expo, React Native or native widget in MVP.
- **Backend:** Supabase Postgres, RLS, Auth, Storage, Edge Functions, durable jobs and scheduled triggers.
- **Experience:** Five artist tabs (Home, Calendar, Clients, Growth, Business), plus public showcase and booking.
- **Brand:** `mova.` / *Your business moves with you.*; locked forest/botanical/sage/mint/ivory/peach, Manrope + DM Sans, editorial hair-first visuals.
- **MVP:** F01–F12 from PRD, including Google Calendar outbound sync, Apple subscribed iCalendar feed, hair portfolio/Book This Look, location-aware request/instant booking, client CRM, payments, AI growth, Google presence and wallet-card fallback.
- **Business:** Proposed Free $0 + 1.5%, Pro $19 + 1.0%, AI Growth $39 + 0.5% platform fees on eligible Mova-processed payments only. Final plan entitlements and live financial topology **not approved**.
- **Bilingual V1:** default `en-US`, full `es-US` core journeys; independent artist/guest locale. **Acquisition V1:** bilingual SEO/AEO marketing, free booth rent calculator, secure waitlist and analytics.
- **Release:** No production promotion without product-owner signed GO. Engineers may complete approved sandbox workflows while blocked features remain explicitly incomplete.

### Approval blockers inherited from PRD
A-01 plan entitlements; A-02 Stripe Connect topology/compliance; A-03 messaging provider; A-04 AI provider/evaluation; A-05 Google Business API eligibility; A-06 Wallet pass issuer/certificates; A-07 domain/trademark; A-08 privacy/consent/retention; A-09 push channels; A-10 calendar privacy; A-11 compensation estimates. Each must have `OPEN|APPROVED|REJECTED|DEFERRED` status, owner, date, rationale, and impact. No agent can approve itself.

## 2. Repository layout (target)
```text
mova/
  AGENTS.md  README.md  package.json  pnpm-workspace.yaml  pnpm-lock.yaml
  .env.example  .github/workflows/{ci,staging}.yml  vercel.json
  apps/web/
    index.html  vite.config.ts  tsconfig.json  package.json
    public/{manifest.webmanifest,icons/}
    src/{main.tsx,App.tsx,router.tsx,lib/,styles/,components/,features/,pages/}
  packages/
    contracts/src/      # Zod DTOs, enums, API errors, typed request/response contracts
    design-tokens/src/  # Locked brand constants
    config/             # TypeScript, lint, formatter presets
  supabase/
    config.toml  seed.sql  migrations/  functions/
      _shared/           # auth, tenant, money, idempotency, policy, providers
  tests/{unit,integration,db,e2e,security,a11y,reliability,performance,visual}/
  scripts/{verify-phase.mjs,render-public-pages.mjs}
  docs/
    product/PRD_BASELINE.md
    architecture/  decisions/  engineering/  operations/  security/
```
**File naming is prescriptive for the initial scaffold.** If a framework limitation requires a different name, open a change request with the old path, new path, justification and mapped tests. Do not silently rename.

## 3. Codex operating protocol (paste into root AGENTS.md)
1. Read `docs/product/PRD_BASELINE.md`, `docs/product/MASTER_BLUEPRINT.md`, this plan, `PHASE_STATUS.md`, `REQUIREMENTS_MATRIX.csv`, and `DECISION_LOG.md` at session start. Confirm current phase and approved decisions.
2. Work **one phase and one reviewable vertical slice at a time**. Never skip an unchecked task or implement a later phase to hide a missing dependency.
3. Before edits, output intended files, requirement IDs, test names, risks and blockers. After edits, output actual changed files, commands/results, screenshots, deviations and next action.
4. Never mark complete from code existence. `DONE` requires passing tests, staging proof, traceability, review, and gate acceptance. `BLOCKED` is not `DONE`.
5. Use real migrations, authenticated endpoints and integrated UI. Mock providers only in test/sandbox adapters; label all disabled production integrations honestly.
6. No secrets in repository; never use service-role key in browser. Validate input on server, scope every tenant query, test RLS, rate limit guest endpoints.
7. Require tests for normal, negative, concurrency, authorization, idempotency and failure/retry cases when applicable. No `test.skip` or silent TODO on critical path.
8. No automatic production deploy, Stripe live activation, AI bulk messaging, or product/business-policy change without approval.
9. When context resets, recover state from committed docs, not prior chat. Commit an end-of-session handoff in `PHASE_STATUS.md`.
10. Escalate ambiguity with an explicit decision request and recommended safe fallback; do not invent behavior.

### Required phase status record
`phase_id | status NOT_STARTED/IN_PROGRESS/BLOCKED/IN_REVIEW/ACCEPTED | PR SHA | branch | commit SHA | PR URL | checklist count done/total | test command/results | staging URL | evidence links | open defects | approvals | reviewer/date`

### Requirement traceability CSV columns
`requirement_id,prd_section,acceptance_criterion,phase_id,implementation_files,migration_or_function,test_files,staging_evidence,status,reviewer,approval_date`
Create **one row per independently testable acceptance criterion**, not just one per feature. Include F01–F14, D-01–D-14, A-01–A-15, security and nonfunctional requirements. A blank implementation or test cell blocks acceptance.

### Standard phase gate (applies to EVERY phase)
- [ ] Every checklist item implemented; actual files match prescribed manifest or approved ADR.
- [ ] `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass.
- [ ] Relevant local Supabase reset/migrations and database tests pass; no destructive migration without rollback/backup review.
- [ ] E2E on staging demonstrates real persisted workflow and negative/error path; screenshots/video attached.
- [ ] Tenant isolation, privacy, idempotency and money invariants tested where relevant.
- [ ] All new endpoints have contract schema, auth classification, error codes, rate limits and OpenAPI documentation.
- [ ] Traceability matrix updated with proof and test results; no unmapped PRD acceptance criteria.
- [ ] Security scan, accessibility smoke and visual regressions pass for affected UI.
- [ ] Reviewer signs phase gate; phase status becomes ACCEPTED. A blocker remains BLOCKED and is not counted as complete.

### Integration and cross-phase testing rule
At each phase, run **all previously accepted critical-path tests**. Do not build isolated modules that only work in unit tests. Preserve an executable seeded artist + customer journey in staging from phase 06 onward. Each newly added feature must integrate into existing navigation, authorization, persistence, events, error handling and analytics.

## 4. Cross-cutting technical invariants
- UUID tenant `artist_business_id` separate from auth user; membership checks + RLS on all artist-owned tables, including child joins and storage policies.
- Money integer minor units; platform fees in integer basis points; immutable ledger and processor webhook dedupe.
- Appointment times UTC with IANA timezone for display; database-enforced overlap prevention and versioned state transitions.
- Guest booking uses minimal public DTO, expiring scoped token, rate limit, abuse controls and idempotency key.
- Durable transactional outbox drives calendar sync, notifications, AI triggers; jobs have lease, retry/backoff and dead-letter state.
- Google Calendar is outbound sync; Apple is subscription `.ics` with hashed revocable feed token. No two-way availability blocking in MVP.
- Public profile pages must have crawlable HTML and server-visible social metadata; choose prerender/SSR architecture by ADR before F02 is accepted.
- Consent and opt-out checked at **send time**. AI does not autonomously message clients without approved workflow.
- Google Business API and native wallet passes are conditional on provider eligibility/certificates; approved manual/link/QR fallback remains functional.

## 5. Implementation phases and file-level checklists

### PHASE 00 — Contract lock and empty-repo bootstrap

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `docs/product/MASTER_BLUEPRINT.md` — copy reviewed master blueprint; enforce product/business status definitions.
- [ ] `docs/engineering/SALES_PROMISES_MATRIX.md` — map sales pitch claims to F01–F14 and availability flags.
- [ ] `docs/decisions/ADR-0002-i18n.md` — choose i18n runtime, locale URLs, fallback, template strategy.
- [ ] `docs/decisions/ADR-0003-public-rendering.md` — choose SSR/prerender, canonical and hreflang architecture.
- [ ] `docs/engineering/REQUIREMENTS_MATRIX.csv` — add F13/F14 acceptance rows, QA IDs, review evidence.
- [ ] `docs/engineering/DECISION_LOG.md` — add D-12–D-14 and A-12–A-15; owner signoff.

**Requirements:** D-01..D-14, A-01..A-11  \n**Prerequisite accepted phases:** none  \n**Gate:** P00 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `AGENTS.md` — exists, wired to real implementation, reviewed.
- [ ] `README.md` — exists, wired to real implementation, reviewed.
- [ ] `package.json` — exists, wired to real implementation, reviewed.
- [ ] `pnpm-workspace.yaml` — exists, wired to real implementation, reviewed.
- [ ] `pnpm-lock.yaml` — exists, wired to real implementation, reviewed.
- [ ] `.nvmrc` — exists, wired to real implementation, reviewed.
- [ ] `.gitignore` — exists, wired to real implementation, reviewed.
- [ ] `.editorconfig` — exists, wired to real implementation, reviewed.
- [ ] `.env.example` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/IMPLEMENTATION_PLAN.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/PHASE_STATUS.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/REQUIREMENTS_MATRIX.csv` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/DECISION_LOG.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/CHANGE_REQUESTS.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/TEST_EVIDENCE.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/RELEASE_ACCEPTANCE.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/architecture/overview.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/decisions/ADR-0001-stack.md` — exists, wired to real implementation, reviewed.
- [ ] `scripts/verify-phase.mjs` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P00-T01: Initialize Git repository with protected main and pull-request policy; pin Node/pnpm versions and deterministic lockfile.
- [ ] P00-T02: Copy source PRD unchanged into docs/product/PRD_BASELINE.md and record SHA-256 in baseline manifest.
- [ ] P00-T03: Transcribe locked decisions and approval-required items; mark unresolved integrations blocked/flagged.
- [ ] P00-T04: Create requirement-to-file-to-test traceability CSV with one row per F01–F12 acceptance criterion.
- [ ] P00-T05: Configure phase verification script to reject unchecked evidence links, failed checks, missing decision approval.
- [ ] P00-T06: Set up CI to require formatting, lint, typecheck, tests, migrations, security scan, build and traceability verification.
- [ ] P00-T07: Add branch naming, PR template, commit discipline, and Codex session handoff rules.

**Phase-specific acceptance:**
- [ ] P00-AC01: A clean checkout installs deterministically. Attach evidence and test reference.
- [ ] P00-AC02: PRD hash and decision log are recorded. Attach evidence and test reference.
- [ ] P00-AC03: No unapproved decisions silently resolved. Attach evidence and test reference.
- [ ] P00-AC04: Phase 00 gate evidence committed. Attach evidence and test reference.

**Phase 00 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 01 — Application shell, environments and Supabase infrastructure

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `apps/web/src/i18n/index.ts` — initialize en-US/es-US runtime, locale detection, fallback.
- [ ] `apps/web/src/i18n/locale.ts` — parse and persist locale independently for artist and guest.
- [ ] `packages/contracts/src/locale.ts` — define allowed locales, DTO validation and locale metadata.
- [ ] `scripts/check-locales.mjs` — CI translation key parity and critical string validation.
- [ ] `supabase/migrations/000*_artist_locale.sql` — add artist preferred_locale with en-US default and constraints.
- [ ] `apps/web/src/lib/seo/metadata.ts` — server-visible SEO metadata abstraction.

**Requirements:** F11, security foundations  \n**Prerequisite accepted phases:** 00  \n**Gate:** P01 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `apps/web/package.json` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/index.html` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/vite.config.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/tsconfig.json` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/main.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/App.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/router.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/lib/env.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/lib/supabase.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/lib/query-client.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/lib/api.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/styles/index.css` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/public/manifest.webmanifest` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/public/icons/icon-192.png` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/public/icons/icon-512.png` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/public/icons/maskable-512.png` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/package.json` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/errors.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/api.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/enums.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/schemas.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/config/tsconfig.base.json` — exists, wired to real implementation, reviewed.
- [ ] `supabase/config.toml` — exists, wired to real implementation, reviewed.
- [ ] `supabase/seed.sql` — exists, wired to real implementation, reviewed.
- [ ] `vercel.json` — exists, wired to real implementation, reviewed.
- [ ] `.github/workflows/ci.yml` — exists, wired to real implementation, reviewed.
- [ ] `.github/workflows/staging.yml` — exists, wired to real implementation, reviewed.
- [ ] `docs/operations/environments.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/operations/secrets.md` — exists, wired to real implementation, reviewed.
- [ ] `tests/smoke/app-load.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P01-T01: Configure React/Vite/TypeScript strict mode, React Router, TanStack Query, Zod, Tailwind, accessible primitives.
- [ ] P01-T02: Implement separate /app and /artists/:handle route shells; error and loading boundaries.
- [ ] P01-T03: Configure vite-plugin-pwa service worker with conservative asset-only cache; exclude private APIs and payment responses.
- [ ] P01-T04: Create separate Supabase dev/stage/prod projects and Vercel environments; never reuse secrets.
- [ ] P01-T05: Implement typed env validation and error envelope {data,error,request_id}.
- [ ] P01-T06: Create Supabase local dev scripts and automated migrations/seed reset.
- [ ] P01-T07: Configure CSP, HSTS, secure cookies/headers where applicable, rate-limiting strategy and redacted logs.
- [ ] P01-T08: Implement CI checks and staging deployment with rollback notes.

**Phase-specific acceptance:**
- [ ] P01-AC01: Install, lint, typecheck, unit test, build and smoke test pass. Attach evidence and test reference.
- [ ] P01-AC02: PWA installs on Android/desktop supported browsers; iOS guidance tested. Attach evidence and test reference.
- [ ] P01-AC03: No private API cached offline. Attach evidence and test reference.
- [ ] P01-AC04: Staging uses isolated credentials. Attach evidence and test reference.

**Phase 01 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 02 — Locked Mova design system and mobile navigation

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `apps/web/src/components/LanguageSwitcher.tsx` — accessible language switcher on public and app surfaces.
- [ ] `apps/web/src/i18n/resources/en-US/common.json` — base shared UI catalog.
- [ ] `apps/web/src/i18n/resources/es-US/common.json` — reviewed Spanish shared UI catalog.
- [ ] `apps/web/src/pages/marketing/HomePage.tsx` — responsive localized editorial landing page.
- [ ] `apps/web/src/styles/marketing.css` — locked Mova visual identity and responsive marketing.
- [ ] `tests/e2e/localization-smoke.spec.ts` — mobile language-switch and persistent state test.

**Requirements:** D-10, F11  \n**Prerequisite accepted phases:** 01  \n**Gate:** P02 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `packages/design-tokens/src/colors.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/design-tokens/src/typography.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/design-tokens/src/spacing.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/design-tokens/src/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/ui/Button.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/ui/Input.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/ui/Select.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/ui/Modal.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/ui/BottomSheet.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/ui/Toast.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/ui/StatusBadge.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/ui/EmptyState.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/ui/Skeleton.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/layout/ArtistShell.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/layout/PublicShell.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/layout/BottomTabs.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/layout/TopBar.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/components/layout/OfflineBanner.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/styles/tokens.css` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/styles/fonts.css` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/pages/NotFoundPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/pages/ForbiddenPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/pages/OfflinePage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `tests/visual/mobile-layout.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/a11y/navigation.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P02-T01: Implement approved forest/botanical/sage/mint/ivory/peach tokens and Manrope/DM Sans with licensed hosted assets.
- [ ] P02-T02: Use editorial hair-first imagery and artist-centric content, not generic SaaS templates.
- [ ] P02-T03: Build 5-tab bottom navigation: Home, Calendar, Clients, Growth, Business.
- [ ] P02-T04: Handle safe areas, on-screen keyboard, 360/390/430px mobile, 768 tablet, 1440 desktop.
- [ ] P02-T05: Create reusable accessible focus, error, disabled, loading, confirmation, toast, bottom-sheet states.
- [ ] P02-T06: Enforce contrast, 44px touch targets, reduced motion and screen-reader labels.
- [ ] P02-T07: Add screenshot regression baselines for artist and public shells.

**Phase-specific acceptance:**
- [ ] P02-AC01: All primitives have component tests and accessible states. Attach evidence and test reference.
- [ ] P02-AC02: Mobile screens have no horizontal overflow. Attach evidence and test reference.
- [ ] P02-AC03: Visual snapshots approved against locked Mova reference. Attach evidence and test reference.
- [ ] P02-AC04: Bottom tabs keyboard and screen-reader accessible. Attach evidence and test reference.

**Phase 02 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 03 — Identity, tenant model and onboarding

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `apps/web/src/i18n/resources/en-US/onboarding.json` — English six-stage onboarding strings.
- [ ] `apps/web/src/i18n/resources/es-US/onboarding.json` — Spanish six-stage onboarding strings.
- [ ] `tests/e2e/onboarding-locales.spec.ts` — both locales, independent preference persistence.

**Requirements:** F01  \n**Prerequisite accepted phases:** 01,02  \n**Gate:** P03 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0001_identity.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0002_identity_rls.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0003_identity_triggers.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/auth.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/tenant.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/validation.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/response.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/publish-showcase/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/auth/AuthProvider.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/auth/RequireArtist.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/auth/SignInPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/auth/SignUpPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/auth/VerifyEmailPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/onboarding/OnboardingWizard.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/onboarding/ArtistProfileStep.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/onboarding/ServicesStep.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/onboarding/LocationStep.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/onboarding/PaymentsStep.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/onboarding/PublishStep.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/onboarding/useOnboarding.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/identity.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/identity-rls.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/onboarding.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P03-T01: Create artist_businesses, artist_memberships, artist_profiles, onboarding_progress with UUID tenant key and unique case-insensitive handles.
- [ ] P03-T02: Enforce ownership and deny cross-tenant reads/writes via RLS and membership checks.
- [ ] P03-T03: Add reserved handle validation and transactional handle claim.
- [ ] P03-T04: Implement email auth and verification, session refresh and logout.
- [ ] P03-T05: Persist six-step wizard progress; allow skipping optional location/payment configuration.
- [ ] P03-T06: Publish showcase independently of booking enablement; publish function validates profile and logs audit.
- [ ] P03-T07: Add no-Stripe salon-only onboarding and draft/unpublished privacy states.

**Phase-specific acceptance:**
- [ ] P03-AC01: Cross-tenant RLS attacks fail. Attach evidence and test reference.
- [ ] P03-AC02: Draft profile is not publicly accessible. Attach evidence and test reference.
- [ ] P03-AC03: Reload preserves onboarding progress. Attach evidence and test reference.
- [ ] P03-AC04: Published showcase can exist without bookable service or Stripe. Attach evidence and test reference.

**Phase 03 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 04 — Hair-first showcase, services and portfolio

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `apps/web/src/lib/seo/canonical.ts` — public artist canonical/noindex policy.
- [ ] `apps/web/src/lib/seo/hreflang.ts` — reciprocal locale alternates for translated marketing pages.
- [ ] `scripts/render-public-pages.mjs` — build crawlable public HTML and social previews.
- [ ] `tests/e2e/public-indexing.spec.ts` — draft/private noindex and public metadata test.

**Requirements:** F02,F03 partial  \n**Prerequisite accepted phases:** 03  \n**Gate:** P04 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0004_services_portfolio.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0005_storage_policies.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/public-artist/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/services/ServiceCatalogPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/services/ServiceEditor.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/services/ServiceLocationOverrides.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/showcase/ShowcaseEditorPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/showcase/PortfolioUploader.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/showcase/BookThisLookEditor.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/public/PublicShowcasePage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/public/PortfolioGallery.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/public/ServicePicker.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/public/SeoMetadata.tsx` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/services.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/showcase.ts` — exists, wired to real implementation, reviewed.
- [ ] `scripts/render-public-pages.mjs` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/public-projection.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/showcase.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P04-T01: Migrate services, service_locations, portfolio_items, portfolio_service_links and private/public storage access policies.
- [ ] P04-T02: Support hair service templates, durations, buffers, pricing and location overrides without hardcoding hair into generic schema.
- [ ] P04-T03: Implement secure uploads, MIME/size checks, image variants, alt text, ordering and publish state.
- [ ] P04-T04: Implement Book This Look mapping and fallback to service selector.
- [ ] P04-T05: Render public DTO only from allowlisted published fields.
- [ ] P04-T06: Implement crawlable public profile HTML/OpenGraph/canonical metadata with verified prerender or SSR approach (ADR required).
- [ ] P04-T07: Do not expose unpublished media through guessable public storage paths.

**Phase-specific acceptance:**
- [ ] P04-AC01: Published profiles crawlable without executing JS. Attach evidence and test reference.
- [ ] P04-AC02: Book This Look selects mapped service. Attach evidence and test reference.
- [ ] P04-AC03: Draft portfolio image inaccessible to guests. Attach evidence and test reference.
- [ ] P04-AC04: 360px showcase matches Mova design. Attach evidence and test reference.

**Phase 04 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 05 — Locations, hours, availability and conflict invariants

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `apps/web/src/i18n/resources/en-US/booking.json` — English availability and request/instant status strings.
- [ ] `apps/web/src/i18n/resources/es-US/booking.json` — Spanish availability and request/instant status strings.
- [ ] `tests/unit/timezone-locale.test.ts` — DST and Intl locale formatting.

**Requirements:** F03  \n**Prerequisite accepted phases:** 03,04  \n**Gate:** P05 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0006_locations.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0007_availability.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0008_booking_constraints.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/availability-search/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/availability.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/timezone.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/locations/LocationsPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/locations/LocationEditor.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/locations/HoursEditor.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/locations/LocationPoliciesEditor.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/calendar/AvailabilityEditor.tsx` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/locations.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/availability.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/db/booking-overlap.test.sql` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/availability.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/multilocation-hours.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P05-T01: Create locations, hours, exceptions, policies, compensation agreements, availability blocks.
- [ ] P05-T02: Keep booking mode, calendar ownership and payment collector independent fields.
- [ ] P05-T03: Implement IANA timezone handling and DST edge cases; UTC timestamps for appointment instants.
- [ ] P05-T04: Compute slots with lead time, horizon, buffers, closures, service-location overrides and existing holds.
- [ ] P05-T05: Enforce resource overlap at database transaction boundary (exclusion constraint or equivalent locking, including pending holds).
- [ ] P05-T06: Request-to-book must never claim authoritative availability in external salon system.
- [ ] P05-T07: Make booking readiness per location, not global.

**Phase-specific acceptance:**
- [ ] P05-AC01: Two locations show different slots and policies. Attach evidence and test reference.
- [ ] P05-AC02: Simultaneous requests cannot double-book a Mova-controlled resource. Attach evidence and test reference.
- [ ] P05-AC03: DST transition tests pass. Attach evidence and test reference.
- [ ] P05-AC04: External-controlled slots remain requests. Attach evidence and test reference.

**Phase 05 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 06 — End-to-end booking and artist calendar

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `tests/e2e/booking-bilingual.spec.ts` — English/Spanish customer checkout and request state.
- [ ] `apps/web/src/features/booking/guest-locale.ts` — preserve guest locale through booking and notification.
- [ ] `supabase/functions/_shared/i18n/index.ts` — server locale selection and critical translation guard.

**Requirements:** F04  \n**Prerequisite accepted phases:** 05  \n**Gate:** P06 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0009_appointments.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0010_booking_events_holds.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/booking-create/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/booking-status/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/booking-transition/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/booking-reschedule/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/booking-machine.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/idempotency.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/public/BookingPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/public/CheckoutRequestPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/public/BookingStatusPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/calendar/CalendarPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/calendar/AppointmentDetailPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/calendar/BookingRequestQueue.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/home/HomePage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/booking.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/booking-state-machine.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/instant-booking.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/request-booking.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/booking-race.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P06-T01: Implement appointments, appointment_events, booking_holds, status transitions, optimistic version checks.
- [ ] P06-T02: Create guest booking with rate limits, bot controls, scoped expiring status token, idempotency key.
- [ ] P06-T03: Implement instant booking and request approval/rejection flows separately.
- [ ] P06-T04: Provide accurate confirmed/pending/declined/cancelled statuses and artist queue.
- [ ] P06-T05: Support reschedule, cancellation, no-show, completion with event audit.
- [ ] P06-T06: Emit durable outbox events transactionally for notifications, calendar and AI consumers.
- [ ] P06-T07: Ensure payment-required bookings do not falsely confirm before payment requirements are met.

**Phase-specific acceptance:**
- [ ] P06-AC01: Duplicate submit yields one booking. Attach evidence and test reference.
- [ ] P06-AC02: Concurrent slot booking yields at most one confirmed reservation. Attach evidence and test reference.
- [ ] P06-AC03: Request booking remains pending until artist accepts. Attach evidence and test reference.
- [ ] P06-AC04: Every transition has audit and outbox event. Attach evidence and test reference.

**Phase 06 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 07 — Client CRM, consent and import

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `apps/web/src/i18n/resources/en-US/clients.json` — client and consent strings.
- [ ] `apps/web/src/i18n/resources/es-US/clients.json` — reviewed client and consent strings.
- [ ] `tests/e2e/client-consent-locales.spec.ts` — consent UI, import errors and locale.

**Requirements:** F05  \n**Prerequisite accepted phases:** 06  \n**Gate:** P07 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0011_clients_consents.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0012_client_import.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/client-import-preview/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/client-import-commit/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/account-export/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/account-delete-request/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/clients/ClientsPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/clients/ClientProfilePage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/clients/ClientImportWizard.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/clients/ConsentHistory.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/clients/ClientMergeReview.tsx` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/clients.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/client-import.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/consent-rls.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/client-history.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P07-T01: Create clients, client_consents, client_import_batches and appointment-linked history queries.
- [ ] P07-T02: Implement artist-owned client records with strict tenant RLS and lawful-import attestations.
- [ ] P07-T03: CSV upload preview, column mapping, normalized email/phone, duplicate candidate detection, explicit merge choices.
- [ ] P07-T04: Import commit in idempotent chunks with resumability and row-level error reports.
- [ ] P07-T05: Record channel/purpose-specific consent with proof and revocation; separate transactional from marketing consent.
- [ ] P07-T06: Implement scoped export and deletion request flow with retention/legal hold approval points.
- [ ] P07-T07: No client notes or private preferences in public booking DTOs.

**Phase-specific acceptance:**
- [ ] P07-AC01: Duplicate import does not multiply clients. Attach evidence and test reference.
- [ ] P07-AC02: Revoked marketing consent blocks outreach eligibility. Attach evidence and test reference.
- [ ] P07-AC03: Cross-tenant client reads denied. Attach evidence and test reference.
- [ ] P07-AC04: Import preview has no write side effects. Attach evidence and test reference.

**Phase 07 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 08 — Stripe Connect, deposits, financial ledger and manual payments

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `apps/web/src/i18n/resources/en-US/payments.json` — English payment/deposit/refund messages.
- [ ] `apps/web/src/i18n/resources/es-US/payments.json` — human-reviewed Spanish payment/deposit/refund messages.
- [ ] `tests/e2e/payment-locales.spec.ts` — financially accurate bilingual checkout and refunds.

**Requirements:** F06  \n**Prerequisite accepted phases:** 06,07; A-02 approval before live  \n**Gate:** P08 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0013_payments.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0014_ledger.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0015_provider_events.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/stripe-connect-onboard/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/payment-intent-create/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/stripe-webhook/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/refund-request/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/manual-payment-record/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/payment-policy.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/ledger.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/stripe.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/payments/PaymentSetupPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/payments/CheckoutPayment.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/payments/PaymentsPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/payments/PaymentDetail.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/payments/ManualPaymentForm.tsx` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/payments.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/stripe-webhook.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/ledger-invariants.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/deposit-balance.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P08-T01: Create payment_accounts, payments, refunds, immutable ledger and provider webhook dedupe table.
- [ ] P08-T02: Record amounts in integer minor units; calculate plan platform fee on server only for eligible Stripe-processed payments.
- [ ] P08-T03: Implement Stripe Connect onboarding, capabilities, sandbox checkout, eligible Apple Pay/Google Pay/Cash App Pay.
- [ ] P08-T04: Verify Stripe raw-body signature and idempotent webhook ingestion; reconcile async payment state.
- [ ] P08-T05: Handle deposit + balance without double-charge, refund/partial refund, failures, disputes as defined by approved topology.
- [ ] P08-T06: Record cash/Zelle/salon-collected separately and never represent them as Stripe-settled revenue.
- [ ] P08-T07: Display gross, processed, artist-collected, salon-collected and estimated earnings separately.
- [ ] P08-T08: Keep live processing disabled until A-02 and related legal/financial decisions approved.

**Phase-specific acceptance:**
- [ ] P08-AC01: Webhook replay does not double-post ledger. Attach evidence and test reference.
- [ ] P08-AC02: Deposit plus balance reconciles to gross. Attach evidence and test reference.
- [ ] P08-AC03: Cash/Zelle/salon entries never incur Mova processor fee. Attach evidence and test reference.
- [ ] P08-AC04: Refunds balance ledger and are permission-scoped. Attach evidence and test reference.

**Phase 08 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 09 — Google Calendar and Apple subscribed calendar

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `tests/e2e/calendar-locales.spec.ts` — translated status and privacy settings; outbound-only disclosure.

**Requirements:** F07  \n**Prerequisite accepted phases:** 06; A-10 approval  \n**Gate:** P09 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0016_integrations_calendar.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/calendar-google-connect/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/calendar-google-callback/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/calendar-sync-settings/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/calendar-sync-run/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/calendar-ics-feed/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/calendar-ics-rotate/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/google-calendar.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/ical.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/calendar-sync/CalendarSyncPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/calendar-sync/GoogleCalendarConnect.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/calendar-sync/AppleCalendarSubscribe.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/calendar-sync/CalendarSyncStatus.tsx` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/calendar-sync.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/google-calendar-sync.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/ical-feed.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/calendar-connect.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P09-T01: Create integration_connections, calendar_sync_settings, external_calendar_events, hashed calendar_feed_tokens.
- [ ] P09-T02: Implement OAuth state/PKCE as supported, least-privilege Google scopes, encrypted refresh credentials and disconnect.
- [ ] P09-T03: Sync appointment create/update/cancel from outbox to selected Google calendar with stable external event IDs.
- [ ] P09-T04: Generate RFC 5545-compliant subscribed .ics with stable UID, DTSTAMP, SEQUENCE, cancellation/update semantics and correct timezone.
- [ ] P09-T05: Protect feed with high-entropy unguessable token; hash at rest; rotate/revoke; redact URLs from logs.
- [ ] P09-T06: Support location filters, privacy-minimal event titles and artist control of details.
- [ ] P09-T07: Display Apple subscription steps and warn that refresh is controlled by Apple.
- [ ] P09-T08: Keep external calendar to Mova blocking out of MVP.

**Phase-specific acceptance:**
- [ ] P09-AC01: Google event create/update/cancel works in sandbox test account. Attach evidence and test reference.
- [ ] P09-AC02: ICS parses in Apple Calendar and updates after subscription refresh. Attach evidence and test reference.
- [ ] P09-AC03: Rotated URL invalidates old feed. Attach evidence and test reference.
- [ ] P09-AC04: No customer phone/email in default event. Attach evidence and test reference.

**Phase 09 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 10 — AI revenue agent, predictive rebooking and outreach

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `apps/web/src/i18n/resources/en-US/growth.json` — AI review and outreach UI.
- [ ] `apps/web/src/i18n/resources/es-US/growth.json` — Spanish AI review and outreach UI.
- [ ] `supabase/functions/_shared/i18n/templates.ts` — server-rendered localized outbound templates.
- [ ] `tests/integration/ai-outreach-locales.test.ts` — consent, recipient language, approval and opt-out at send time.

**Requirements:** F08  \n**Prerequisite accepted phases:** 07,09; A-03,A-04,A-08 approvals before live outreach  \n**Gate:** P10 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0017_growth.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0018_outreach.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/growth-opportunities-list/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/growth-opportunity-generate/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/outreach-approve/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/outreach-send/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/growth-rules.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/rebooking.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/ai-provider.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/outreach-policy.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/growth/GrowthPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/growth/OpportunityDetailPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/growth/AiControlsPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/growth/OutreachApprovalSheet.tsx` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/growth.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/rebooking-predictions.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/outreach-consent.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/growth-approval.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P10-T01: Create growth_opportunities, rebooking_predictions, outreach_campaigns, outreach_events.
- [ ] P10-T02: Compute explainable deterministic return windows from client/service cadence, with insufficient-data fallback.
- [ ] P10-T03: Detect unfilled slots and rank compatible eligible clients; keep low-confidence suggestions distinguishable.
- [ ] P10-T04: Keep model provider adapter, prompt/version/cost metadata and structured output validation.
- [ ] P10-T05: Artist must explicitly approve recipients and message; recheck consent, quiet hours and opt-outs at send time.
- [ ] P10-T06: Rate limit outreach per client and artist, dedupe sends, record attribution and negative outcomes.
- [ ] P10-T07: Add human-review control and kill switch; prohibit autonomous marketing until approved.
- [ ] P10-T08: Run offline evaluation on representative seeded hair services and known edge cases.

**Phase-specific acceptance:**
- [ ] P10-AC01: No consent means no marketing send. Attach evidence and test reference.
- [ ] P10-AC02: Repeated jobs do not duplicate messages. Attach evidence and test reference.
- [ ] P10-AC03: Every opportunity has evidence and version. Attach evidence and test reference.
- [ ] P10-AC04: Artist can disable AI/outreach and see effect immediately. Attach evidence and test reference.

**Phase 10 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 11 — Google presence, share/wallet card and notifications

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `tests/integration/notifications-locales.test.ts` — English/Spanish templates, fallback and opt-out.
- [ ] `apps/web/src/i18n/resources/en-US/legal.json` — approved English consent/policy strings.
- [ ] `apps/web/src/i18n/resources/es-US/legal.json` — human-reviewed Spanish consent/policy strings.

**Requirements:** F09,F10,F11  \n**Prerequisite accepted phases:** 04,06; A-05,A-06,A-09 approvals for provider features  \n**Gate:** P11 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0019_wallet_notifications.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/wallet-card-create/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/notification-dispatch/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/google-presence-status/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/business/BusinessPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/business/GooglePresencePage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/business/WalletCardPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/notifications/NotificationSettings.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/notifications/InstallPrompt.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/notifications/NotificationInbox.tsx` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/notifications.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/notification-idempotency.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/wallet-share.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/pwa-install.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P11-T01: Provide manual Google Business booking-link guidance as guaranteed fallback; only enable API operations when eligibility verified.
- [ ] P11-T02: Create branded QR share card and download/share flow; native Apple/Google Wallet passes behind approved issuer/cert integration.
- [ ] P11-T03: Implement transactional notification templates, in-app inbox, retries, dedupe and preference controls.
- [ ] P11-T04: Implement supported browser push with permission prompts only after clear artist intent; iOS Home Screen caveat.
- [ ] P11-T05: Verify PWA manifest, service worker update behavior and install UX across mobile devices.
- [ ] P11-T06: Ensure wallet/share URLs use configurable final domain and never invent launch URL.

**Phase-specific acceptance:**
- [ ] P11-AC01: QR card opens correct public showcase. Attach evidence and test reference.
- [ ] P11-AC02: Provider-ineligible artist still has manual Google guidance. Attach evidence and test reference.
- [ ] P11-AC03: Notification retry does not duplicate delivery. Attach evidence and test reference.
- [ ] P11-AC04: Unsupported push browsers degrade gracefully. Attach evidence and test reference.

**Phase 11 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 12 — Plans, subscriptions, entitlements and analytics

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `supabase/migrations/000*_acquisition_waitlist.sql` — consent-aware waitlist table, dedupe, RLS and attribution.
- [ ] `supabase/functions/waitlist-signup/index.ts` — validated rate-limited idempotent signup endpoint.
- [ ] `packages/contracts/src/acquisition.ts` — waitlist/qualification and calculator contracts.
- [ ] `apps/web/src/features/acquisition/BoothRentCalculator.tsx` — free bilingual calculator; no financial data transmitted.
- [ ] `apps/web/src/features/acquisition/WaitlistForm.tsx` — real persistence and honest UI states.
- [ ] `apps/web/src/features/acquisition/analytics.ts` — consent-aware acquisition/activation events.
- [ ] `apps/web/src/features/acquisition/utm.ts` — safe UTM/source capture.
- [ ] `apps/web/src/pages/marketing/CalculatorPage.tsx` — localized calculator landing page.
- [ ] `apps/web/src/pages/marketing/GuidePage.tsx` — localized original editorial resources.
- [ ] `apps/web/src/content/en-US/` — English marketing and guide content.
- [ ] `apps/web/src/content/es-US/` — human-reviewed Spanish marketing and guide content.

**Requirements:** F12, analytics  \n**Prerequisite accepted phases:** 08; A-01 approval before paid plans  \n**Gate:** P12 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0020_plans_subscriptions.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/migrations/0021_platform_events.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/subscription-checkout/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/subscription-portal/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/entitlements.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/billing/PlansPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/billing/SubscriptionPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/billing/UpgradePrompt.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/home/BusinessMetrics.tsx` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/billing.ts` — exists, wired to real implementation, reviewed.
- [ ] `packages/contracts/src/analytics.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/entitlements.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/integration/subscription-webhook.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/plan-upgrade.spec.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P12-T01: Create plans, subscriptions, entitlements, platform_events; seed proposed prices as versioned config, not final live offers.
- [ ] P12-T02: Implement authoritative entitlement check on backend and explanatory UI gating.
- [ ] P12-T03: Implement checkout, upgrade/downgrade, cancel, trial and grace states only as approved by product owner.
- [ ] P12-T04: Recompute platform fee using active plan effective at payment creation and preserve fee snapshot for audit.
- [ ] P12-T05: Track funnel events with stable dedupe keys and no unnecessary PII.
- [ ] P12-T06: Verify webhook-driven subscription state transitions and failed-payment handling.

**Phase-specific acceptance:**
- [ ] P12-AC01: Downgrade does not silently delete data. Attach evidence and test reference.
- [ ] P12-AC02: Feature bypass through API denied. Attach evidence and test reference.
- [ ] P12-AC03: Plan changes and platform fees audit correctly. Attach evidence and test reference.
- [ ] P12-AC04: Analytics counts dedupe repeated events. Attach evidence and test reference.

**Phase 12 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 13 — Operations, security, reliability and privacy

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `scripts/generate-sitemap.mjs` — canonical sitemap from public translated routes.
- [ ] `scripts/validate-seo.mjs` — canonical/hreflang/robots/metadata checks.
- [ ] `tests/security/waitlist-abuse.spec.ts` — rate limit, consent, duplicate, bot defense.
- [ ] `tests/unit/calculator.test.ts` — financial sample, boundaries, privacy.
- [ ] `tests/e2e/acquisition-bilingual.spec.ts` — landing→calculator→waitlist in both locales.

**Requirements:** cross-cutting  \n**Prerequisite accepted phases:** 01..12  \n**Gate:** P13 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `supabase/migrations/0022_audit_jobs_outbox.sql` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/job-dispatch/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/job-worker/index.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/jobs.ts` — exists, wired to real implementation, reviewed.
- [ ] `supabase/functions/_shared/audit.ts` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/settings/SettingsPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/settings/PrivacyPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `apps/web/src/features/settings/AccountExportPage.tsx` — exists, wired to real implementation, reviewed.
- [ ] `docs/security/threat-model.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/security/rls-matrix.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/security/data-retention.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/operations/runbooks.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/operations/backup-restore.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/operations/incident-response.md` — exists, wired to real implementation, reviewed.
- [ ] `tests/security/tenant-isolation.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/security/guest-abuse.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/reliability/job-retry.test.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/reliability/recovery.test.ts` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P13-T01: Complete audit_events, outbox_events, background_jobs and durable leasing/ack/retry/dead-letter semantics.
- [ ] P13-T02: Write all RLS policy tests for artist, guest, support and worker roles.
- [ ] P13-T03: Protect service-role keys and provider credentials; rotate/revoke; redact PII in logs.
- [ ] P13-T04: Run dependency/secret scans, CSP checks, request size limits, upload safety, rate limits and auth abuse tests.
- [ ] P13-T05: Add backup/restore test, migration rollback strategy, provider outage runbooks and alerting.
- [ ] P13-T06: Test consent, export, deletion, privacy policy, retention and support-access audit.
- [ ] P13-T07: Instrument sync failures, payment reconciliation, booking latency and job backlog.

**Phase-specific acceptance:**
- [ ] P13-AC01: RLS suite denies cross-tenant reads/writes. Attach evidence and test reference.
- [ ] P13-AC02: Job failures retry safely with dead-letter visibility. Attach evidence and test reference.
- [ ] P13-AC03: Backup restore verified in staging. Attach evidence and test reference.
- [ ] P13-AC04: Critical security issues remediated or launch blocked. Attach evidence and test reference.

**Phase 13 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 14 — Full-system regression, accessibility and UAT

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `tests/e2e/localization-full.spec.ts` — full artist/guest bilingual critical journey.
- [ ] `tests/e2e/seo-crawlability.spec.ts` — JS-disabled HTML, locale metadata, noindex, sitemap.
- [ ] `docs/engineering/LOCALIZATION_QA_SIGNOFF.md` — human-reviewed Spanish financial/policy proof.
- [ ] `docs/engineering/ACQUISITION_QA_SIGNOFF.md` — waitlist persistence, attribution, privacy and SEO evidence.
- [ ] `docs/engineering/QA_CASE_EXPANSION.md` — add F13/F14 case IDs to CSV; recalculate baseline totals.

**Requirements:** F01..F12  \n**Prerequisite accepted phases:** 00..13  \n**Gate:** P14 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `tests/e2e/artist-journey.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/guest-booking-journey.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/commission-salon-journey.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/multilocation-journey.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/financial-reconciliation.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/calendar-sync-journey.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/e2e/ai-rebooking-journey.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/a11y/full-audit.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `tests/performance/mobile-budget.spec.ts` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/UAT_SCRIPTS.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/RELEASE_EVIDENCE.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/DEFECT_REGISTER.md` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P14-T01: Run all six product-owner UAT journeys from PRD plus negative paths and accessibility review.
- [ ] P14-T02: Test on iPhone Safari/PWA, Android Chrome/PWA, mobile browsers, tablet and desktop.
- [ ] P14-T03: Verify no stale mock data, TODO placeholders, dead buttons, disabled integrations misrepresented as active.
- [ ] P14-T04: Run payment reconciliation and booking concurrency stress tests; verify calendar provider failures.
- [ ] P14-T05: Audit requirement matrix: every F01–F12 acceptance criterion maps to file, automated test and manual proof.
- [ ] P14-T06: Record demo videos/screenshots and sanitized logs; triage defects by severity.
- [ ] P14-T07: Create production deployment plan and tested rollback.

**Phase-specific acceptance:**
- [ ] P14-AC01: All release-critical tests green. Attach evidence and test reference.
- [ ] P14-AC02: Zero open P0/P1 defects. Attach evidence and test reference.
- [ ] P14-AC03: Each requirement has evidence link. Attach evidence and test reference.
- [ ] P14-AC04: Product owner can perform scripted UAT on staging. Attach evidence and test reference.

**Phase 14 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

### PHASE 15 — Final owner signoff and controlled production release

**Blueprint reconciliation tasks (required; in addition to all original tasks below):**
- [ ] `docs/engineering/RELEASE_ACCEPTANCE.md` — owner GO/NO-GO explicitly includes F13/F14 and unresolved provider gates.

**Requirements:** D-11  \n**Prerequisite accepted phases:** 14  \n**Gate:** P15 — reviewer approval required.

**Files to create (or modify if already scaffolded):**
- [ ] `docs/engineering/RELEASE_ACCEPTANCE.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/PRODUCTION_CHECKLIST.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/FINAL_SIGNOFF.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/engineering/POST_LAUNCH_MONITORING.md` — exists, wired to real implementation, reviewed.
- [ ] `docs/operations/release-runbook.md` — exists, wired to real implementation, reviewed.

**Engineering tasks:**
- [ ] P15-T01: Freeze release candidate SHA and evidence manifest; require code-review approvals.
- [ ] P15-T02: Verify final domain, legal terms, privacy policy, live Stripe configuration, consent and provider credentials.
- [ ] P15-T03: Conduct product-owner walkthrough against all UAT journeys and approved Mova visual reference.
- [ ] P15-T04: Present unresolved deviations and documented waivers; no agent may sign on behalf of product owner.
- [ ] P15-T05: Require explicit written GO with version, timestamp, signer and scope before production promotion.
- [ ] P15-T06: Roll out with feature flags, smoke tests, monitoring, rollback owner and incident contact.
- [ ] P15-T07: Capture 24h/7d post-launch checks and customer support escalation path.

**Phase-specific acceptance:**
- [ ] P15-AC01: Owner signs final GO; otherwise NO-GO. Attach evidence and test reference.
- [ ] P15-AC02: Release SHA equals approved candidate. Attach evidence and test reference.
- [ ] P15-AC03: Production smoke and monitoring green. Attach evidence and test reference.
- [ ] P15-AC04: Any rollback condition has owner and documented trigger. Attach evidence and test reference.

**Phase 15 signoff:** reviewer ______  date ______  PR/SHA ______  test report ______  staging evidence ______  status ______

## 6. Endpoint/function acceptance contract (mandatory per function)
All functions use `/functions/v1/<name>` or documented equivalent, with shared typed `{data,error,request_id}` envelope except raw calendar/webhook responses. Request/response schema defined in `packages/contracts`; classify caller (`artist`, `guest`, `worker`, `provider`), JWT/token/signature validation, ownership, idempotency, rate limit, failure codes, audit events, and integration test. Never expose internal database errors.

| Function group | Functions and critical behaviors |
|---|---|
| Showcase | `publish-showcase`, `public-artist`: readiness + published-only DTO + SEO |
| Availability | `availability-search`: timezone-aware candidate slots, never promises reservation |
| Booking | `booking-create`, `booking-status`, `booking-transition`, `booking-reschedule`: conflict-safe, status-safe, versioned |
| Money | `stripe-connect-onboard`, `payment-intent-create`, `stripe-webhook`, `refund-request`, `manual-payment-record`: server pricing, signed provider events, ledger reconciliation |
| Calendar | `calendar-google-connect`, `calendar-google-callback`, `calendar-sync-settings`, `calendar-sync-run`, `calendar-ics-feed`, `calendar-ics-rotate`: OAuth, outbound event mapping, revocable ICS |
| Clients | `client-import-preview`, `client-import-commit`, `account-export`, `account-delete-request`: consent and tenant safety |
| AI | `growth-opportunities-list`, `growth-opportunity-generate`, `outreach-approve`, `outreach-send`: explainable, approved, consented |
| Business | `wallet-card-create`, `google-presence-status`, `notification-dispatch`: real fallback and capability checks |
| Billing | `subscription-checkout`, `subscription-portal`: plan snapshot and webhook-driven state |
| Workers | `job-dispatch`, `job-worker`: leased, retriable, idempotent jobs |

**Contract test template:** valid request → expected DTO; missing/expired auth → 401; wrong tenant → 403/404; invalid payload → 422; conflict → 409; replay → same logical result; upstream timeout → retriable failure; database writes + outbox atomic; logs contain request ID but no sensitive token.

## 7. Required schema migration sequence and database proof
Migrations `0001`–`0022` are specified in phases. Engineers must produce ordered SQL with FKs, check constraints, enum/check status guards, unique keys, tenant-aware indexes, timestamps and RLS policies. SQL files must be executable against empty local Supabase and forward-migrate a populated staging database. Each migration requires a DB test covering ownership, invalid data and important invariants. `supabase db reset` must recreate a deterministic fixture: two artists in separate tenants, two hair services, two locations with distinct rules, three clients with consent states, instant/request bookings, simulated payment and calendar connections, and a growth opportunity. Never seed real client PII or provider credentials.

**RLS matrix to prove:** owner read/write own business; other artist denied; anonymous only published public projections; guest appointment token scoped to one booking; service worker only narrow server-side pathways; storage access matches portfolio publication; support access is audited and constrained. For each table record policy names, SQL test, and role result in `docs/security/rls-matrix.md`.

## 8. Required end-to-end acceptance scenarios (no release without all)
- [ ] UAT-01: New hairstylist signs up, creates profile and hair services, publishes showcase without Stripe; public page renders SEO/social metadata.
- [ ] UAT-02: Guest uses Book This Look, selects eligible service/location, pays required deposit, receives correctly confirmed instant booking; artist sees it.
- [ ] UAT-03: Artist works in two salons, one request-to-book; guest sees pending, artist confirms only after external verification; never false instant confirmation.
- [ ] UAT-04: Two customers concurrently attempt same slot; exactly one authoritative reservation; retries don't duplicate.
- [ ] UAT-05: Artist imports clients with dedupe and consent; unauthorized cross-tenant read/write and invalid import blocked.
- [ ] UAT-06: Stripe sandbox deposit + remaining balance + refund reconcile; salon-collected/cash/Zelle reported separately with no platform processor fee.
- [ ] UAT-07: Google Calendar appointment create/reschedule/cancel sync; Apple subscribed feed includes correct events, privacy, rotation and revocation.
- [ ] UAT-08: Artist receives evidence-backed rebooking opportunity, approves outreach; revoked consent prevents send; replay does not duplicate.
- [ ] UAT-09: Artist uses QR/share card, Google presence fallback, PWA install, notifications with unsupported-browser fallback.
- [ ] UAT-10: Plan entitlement enforcement holds at API boundary; subscription change/failed webhook state consistent.
- [ ] UAT-11: iOS Safari, Android Chrome, 360px viewport, accessibility and reduced-motion checks pass; no broken mobile navigation.
- [ ] UAT-12: Provider outages, token expiry, queue retry, job dead-letter, backup/restore and deployment rollback tested.

## 9. Pull request and session handoff templates
### PR checklist
```md
## Phase / requirement IDs
## User-visible behavior implemented
## Files created/modified (actual vs prescribed)
## Database migrations + RLS tests
## API contracts + failure codes
## Commands executed and results (paste evidence)
## Staging URL + demo screenshots/video
## Security/privacy/accessibility/performance checks
## Remaining blockers, decisions, deviations
## Reviewer acceptance (not self-certified)
```
### Codex task prompt template
```md
You are implementing MOVA phase PXX, tasks PXX-Tnn through PXX-Tmm only.
Read AGENTS.md, docs/product/PRD_BASELINE.md, docs/engineering/IMPLEMENTATION_PLAN.md,
PHASE_STATUS.md, REQUIREMENTS_MATRIX.csv, and DECISION_LOG.md first.
Before coding: list precise file changes, mapped requirements, tests, and blockers.
Implement full vertical behavior (UI -> validated backend -> DB -> audit/events), not mock completion.
Run prescribed checks and all previously accepted critical-path regressions.
After coding: return diff summary, exact test commands/results, screenshots/staging proof,
requirement matrix updates, decision requests, and phase gate readiness.
Do not advance phase, change business rules, activate live payments/outreach,
or deploy production without explicit approval.
```

## 10. Change control and anti-drift checks
- **Scope diff:** At every PR, compare delivered features to F01–F12 and the phase file manifest. Newly introduced features need a change request; omitted requirements remain OPEN.
- **No mock completion:** Production UI must not silently show fake clients, payments, appointment confirmations or AI predictions. Demo fixtures only in seeded/test environment.
- **No false green:** If an external provider credential, approval or contract is unavailable, integration status = BLOCKED and feature flag = OFF. Sandbox implementation is evidence, not production completion.
- **Architecture freeze:** React/Vite PWA + Vercel + Supabase. Alternative hosting/framework/DB requires owner-approved ADR.
- **Contract freeze:** Every API/schema change updates typed contract, migration, tests, OpenAPI and requirement traceability in same PR.
- **Design freeze:** Review screenshots against approved Mova mockup and hair-first examples; no generic SaaS substitution.
- **Review cadence:** Phase kickoff approval, PR review for each vertical slice, phase gate approval, final owner UAT/GO. No unchecked bulk-completion commits.
- **Auditability:** Commit evidence paths and versioned docs; keep provider tokens, customer PII and screenshots with sensitive data out of Git.

## 10A. Mandatory bilingual and acquisition release gates
- [ ] F13: all artist/guest critical workflows and transactional templates in `en-US` and `es-US`; Spanish financial/consent copy human-reviewed; locale independent and persisted; no critical fallback; mobile and screen-reader tests pass.
- [ ] F14: bilingual production marketing, free calculator, live consented waitlist, qualified attribution, SEO crawlability, canonical/hreflang/sitemap and privacy tests pass. The static acquisition preview is **not** an implementation substitute.
- [ ] Extend QA case CSV beyond the prior 179 baseline, give each new case a stable ID and priority, regenerate counts, trace to code/test/evidence, and pass every new P0. No invented case totals.
- [ ] Confirm $200 campaign is an optional product-owner-approved marketing experiment, not a build dependency or engineering spend authorization.
- [ ] Record all A-01–A-15 decisions and truthful provider fallbacks. Do not mark blocked production integrations as done.

## 11. Final product-owner signoff record
| Field | Required value |
|---|---|
| Release version and Git SHA | ______ |
| Staging URL / evidence manifest | ______ |
| F01–F12 acceptance coverage | ______ / ______ (must be 100% or explicitly waived) |
| Security and privacy review | APPROVED / BLOCKED |
| Stripe, consent, AI, calendar, Google and wallet integration decisions | Approved or explicitly disabled with agreed scope |
| P0/P1 defects | 0 open |
| Final UAT reviewer | ______ |
| Decision | **GO / NO-GO** |
| Product-owner signature / date | ______ |

**Important:** An integration or requirement left blocked cannot be counted as fully built. The product owner may approve a reduced-scope release only through an explicit, versioned scope change; Codex may not reclassify MVP requirements as optional.
