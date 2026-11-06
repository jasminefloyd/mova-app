# Mova implementation plan for AI engineers

> **This is an extract** of `docs/product/ENGINEERING_SPEC.md` §13 (delivery plan) and §16 (first instruction to Codex), copied verbatim for convenience.
> The full spec is the contract: requirements (§1), screens (§2), architecture (§3), data model (§4), rules (§5), functions (§6), integrations (§7),
> AI (§8), security (§10), testing (§14) and release (§15). **If this extract and the spec ever differ, the spec wins.** Regenerate this file whenever the spec changes.
>
> Companion documents: design handoff `docs/design/`, QA strategy and cases `docs/qa/`, operating rules `AGENTS.md`.

## 13. Delivery plan for AI engineers

### 13.1 Operating protocol (paste into root `AGENTS.md`)
1. At session start read `docs/product/ENGINEERING_SPEC.md` (this file), `docs/product/MASTER_BLUEPRINT.md`, `docs/engineering/PHASE_STATUS.md`, `REQUIREMENTS_MATRIX.csv`, `DECISION_LOG.md`, and open `CHANGE_REQUESTS.md`. Confirm the current phase and approvals.
2. Work one phase and one vertical slice at a time (UI → validated function → DB → events → tests). Never start a later phase to hide a missing dependency.
3. Before edits: list intended files, requirement IDs, tests, risks, blockers. After edits: actual files, commands and results, screenshots, deviations, next action.
4. `DONE` requires passing tests, local phase integration evidence, traceability and reviewer acceptance. `BLOCKED` is never `DONE`. No `test.skip` on critical paths. Production-host verification remains a P18 activity after written GO.
5. Mocks only in tests/sandbox, visibly labelled. No fake data in production UI. No simulated provider success.
6. No secrets in Git; service-role never in browser; RLS on every tenant table with negative tests.
7. No production deploy, live payments, live messaging, AI enablement, or business-rule change without recorded approval.
8. Recover state from committed docs after any context reset; end every session by updating `PHASE_STATUS.md`.
9. Ambiguity → decision request with a recommended safe default; do not invent behaviour.
10. Re-run all previously accepted critical-path tests at every phase.
11. Match the design canvas. If a screen in §2.4 lacks an approved design, stop and request it.

**Traceability CSV columns:** `requirement_id,spec_section,acceptance_criterion,phase_id,screen_ids,implementation_files,migration_or_function,test_files,phase_evidence,status,reviewer,approval_date` — one row per AC (`Fnn-ACnn`), per D-xx, per A-xx, per T-xx, and per nonfunctional target.

**Standard phase gate:** all checklist items done; `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; `supabase db reset` + DB tests green; browser E2E against the local app and local Supabase instance proves real persisted success and failure paths; tenant/privacy/idempotency/money invariants tested; new endpoints documented with schemas, auth class, errors, rate limits; matrix updated; security scan, a11y smoke, visual regression; reviewer sign-off. No hosted staging environment is used. Production-host verification occurs at P18 after written GO and is not a prerequisite for earlier phase completion.

### 13.2 Phase map (supersedes v1 numbering)

| Phase | Name | Features | Depends on | Approvals needed to *finish* (build may proceed behind flags) |
|---|---|---|---|---|
| P00 | Contract lock & bootstrap | all | — | — |
| P01 | App shell, environments, Supabase infra, i18n runtime | F11, F13 | P00 | — |
| P02 | Design system & navigation | D-15, F13 | P01 | Design sign-off (G2a) |
| P03 | Identity, tenancy, onboarding, profile photo | F01 | P02 | — |
| P04 | Showcase (Looks/Services), services & deposits, portfolio, SEO | F02, F03 | P03 | — |
| P05 | Locations, hours, availability engine | F03 | P04 | — |
| P06 | Booking lifecycle, calendar UI, requests, manage links, running late | F04 | P05 | §2.4 cancel/reschedule designs |
| P07 | Clients, consent, import, client notes & visits | F05, F17 | P06 | A-27 (sensitive notes) |
| P08 | Money: Stripe, deposits, ledger, Get paid (pay links/QR), recorded methods | F06, F23 | P06 | A-02, A-16 |
| P09 | Calendar sync | F07 | P06 | A-10 |
| P10 | Client identity, sign-in, profile, client card, wallet, QR scan | F15, F16, F10 | P06, P08 | A-18, A-19, A-06 |
| P11 | Messaging foundation, notifications, push, sending identities | F11 | P07, P10 | A-03, A-24, A-09 |
| P12 | AI Revenue: hub, forecast, rebooking pipeline, autopilot, templates, win-back, seat filler | F08, F18, F19 | P08, P11 | A-04, A-21, A-22, A-28 |
| P13 | AI Concierge | F22 | P11, P12 | A-04, A-23, A-25, A-30 |
| P14 | Reports, reputation & reviews, Google presence | F20, F21, F09 | P08, P11 | A-05, A-20, A-29 |
| P15 | Plans, entitlements, billing, analytics | F12 | P08–P14 | A-01, A-26 |
| P16 | Security, privacy ops, reliability, observability | all | P15 | A-08 |
| P17 | Full regression, accessibility, performance, UAT, acquisition launch readiness | all, F14 | P16 | A-07, A-12, A-14, A-15 |
| P18 | Owner sign-off & controlled release | all | P17 | **GO** |

F13 (i18n) and F14 (acquisition) run continuously from P01/P02; acquisition marketing pages may be built in parallel by a separate slice after P02.

### 13.3 Phase checklists
Each phase lists key files (in addition to tests and docs), tasks and acceptance. File paths follow §3.2; create tests alongside.

**P00 — Contract lock & bootstrap**
Files: `AGENTS.md`, `README.md`, workspace config, `.env.example`, `docs/product/{ENGINEERING_SPEC.md,MASTER_BLUEPRINT.md}`, `docs/engineering/{BASELINE_MANIFEST.md,PHASE_STATUS.md,REQUIREMENTS_MATRIX.csv,DECISION_LOG.md,CHANGE_REQUESTS.md,TEST_EVIDENCE.md,RELEASE_ACCEPTANCE.md,SALES_PROMISES_MATRIX.md,SCREEN_INVENTORY.md}`, `docs/decisions/ADR-0001…0003`, `scripts/verify-phase.mjs`, CI.
- P00-T01 Repo, protected main, PR policy, pinned Node/pnpm.
- P00-T02 Copy spec; record SHA-256.
- P00-T03 Transcribe D-01–D-26 and A-01–A-30 with status.
- P00-T04 Matrix rows for every F01-AC… through F23-AC… and T01–T60.
- P00-T05 `SCREEN_INVENTORY.md` mapping canvas files 01–45 → routes → components → ACs.
- P00-T06 Verify script rejects missing evidence/approvals; CI wired.
- P00-AC01 clean install deterministic; AC02 hash recorded; AC03 no approval self-resolved; AC04 screen inventory complete (51 artboards accounted for, 15 marked TABLED).

**P01 — Shell, environments, infra, i18n runtime**
Files: `apps/web/*` base, `src/app/{ArtistShell,PublicShell,ClientShell,OnboardingShell}.tsx`, `src/i18n/*`, `packages/contracts/src/{index,errors,api,enums,locale}.ts`, `supabase/config.toml`, workflows, `docs/operations/{environments,secrets}.md`.
- P01-T01 Strict TS, Router, TanStack Query, Zod, Tailwind with tokens.
- P01-T02 Separate shells and query caches for artist vs client.
- P01-T03 PWA with asset-only caching; private APIs never cached.
- P01-T04 Local development + production Supabase/Vercel configuration; isolated secrets; no hosted staging environment. Production-host verification is deferred to P18 after written GO.
- P01-T05 Envelope, request IDs, error boundary, redacted logging.
- P01-T06 i18n runtime en-US/es-US; locale persistence artist vs guest; `check-locales` in CI.
- P01-AC01 build/test/smoke green; AC02 PWA installs (Android/desktop) and iOS guidance; AC03 no private API in SW cache; AC04 locale switch before login persists.

**P02 — Design system & navigation**
Files: `packages/design-tokens/src/*`, `src/components/*` (§2.5), `src/app/TabBar.tsx`, visual baselines.
- P02-T01 Tokens incl. derived ink/line tokens; fonts self-hosted or Google Fonts per licence.
- P02-T02 Components with all states and a11y.
- P02-T03 **Five tabs: Home, Calendar, Clients, AI Revenue, Reports**; Settings via Home avatar.
- P02-T04 Sheets with focus trap; toggles as real checkboxes; status chips with icon+text.
- P02-T05 Visual regression baselines from canvas for shells and components at 360/390/430.
- P02-AC01 component tests; AC02 no horizontal overflow at 320; AC03 owner approves visual baseline (G2a); AC04 tab bar keyboard/screen-reader pass.

**P03 — Identity, tenancy, onboarding, photo**
Migrations 0001–0003. Functions `publish-showcase`, `photo-upload-url`, `photo-process`. Screens 01, 02, 02b, 05, 06 (05 skeleton until P08).
- P03-T01 Tenancy + memberships + RLS helpers.
- P03-T02 Email auth, verification, session, logout.
- P03-T03 Handle claim transactional with reserved list.
- P03-T04 Onboarding progress persistence; skip rules.
- P03-T05 Photo pipeline (crop UI, variants, EXIF strip); "Later" nudge.
- P03-T06 Publish independent of booking; draft privacy.
- ACs: F01-AC01…AC06.

**P04 — Showcase, services & deposits, portfolio, SEO**
Migration 0004. Functions `public-artist` (tabs), portfolio CRUD. Screens 03, 23, 24, Settings › Services/Portfolio (owner-approved derived references in `docs/design/screens/`).
- P04-T01 Services with deposit fields + location overrides.
- P04-T02 `packages/domain/deposit.ts` + table tests.
- P04-T03 Portfolio uploads, alt text, ordering, publish, service links.
- P04-T04 Looks/Services tabs; Book this look; deposit text from server.
- P04-T05 SSR on Vercel per ADR-0003; OG/canonical/hreflang, sitemap and robots. Emit reciprocal `en-US`/`es-US` alternates at `?locale=en-US` / `?locale=es-US`; both canonicalize to `/a/:handle` per F02.
- P04-T06 Rating slot wired to F21 projection (hidden until available).
- ACs: F02-AC01…AC05, F03-AC01.

**P05 — Locations & availability**
Migration 0005. Function `availability-search` (days + groups). Screens 04, 19.
- P05-T01 Locations with type, mode, ownership, collector, colour index, client details, encrypted door code.
- P05-T02 Hours, exceptions, policies (lead, horizon, buffer, cancellation, request expiry).
- P05-T03 Availability engine with DST tests; request-mode labelling.
- ACs: F03-AC02…AC05.

**P06 — Booking lifecycle**
Migrations 0007 (+ reservations exclusion). Functions `booking-create|status|transition|reschedule`, `running-late-send` (stub transport until P11), request expiry job. Screens 07 (today/coming up portions), 08, 09, 10, 25, 26 (guest path), 28 (status without wallet), 44, cancel/reschedule (§2.4).
- P06-T01 State machine + events + outbox.
- P06-T02 Date-first picker grouped by location.
- P06-T03 Holds, deposits requirement (payment wiring P08), idempotency.
- P06-T04 Request review with expiry and client-locale notices.
- P06-T05 Manage link: view, .ics, reschedule, cancel per policy.
- P06-T06 Cancel/no-show emits `slot.opened`.
- P06-T07 Running-late sheet and API.
- ACs: F04-AC01…AC08.

**P07 — Clients, consent, import, notes**
Migrations 0006, 0008. Functions client CRUD, consents, import, `client-notes`, `visit-notes`, `before-you-start`. Screens 11, 12, 12b, 12c, 13; Before you start on 09.
- P07-T01 Clients + consent purposes (§5.5) with evidence.
- P07-T02 Import preview/dedupe/commit idempotent.
- P07-T03 General notes with categories, pin, sensitive encryption.
- P07-T04 Visit notes with private media, show-next-visit.
- P07-T05 Export/delete hooks for notes.
- ACs: F05-AC01…AC05, F17-AC01…AC04.

**P08 — Money & Get paid**
Migration 0009. Functions Stripe set, `manual-payment-record`, `paylink-create|redirect`, `refund-request`, webhooks. Screens 05, 17, 18, 26 (deposit), 09 payment section.
- P08-T01 ADR-0007; Connect sandbox; Checkout Sessions for deposit and balance.
- P08-T02 Ledger postings per §5.1; fee snapshot.
- P08-T03 Pay link via text and QR; single active link; expiry.
- P08-T04 Recorded methods (cash, other, Zelle-recorded) with "who received it".
- P08-T05 Money screen reconciliation; estimate labelling.
- P08-T06 `zelle` flag; removal path verified.
- ACs: F06-AC01…AC03, F23-AC01…AC04, v1 T07–T09.

**P09 — Calendar sync**
Migration 0010; v1 P09 tasks unchanged. Screen 20. ACs per v1 + T10, T11.

**P10 — Client identity, card, wallet, QR scan**
Migrations 0011–0012. Functions `otp-*`, `customer-*`, `client-card-token`, `wallet-*`, `scan-landing`. Screens 26 (sign-in link, save profile), 27, 28 (card + wallet), 29, 30, 21.
- P10-T01 ADR-0004 identity model; Supabase role claims; separate client shell.
- P10-T02 OTP flows with rate limits.
- P10-T03 Linking rules §5.3; duplicate suggestions to artist.
- P10-T04 Client profile, per-artist consents, delete profile.
- P10-T05 Client card image + QR; wallet passes behind flags (ADR-0008).
- P10-T06 Show my QR (21) and scan landing (30) with traffic event.
- ACs: F15-AC01…AC06, F16-AC01…AC05, F10-AC01…AC02.

**P11 — Messaging foundation**
Migration 0013. Functions `messaging-*`, `missed-call-webhook`, `sending-identity-provision`, notification dispatch. Settings › Language & notifications (§2.4).
- P11-T01 ADR-0005; SMS and email adapters with sandbox.
- P11-T02 `canSend` (§5.5) enforced in one place; all senders call it.
- P11-T03 STOP/HELP, suppressions, delivery receipts, cost metering.
- P11-T04 Transactional templates EN/ES (confirmations, reminders, changes, running late, request outcomes).
- P11-T05 Web push + in-app inbox + preferences.
- ACs: F11 (v1) + T21–T24.

**P12 — AI Revenue Center**
Migrations 0014–0015, 0018 (forecast part). Functions autopilot, templates, pipeline, win-back, slot-*, forecast, social image. Screens 07 (Needs you slot, KPI hooks), 14, 31, 31b, 31c, 31d, 32–36.
- P12-T01 Cadence engine + predictions + pipeline.
- P12-T02 Templates with versioning, approval, pause-on-edit, EN/ES.
- P12-T03 Autopilot planner + decisions log + caps + quiet hours (flag A-21).
- P12-T04 Win-back manual send.
- P12-T05 Seat filler: triggers, dedupe, selection, copy (deterministic, optional AI), approval, waves, claim page, fill/expiry, just-taken, results.
- P12-T06 Social image + share sheet + record.
- P12-T07 Forecast engine + hub tiles.
- ACs: F08-AC01…AC08, F18-AC01…AC08, F19-AC01…AC04.

**P13 — AI Concierge**
Migration 0016. Functions `concierge-*`, `conversations`, `quote-respond`, `handoff-resolve`, `instagram-webhook`, `web-chat`. Screens 40–43, 45, web chat widget, Home Needs you items.
- P13-T01 ADR-0006; AI adapter, prompts (EN/ES), tools with policy checks.
- P13-T02 Channel adapters: SMS, missed-call text-back, web chat; Instagram behind A-23.
- P13-T03 Knowledge editor (FAQs, prep, location details, tone).
- P13-T04 Handoffs, quote extraction and quote card, exception decide sheet.
- P13-T05 Artist takeover, per-conversation AI toggle, global pause.
- P13-T06 Evaluation harness (§8.4) in CI with report.
- ACs: F22-AC01…AC08.

**P14 — Reports, reputation, Google presence**
Migrations 0017, 0018. Functions `reports-summary`, `track`, review functions, `google-reviews-sync`. Screens 07 KPI strip, 37, 38, 39, showcase rating, Settings › Reviews & Google.
- P14-T01 ADR-0009 rollups; nightly + incremental.
- P14-T02 Traffic tracking without PII; source classification.
- P14-T03 Reports tiles + charts with table views.
- P14-T04 Review requests, form, moderation, replies, report; public display flag A-20.
- P14-T05 Google presence guidance; reviews ingest behind flags.
- ACs: F20-AC01…AC04, F21-AC01…AC05, F09 (v1).

**P15 — Plans, entitlements, billing, analytics**
Migration 0019. v1 P12 tasks plus new entitlement keys (F12) and message/AI metering hooks. Screen 22. ACs v1 + T15.

**P16 — Security, privacy, reliability**
v1 P13 tasks plus: RLS matrix §4.4 full proof; OTP/token abuse tests; webhook replay tests for every provider; retention jobs; export/delete for artists and clients; DR rehearsal; alerts §12.

**P17 — Regression, accessibility, UAT, launch readiness**
v1 P14 tasks plus: UAT-G…UAT-M (§14.3); AI evals re-run; Spanish human review sign-off (A-12); acquisition site production readiness (F14); confirm no TABLED or OFF feature appears in UI or copy; Zelle decision executed.

**P18 — Owner sign-off & controlled release**
v1 P15 tasks unchanged. Feature flags at launch reflect approval status in §0.5.

## 16. First instruction to Codex

```text
You are implementing Mova from docs/product/ENGINEERING_SPEC.md (v2.2).
Do not generate features in bulk. First:
1. Create the repository scaffold and all P00 files listed in §13.3.
2. Write docs/engineering/SCREEN_INVENTORY.md mapping the 51 canvas artboards to
   routes, components and acceptance criteria (screen 15 is TABLED).
3. Populate REQUIREMENTS_MATRIX.csv with one row per F01–F23 AC, D-01–D-26,
   A-01–A-30 and T01–T60.
4. Draft ADR-0001, ADR-0002 and ADR-0003 for owner review.
5. List every approval in DECISION_LOG.md with status OPEN unless recorded otherwise.
Then implement P01 and P02 only, with tests, a preview deployment, mobile
screenshots compared with the canvas, and a completion report. Stop at gate G2a
for product-owner design approval before starting P03.
Never invent product decisions, mock production success, bypass RLS,
enable live payments/messaging/AI, or deploy production without explicit sign-off.
```
