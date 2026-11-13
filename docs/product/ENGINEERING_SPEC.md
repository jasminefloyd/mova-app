# MOVA — Engineering Handoff & End-to-End Implementation Specification
**Version:** 2.3 · **Date:** 2026-11-05 · **Status:** Normative implementation contract. Product-owner approvals listed in §0.5 remain mandatory before any affected capability goes live. · **Starting state:** empty repository

> **Mission.** Build a production-quality, mobile-first Progressive Web App that gives independent hairstylists a business that moves with them: a portable public showcase, location-aware booking, client relationships, honest money tracking, an AI Revenue Center, an AI Concierge, and reporting — in US English and US Spanish. **Brand:** `mova.` — *Your business moves with you.*
>
> **Instruction to AI engineers (Codex and humans).** This document is the single engineering source of truth. Implement its contracts, invariants and acceptance criteria. Where an item is marked **APPROVAL REQUIRED** or depends on an open approval (§0.5), build it behind a feature flag that defaults **OFF**, with the documented fallback working, and do not represent it as live. Never invent business rules, provider capabilities, prices, or approvals. Never deploy to production without the signed GO in §15.

---

## 0. Document control

### 0.1 What this document replaces

| Document | Status after v2.0 |
|---|---|
| `MOVA_PRD_Technical_Architecture_Engineering_Handoff_v1.md` (v1.1) | **Superseded** by this document. Keep in `docs/product/archive/` for history only. |
| `MOVA_Codex_File_by_File_Implementation_Plan_v1.md` (v1.1) | **Partially superseded.** Its operating protocol (§3), phase-gate checklist, PR/handoff templates and anti-drift rules remain in force and are restated in §13. Its phase numbering, file manifests and tab names are replaced by §13 of this document. Where the two disagree, this document wins. |
| `MOVA_Master_Product_Business_Blueprint_v1.md` | Remains the business-intent source. Sections on navigation, AI autonomy, client accounts, reviews, concierge and payments are **out of date**; the decisions in §0.3 override them until the blueprint is reissued as v2. |
| Design canvas **"Mova App Screens"** (Design artifact, 51 artboards) | **Normative UI reference** for layout, hierarchy, copy intent and states shown. Sample names, prices and figures in it are illustrative and must never be hardcoded. |
| `MOVA_QA_Automated_Test_Strategy_v1.md` + `MOVA_QA_TEST_CASES.csv` | Out of date. Must be regenerated against §14 of this document (next deliverable). The old 179-case count is not exhaustive and must not be quoted. |
| `MOVA_Acquisition_Launch_v1/` | Static, English-only preview. Not an implementation. Spanish pages and hreflang are required by F14. |

**Repository placement:** copy this file unchanged to `docs/product/ENGINEERING_SPEC.md` and record its SHA-256 in `docs/engineering/BASELINE_MANIFEST.md` (P00-T02).

### 0.2 Conflicts in the v1 package and how they are resolved

| ID | v1 conflict | Resolution (binding) |
|---|---|---|
| R-01 | PRD used work packages WP00–WP12; Codex plan used phases P00–P15. | **Phases P00–P18 in §13 are canonical.** WP numbering is retired. |
| R-02 | PRD layout `packages/domain` + `packages/api-contracts`; plan layout `packages/contracts` + `packages/config`. | Canonical packages: `packages/contracts` (Zod DTOs, enums, error codes, analytics event schemas), `packages/domain` (pure business rules, no I/O), `packages/design-tokens`, `packages/config` (TS/lint presets). `api-contracts` is retired. |
| R-03 | ADR named `ADR-001-web-rendering` vs `ADR-0003-public-rendering`. | Four-digit ADR numbering. Canonical register in §0.6. |
| R-04 | Plan listed approvals A-01–A-11; PRD listed A-01–A-15. | Full register A-01–A-30 in §0.5. |
| R-05 | Plan MVP definition and audits said "F01–F12". | V1 scope is **F01–F23** (§1). Every audit, matrix and signoff covers all of them. |
| R-06 | Analytics module path `packages/domain/analytics.ts`. | Event schemas live in `packages/contracts/src/analytics.ts`; derivation logic (if any) in `packages/domain`. |
| R-07 | Five tabs "Home, Calendar, Clients, Growth, Business". | Five tabs **Home, Calendar, Clients, AI Revenue, Reports** (D-15). Business settings move behind the Home avatar. |
| R-08 | Deposit policy lived on `location_policies`. | Deposit is configured **per service** (D-18), applied only where the artist collects payment. |
| R-09 | "No autonomous AI sends" (v1 F08, Appendix A). | Superseded for **rebooking reminders and approved-template slot offers only**, under the rule-based autopilot in F08/F18, pending approval A-21. All other AI-originated outbound messages still require per-message approval. |
| R-10 | Customers had no accounts; guest tokens only. | Optional **Mova-wide client profile** (F15). Guest booking remains fully supported. |
| R-11 | Tap to Pay and Zelle processing in v1 lists. | Tap to Pay deferred to **V1.1** (needs native shell, A-17). Zelle is **conditional** on a workable integration (A-16); until then it is a recorded-only method; if no integration is approved before launch, Zelle is removed. |

### 0.3 Locked decisions

D-01–D-14 from v1 remain locked except where amended below (amendments are marked).

| ID | Decision |
|---|---|
| D-01 | Primary ICP: independent hairstylists (booth/chair renters, suite renters, commission stylists who control some client relationships, multi-location stylists, stylists changing salons). Secondary: comparable independent beauty pros. Schemas must not hardcode hair as the only profession. |
| D-02 | One mobile-first web app / PWA: React + TypeScript + Vite on Vercel. **Amended:** a thin native shell is permitted in **V1.1 only** for Tap to Pay (A-17). No other native code in V1. |
| D-03 | Supabase: Postgres, RLS, Auth, Storage, Edge Functions, scheduled triggers, durable jobs. |
| D-04 | **Amended by D-15.** Public showcase and booking work without an account. |
| D-05 | V1 pillars: showcase; multi-location calendar; booking and payment orchestration; client relationships and notes; AI Revenue Center (rebooking, seat filler, win-back, forecast); AI Concierge; reports and reputation; Google presence; wallet cards; bilingual acquisition. |
| D-06 | Instant booking only where Mova controls the inventory; request-to-book where a salon must verify. A request is never shown as confirmed. |
| D-07 | **Amended.** V1 payments: Stripe-processed card / Apple Pay / Google Pay / other Stripe-supported wallets via online checkout and **pay links** (sent by text or shown as a QR code); manually recorded **cash** and **other**; **Zelle** conditional (A-16); salon-collected tracked only. No Mova fee on non-Mova-processed money. |
| D-08 | **Amended 2026-11-13:** Free $0 + 1.5%, Pro $19 + 1.0%, AI + Growth $39 + 0.75% on Mova-processed payments; Stripe processing extra. No Mova fee on cash, Zelle or salon-collected payments. |
| D-09 | Google Calendar outbound sync and Apple private subscribed `.ics` feed. No inbound availability blocking in V1. |
| D-10 | Locked visual identity: forest `#18392F`, botanical `#264E3E`, sage `#8BA990`, mint `#C9E6D4`, peach `#E7C3AA`, ivory `#F7F5EF`; Manrope (display) + DM Sans (UI). |
| D-11 | No production launch without the product owner's written GO. |
| D-12 | US bilingual: `en-US` default, `es-US` full V1; artist and client locales independent. |
| D-13 | Bilingual acquisition surfaces (marketing site, calculator, waitlist, attribution). Paid ad test is a proposal, not spend. |
| D-14 | Logo is a concept until vector, trademark and domain clearance (A-07, A-15). |
| D-15 | **New.** Artist bottom tabs: **Home, Calendar, Clients, AI Revenue, Reports.** "AI Revenue" is a working label (screen title "AI Revenue Center"); the name lives in one i18n key so it can change. **Settings** (former Business tab) opens from the artist's photo on Home. Money is reached from Reports and Settings. |
| D-16 | **New.** One **Mova-wide client profile** per person, usable across every stylist they book with ("My stylists"). Optional, passwordless (one-time code by text or email). Guest booking stays available everywhere. |
| D-17 | **New.** Stylist **client notes are private to the stylist** (tenant data). Neither the client nor any other stylist can read them, including through the Mova-wide profile. |
| D-18 | **New.** Deposits are configured **per service** (none / fixed amount / percent). They are charged only when the booking's location has `payment_collector = artist`. |
| D-19 | **New.** Card payments in V1: Stripe online checkout, pay links by text, and pay-link QR shown at the chair. Tap to Pay is V1.1. |
| D-20 | **New.** Win-back messages are always **manual** (stylist taps Send). |
| D-21 | **New.** Seat filler: stylist **approves each slot text by default**; per-artist autopilot for slot texts is an optional setting (default OFF). Social posts are always shared manually through the device share sheet. |
| D-22 | **New.** Rebooking **autopilot** sends approved templates under stylist-approved rules to consenting clients only (subject to A-21). |
| D-23 | **New.** Reviews come from two sources shown together: **Mova verified-visit reviews** and **Google reviews** (Google ingest conditional on A-05/A-20). |
| D-24 | **New.** AI Concierge acts as the **stylist's** assistant (not a salon receptionist): answers on Instagram, a Mova business text number, missed-call text-back and page chat; always discloses it is AI; quotes, exceptions and complaints always go to the stylist. Voice answering is out of V1. |
| D-25 | **New.** Marketing campaigns beyond rebooking/slot offers (canvas screen 15) are **tabled**. Do not build screen 15. |
| D-26 | **New.** Home is the stylist's at-a-glance view: KPI strip (this week's revenue, % of hours booked, rating), "Needs you", today, coming up. |

### 0.4 Status vocabulary
**LOCKED** = build it. **CONDITIONAL** = build adapter + fallback; live only after the named approval. **PROPOSED** = configurable default; never hardcode. **DEFERRED** = do not build in V1. **TABLED** = do not build; will be redesigned.

### 0.5 Approval register (APPROVAL REQUIRED)

No agent may resolve these. Each lives in `docs/engineering/DECISION_LOG.md` with `OPEN | APPROVED | REJECTED | DEFERRED`, owner, date, rationale and impact.

| ID | Decision needed | Blocks | Safe default until approved |
|---|---|---|---|
| A-01 | Plan entitlements, quotas (incl. message credits, concierge volume) | F12, F18, F22 | Owner-approved plan matrix and allowances: `docs/product/PLANS_FEATURES_FEES.md`; feature flags remain subject to platform/provider/safety gates. |
| A-02 | Stripe Connect account type, charge topology, merchant of record, refunds, disputes, negative balances, tax | F06, F23 | Adapter + sandbox only; live processing flag OFF. |
| A-03 | Email and SMS providers, sending limits, cost caps | F11, F08, F18, F22 | Provider adapter with sandbox transport; no live sends. |
| A-04 | AI model vendor(s), evaluation thresholds, spend caps | F08, F18, F22 | Provider-agnostic interface; deterministic baselines; LLM features OFF until eval passes. |
| A-05 | Google Business Profile eligibility and permitted API operations | F09, F21 | Manual booking-link guidance; Google reviews ingest OFF. |
| A-06 | Apple/Google Wallet issuer, certificates, refresh | F10, F16 | QR/share card and "save as image" fallback. |
| A-07 | Domain and trademark ownership remain unverified; owner specified URL shape | F02, F14, F16 | Public `https://mova-beauty.co/a/:handle`; operator `https://ops.mova-beauty.co/:clientID`; admin `https://admin.mova-beauty.co` (no client-facing admin view); clients use the parent domain until custom domains are added. Do not assume ownership or clearance. |
| A-08 | Consent purposes, retention schedule, salon data rights, marketing compliance (TCPA/CAN-SPAM/state law) | F05, F08, F15, F17, F18, F22 | Minimal collection; explicit opt-in per channel and purpose; legal review before live messaging. |
| A-09 | Push notification coverage and channels | F11 | In-app + email; web push where supported. |
| A-10 | Calendar event detail visible to external providers | F07 | Service name only; no client contact data. |
| A-11 | Earnings estimate semantics | F06, F20 | Label as estimate; no payroll/tax claims. |
| A-12 | Human review of Spanish legal/financial/consent copy and AI templates | F13 | Block release of unreviewed critical strings. |
| A-13 | Public rendering (SSR/prerender), canonical, hreflang | F02, F14 | Resolved by owner approval and ADR-0003, 2026-11-05. |
| A-14 | Waitlist privacy, anti-bot, production domain | F14 | No production submissions until verified. |
| A-15 | Final logo vector and usage | Brand | Concept asset only. |
| A-16 | **Zelle integration feasibility** (bank/processor partner, verification method, cost) | F23 | Zelle = recorded-only, labelled. If not approved by P17, remove Zelle from UI and copy. |
| A-17 | **Tap to Pay (V1.1)**: native shell approach, Stripe Terminal, Apple Tap to Pay entitlement | F23 (V1.1) | Not built in V1. Pay-link QR is the in-person path. |
| A-18 | **Mova-wide client identity**: legal model for a platform-level customer account alongside each stylist's client list; data-sharing boundaries | F15, F16 | Build per §5.3 with strict separation; launch flag OFF until approved. |
| A-19 | **Client wallet card** pass design and issuance (extends A-06) | F16 | Save-as-image + QR fallback. |
| A-20 | **Reviews policy**: verified-visit rules, moderation, fake-review policy, display rules (incl. FTC rules on reviews), Google reviews display rights | F21 | Mova reviews collected but hidden from public until approved; Google ingest OFF. |
| A-21 | **Rebooking autopilot** (sending approved templates without per-message approval) | F08 | Autopilot master switch hidden; per-message approval mode only. |
| A-22 | **Seat-filler messaging volume and cost** (waves, credits per plan) | F18 | Waves capped by config; sandbox only. |
| A-23 | **Instagram messaging**: Meta app review, permissions, messaging-window policy | F22 | Instagram channel OFF; other channels work. |
| A-24 | **US business texting registration** (A2P 10DLC or toll-free verification), per-artist vs shared numbers, number porting | F11, F18, F22 | Sandbox numbers only; no live texting. |
| A-25 | **AI Concierge** safety review, evaluation set, escalation rules, disclosure copy | F22 | Concierge OFF in production; local integration with provider test numbers only. |
| A-26 | **Pricing competitiveness** vs incumbents (e.g., flat all-in processing offers) | F12 | Owner approved Free $0 + 1.5%, Pro $19 + 1.0%, AI + Growth $39 + 0.75% on Mova-processed payments; Stripe processing extra. |
| A-27 | **Sensitive client notes** (allergies, sensitivities, photos): retention, export, deletion, encryption | F17 | Encrypt sensitive note fields; default retention TBD; exportable/deletable. |
| A-28 | **Social posting**: V1 = device share sheet only; any direct platform posting later | F18 | Share sheet + image download only. |
| A-29 | **Review request messaging** (purpose classification and frequency) | F21 | Email only, one request per completed visit, opt-out honoured. |
| A-30 | **Concierge business hours / response promises** shown to clients | F22 | No response-time promises in client copy. |

### 0.6 ADR register (create in P00 unless noted)

| ADR | Topic |
|---|---|
| ADR-0001 | Stack and hosting (React/Vite PWA on Vercel; Supabase) |
| ADR-0002 | i18n runtime (`react-i18next` proposed), locale routing, server templates |
| ADR-0003 | Public rendering for SEO/social (SSR or prerender on Vercel), canonical, hreflang — **before P04** |
| ADR-0004 | Customer identity model (Supabase Auth roles, `customer_accounts`, link claiming) — **before P10** |
| ADR-0005 | Messaging architecture (provider, numbers, inbound routing, consent enforcement) — **before P11** |
| ADR-0006 | AI provider abstraction, tool-calling, evaluation harness, cost controls — **before P12** |
| ADR-0007 | Payments topology: Stripe Connect + pay links + QR; Zelle option analysis — **before P08** |
| ADR-0008 | Wallet passes (Apple PassKit web service, Google Wallet) — **before P10** |
| ADR-0009 | Reporting data model (daily rollups vs materialized views) and traffic analytics — **before P14** |
| ADR-0010 | P06 request expiry schedule and outbox handoff — **before P06** |
| ADR-0012 | Extension-free booking concurrency and idempotency — **before P06** |

### 0.7 Change summary v1.1 → v2.0
Navigation changed (D-15); Mova-wide client profile, sign-in, client card and wallet added (F15, F16); client general and per-visit notes added (F17); deposits per service (D-18); date-first booking picker; Looks and Services showcase tabs; QR scan landing; seat filler adapted from the AI Seat Filler brief (F18); AI Revenue Center forecast (F19); Reports tab (F20); reviews and reputation (F21); AI Concierge (F22); Get-paid flows with pay links/QR and conditional Zelle (F23); rebooking autopilot under rules (F08); marketing campaigns tabled; Tap to Pay to V1.1; profile photo step; running-late action.

### 0.8 Approved amendment history
- **v2.1 (2026-11-05):** Owner-approved CR-001 defines the `mova_` prefix for project-created database objects and records the P03/P04 identifier mapping in §4.6. Owner-approved CR-007 replaces hosted staging with local integration evidence for phase completion; production deployment remains prohibited until written GO under §15. Original v2.0 source hash remains recorded in `docs/engineering/BASELINE_MANIFEST.md`.
- **v2.2 (2026-11-05):** Owner selected SSR on Vercel for public rendering and artist hreflang alternates at `?locale=en-US` / `?locale=es-US`, both canonicalizing to `/artists/:handle` under F02, and approved deriving the Settings › Services and Settings › Portfolio references from the approved design system. No unprefixed PostgreSQL extensions may be installed; handle comparison uses a prefixed normalized-value index, sensitive notes use application-level envelope encryption (A-27), and the booking-overlap concurrency mechanism remains for a P06 ADR. A-07 domain/trademark ownership remains open. See ADR-0003 and CR-002.
- **v2.3 (2026-11-05):** Owner specified `mova-beauty.co` as the parent host, public artist paths at `/a/:handle`, operator paths at `ops.mova-beauty.co/:clientID`, and `admin.mova-beauty.co` as a reserved admin-only host whose product view is not yet defined; no client-facing admin view is exposed. Artist locale alternates use `/a/:handle?locale=en-US` and `?locale=es-US`, both canonicalizing to `/a/:handle`. Custom client domains are deferred; public client-facing routes remain on the parent host. Domain/trademark ownership and DNS control remain unverified under A-07.
- **v2.4 (2026-11-05):** Owner clarified the company homepage is `/`, account creation/sign-in is `/auth`, and the operator URL segment is the client/business ID. The authenticated operator home is `https://ops.mova-beauty.co/{clientID}/`; all operator routes are nested beneath that tenant path. The old `/app/` prefix is removed. Unauthenticated operator access redirects to the parent-domain `/auth` and returns to the requested tenant after authentication.
- **v2.5 (2026-11-06):** Owner requested sequential operator-facing IDs: BID for businesses, CID for clients, and AID for appointments. Rooted Beauty is assigned BID 1 by the backfill ordering. UUIDs remain internal relational and authorization keys. Local migration 0023 and the pending application changes are tracked as CR-008; database behavior is not verified until the migration is applied and tested.

- **v2.6 (2026-11-06):** Owner directed that the temporary coming-soon landing page live at app route `/`, replacing the former “separate site” route assumption for this temporary surface. Its Sign-up and Sign-in actions go to `/auth`; waitlist entries are persisted, no email is sent on submission, and the page displays a saved confirmation. The full company website will replace this temporary page later. A-14 remains open; do not accept production submissions until privacy, anti-bot, and production-domain checks are verified. See CR-009.

---

## 1. Product scope and feature requirements

### 1.1 Problem, users and roles
Independent stylists build a clientele across rented chairs, suites and commission salons, while their booking, client history, payments and portfolio sit in tools the salon controls. Mova gives the stylist a portable identity and operating layer **without** pretending to control salon systems.

| Role | Scope | Rights |
|---|---|---|
| Artist owner | One `artist_business` tenant | Everything for their business: profile, services, locations, clients and notes, money, integrations, AI settings, concierge. |
| Artist collaborator | Future-ready; V1 may ship owner-only | Permission-scoped; no default financial or export rights. |
| Client (signed in) | Their own `customer_account` | Own profile, contact preferences, own appointments across artists, own reviews, wallet card. **Never** stylist notes or another client's data. |
| Guest | Public flows | Published artist info; book; manage one booking via scoped expiring token. |
| Platform support | Restricted support tooling | Time-limited, audited, least-privilege access; no blanket UI access. |
| Worker / service | Background jobs, webhooks | Narrow server-side pathways with service credentials; never in the browser. |

**North-star metric:** completed appointments managed or attributed through Mova per activated artist per month. Supporting KPIs are defined in §11.

### 1.2 Feature catalog (V1 = F01–F23)

| ID | Feature | Status | Canvas screens |
|---|---|---|---|
| F01 | Identity, onboarding, publishing (incl. guided profile photo) | LOCKED | 01, 02, 02b, 03–06 |
| F02 | Public showcase: Looks and Services tabs, Book This Look | LOCKED | 23, 24 |
| F03 | Services (deposits per service), locations, availability | LOCKED | 03, 04, 19 |
| F04 | Booking lifecycle: instant vs request, date-first picker, status, manage | LOCKED | 07–10, 25, 26, 28 |
| F05 | Client directory, consent, CSV import | LOCKED | 11, 13 |
| F06 | Money: deposits, ledger, manual payments, earnings view | LOCKED / A-02 | 17, 18 |
| F07 | Google Calendar outbound, Apple subscribed feed | LOCKED | 20 |
| F08 | Rebooking intelligence and autopilot (rules + approved templates), win-back | LOCKED / A-21 | 32, 33, 34, 35, 36 |
| F09 | Google presence (booking link guidance; API conditional) | CONDITIONAL A-05 | 16 |
| F10 | Artist share card and QR ("Show my QR"); artist wallet pass conditional | LOCKED / A-06 | 21 |
| F11 | PWA, notifications, messaging foundation | LOCKED / A-03, A-09, A-24 | all |
| F12 | Plans, subscriptions, entitlements | PROPOSED / A-01, A-26 | 22 |
| F13 | Internationalization: en-US + es-US | LOCKED | all |
| F14 | Acquisition: bilingual marketing, calculator, waitlist | PARTIAL — owner-directed temporary root page; full acquisition remains P17 | `/` |
| F15 | Mova-wide client profile and sign-in | LOCKED / A-18 | 26, 27, 29 |
| F16 | Client card, wallet pass, QR scan landing | LOCKED / A-19 | 28, 29, 30 |
| F17 | Client notes: general, "Before you start", per-visit notes and photos | LOCKED / A-27 | 09, 12, 12b, 12c |
| F18 | Seat filler (fill open slots) | LOCKED / A-22, A-28 | 07, 31, 31b, 31c, 31d |
| F19 | AI Revenue Center hub and revenue forecast | LOCKED | 14 |
| F20 | Reports dashboard | LOCKED | 07 (KPI strip), 37 |
| F21 | Reviews and reputation | LOCKED / A-20, A-29 | 23, 38, 39 |
| F22 | AI Concierge | LOCKED / A-23, A-24, A-25 | 40–45 |
| F23 | Get paid: pay links, pay QR, Zelle conditional, Tap to Pay V1.1 | LOCKED / A-02, A-16, A-17 | 18 |
| — | Marketing campaigns (screen 15) | **TABLED** | 15 |

Acceptance criteria use IDs `Fnn-ACnn`. Each AC becomes at least one row in `REQUIREMENTS_MATRIX.csv` and at least one automated test.

---

### F01. Identity, onboarding, publishing
**Flow:** sign up (email + password; verify email) → choose app language → artist profile (display name, handle, specialties ≤ 5, bio) → **profile photo step (02b)** → services and deposits → work location(s) → payments (optional, skippable) → preview → publish.

**Rules**
- Handle: normalized to lowercase, pattern `^[a-z0-9-]{3,30}$`, reserved-word list, transactional claim; availability shown inline. Enforce normalized uniqueness with the explicitly named `mova_artist_profiles_handle_lower_uq` unique index on `lower(handle)`; do not install `citext`.
- Onboarding progress persists server-side (`onboarding_progress`) and resumes on any device.
- Photo step: camera or library; client-side crop to circle with zoom; server validates MIME (`image/jpeg|png|webp|heic`→converted), max 10 MB, strips EXIF location, generates 96/256/512 px variants. "Later" skips without blocking publish; Home and Settings keep a nudge until a photo exists.
- Showcase may publish without Stripe, without a bookable location, and without a photo. Booking turns on **per location** only when that location has hours, ≥1 active service and policies.
- Publish requires: display name, handle, ≥1 specialty. Index control "Show my page in search results" defaults ON for published pages, OFF for drafts (drafts always `noindex` and not publicly fetchable).

**Acceptance**
- F01-AC01 Publish succeeds with no Stripe, no location and no photo; Book button hidden until a location is bookable.
- F01-AC02 Reload at any step restores progress and entered values.
- F01-AC03 Handle collision shows inline error; two simultaneous claims → exactly one succeeds.
- F01-AC04 Photo upload rejects non-image and >10 MB; EXIF GPS removed; variants generated; "Later" never blocks.
- F01-AC05 Draft profile returns 404 to anonymous fetch and is excluded from sitemap.
- F01-AC06 Every onboarding screen passes 320/360/390 px layout, keyboard and screen-reader checks in both locales.

### F02. Public showcase (Looks and Services)
**Screens 23, 24.** One canonical artist URL (`/a/:handle`) with a **Looks | Services** toggle (`?tab=services` or `/a/:handle/services`; the canonical stays the base URL).

**Rules**
- Header: cover photo, profile photo (104 px), name, specialties, rating summary (from F21; hidden if fewer than the approved minimum reviews, default 3, or if A-20 not approved), locations, bio, language switch (UI locale only; artist-authored text stays in its original language and is labelled), share.
- **Looks:** published portfolio items with alt text; items mapped to services show **Book this look**, which preselects the service in F04.
- **Services:** active services with duration, price ("from" when location overrides differ), deposit text derived from F03 ("$40 deposit at Studio 9" / "no deposit"), and where it is offered. Each row has **Book**.
- Crawlable server-rendered HTML on Vercel, OpenGraph image, canonical, and hreflang per ADR-0003. Artist locale alternates use `/a/:handle?locale=en-US` and `/a/:handle?locale=es-US`; both have `/a/:handle` as canonical per the single-canonical-artist-URL rule. The Services tab remains a non-canonical view. Artist-authored text remains in its source language when UI locale changes. Marketing pages use the existing `/en/*` and `/es/*` route pairs with reciprocal hreflang. Set the origin from `PUBLIC_BASE_URL`; domain/trademark ownership remains open under A-07.

**Acceptance**
- F02-AC01 Crawler without JS receives name, specialties, services, locations, metadata.
- F02-AC02 Book this look preselects the mapped service; unmapped look opens service choice.
- F02-AC03 Deposit text on Services equals the server-computed deposit for each location.
- F02-AC04 Unpublished portfolio media is not fetchable by URL guessing.
- F02-AC05 Tab switch keeps scroll position per tab and is announced to screen readers.

### F03. Services, deposits, locations, availability
**Screens 03, 04, 19.**

**Services:** name, category, duration, buffer, base price, status; **deposit** `{type: none|fixed|percent, value}`; optional per-location price/duration overrides (`service_locations`).

**Deposit rule (D-18):** `deposit_due = 0` if location.payment_collector ≠ `artist`; else fixed value, or `round_half_up(price × percent)` in minor units, capped at the price. Shown on the showcase, the date-time picker summary, checkout and the appointment.

**Locations:** name, address fields (optional), IANA timezone, type (suite/booth, commission salon, mobile/home), `booking_mode` (`instant` | `request`), `calendar_ownership` (`mova` | `external`), `payment_collector` (`artist` | `salon`), weekly hours, exceptions, lead time, booking horizon, buffer policy, cancellation window, location details for clients and the concierge (parking, entry, door code visibility = "after booking only").

**Availability engine** (`packages/domain/availability.ts`, server-authoritative): slots honour location hours in local time (DST-safe), service duration (with overrides) + buffer, lead time, horizon, exceptions, existing confirmed appointments, active holds, blocked time. For `request` locations, slots are **offered times** (artist's stated hours minus Mova-known commitments) and are never presented as guaranteed.

**Acceptance**
- F03-AC01 Deposit computed server-side; percent rounding test table passes; salon-collected location → $0 deposit.
- F03-AC02 Two locations with different hours return different slots for the same day.
- F03-AC03 DST spring-forward/fall-back days produce correct local times and UTC instants.
- F03-AC04 Inactive service or location cannot be booked via API.
- F03-AC05 Request-mode slots are labelled "Ari confirms" in every client surface.

### F04. Booking lifecycle
**Screens 07–10, 25, 26, 28.**

**Client flow (date first, screen 25):** ordered service summary (from look/service; add another service) → **pick a day** (next N days with open-count; full days disabled for the combined duration) → times **grouped by where the stylist is that day** (each group tagged "Confirmed instantly" or "Ari confirms") → details (26) → combined price and per-service deposit total if due → status (28). Appointment detail, booking manage, Get paid and client visit history show every snapshotted service.

**State machine** (unchanged from v1, extended):
`draft → pending_payment | pending_artist | confirmed`; `pending_payment → confirmed | pending_artist | expired`; `pending_artist → confirmed | declined | expired`; `confirmed → completed | cancelled | no_show`; reschedule is an audited transition preserving identity. Every transition records actor, reason, timestamp, idempotency key, and emits an outbox event.

**Request handling (screen 10):** artist sees request, expiry countdown (default 24 h, configurable), client language, note, location payment collector; actions Accept (choose offered time), Suggest a time, Decline. Client updates go out in the **client's** locale.

**Cancellation/no-show:** artist or client (via manage link / profile) cancels per policy; refunds per F06. Marking no-show or cancelling a confirmed appointment at a Mova-controlled location **emits `slot.opened`** for F18.

**Manage link:** every booking has a scoped token link (`/b/:token`) to view, add to calendar (.ics), reschedule within policy, cancel. Signed-in clients also see it in "My profile".

**Running late (screen 44):** from Home "Now" item or Appointment detail, artist picks 5/10/15/20+ min; Mova texts the next client (transactional purpose) offering to keep or push the time; reminds the artist that salon front desks are not notified automatically.

**Acceptance**
- F04-AC01 Request never displays or sends "confirmed" until artist acceptance.
- F04-AC02 Duplicate submit with same idempotency key → one appointment.
- F04-AC03 Concurrent instant bookings for overlapping time → at most one confirmed.
- F04-AC04 Date-first picker shows only days with ≥1 slot as enabled; groups by location; correct mode tag.
- F04-AC05 Payment-required booking is not confirmed before successful deposit (or is `pending_payment` with expiring hold).
- F04-AC06 Request expiry releases any hold and notifies client in their locale.
- F04-AC07 Cancel/no-show at Mova-controlled location emits exactly one `slot.opened` event.
- F04-AC08 Running-late message uses next appointment, respects quiet hours override for same-day transactional use, and logs delivery.

### F05. Client directory, consent, import
Unchanged from v1 F05 with these additions: filter chips (All, Due to rebook, New, Opted out); consent purposes per §5.5; each client shows linked Mova profile status (linked / not linked) without exposing profile data the client has not shared with this artist.

**Acceptance (in addition to v1):** F05-AC01 Cross-tenant reads denied; F05-AC02 opt-out stops all non-transactional sends immediately; F05-AC03 import preview has no writes; F05-AC04 ambiguous duplicates require explicit Merge / Keep both; F05-AC05 imported contacts default to **no** marketing consent.

### F06. Money: deposits, ledger, manual payments, earnings
**Screens 17, 18.** Ledger categories: service value (gross), Mova-processed, recorded by artist (cash/other/Zelle-recorded), collected by salon (tracked, no fee), platform fee (plan fee on Mova-processed only), processor fees, refunds, **estimated money to you** (labelled estimate; excludes salon payouts and taxes). Immutable, double-entry-style signed entries; refunds are reversing entries; amounts in integer minor units.

**Acceptance:** v1 T07–T09 retained; F06-AC01 money screen components reconcile to ledger sums exactly; F06-AC02 no platform fee on recorded or salon-collected entries; F06-AC03 estimate label present in both locales.

### F07. Calendars
Unchanged from v1 F07 (Google outbound OAuth; Apple private revocable `.ics`; privacy default "service only"; "one way" explanation; no inbound blocking).

### F08. Rebooking intelligence, autopilot, win-back
**Screens 32–36.**

**Cadence model (deterministic, `packages/domain/rebooking.ts`):** for each client × service category, intervals between completed visits. ≥2 intervals → usual window = [P25, P75] of intervals (P50 = "usually every"); 1 interval → window = interval ± 7 days, confidence low; 0 intervals → artist default for new clients (setting, default 6 weeks), confidence low. Confidence: **high** if ≥4 intervals and IQR ≤ 14 days; **medium** if ≥2 intervals; else **low**. Each prediction stores evidence (visit dates, intervals) and `model_version`.

**Pipeline (32):** Due (inside or past window, not booked) → Contacted (message sent) → Rebooked (booking within attribution window, default 14 days after last message) / No reply. Month totals: reminders sent, rebooked, booked value.

**Autopilot rules (34, A-21):** master switch; who (clients with `rebooking_reminders` consent); when (at window start; new clients N weeks after visit); how (email or text, per consent); limits (≤1 per client per 14 days; ≤2 per visit cycle; daily cap 10); quiet hours 8 PM–9 AM **client local time**; stop when booked, STOP reply or opt-out. All values configurable within platform maxima.

**Templates (35):** types `rebooking_reminder`, `slot_offer`, `win_back`. Variables: `first_name`, `service`, `weeks`, `day_time`, `location`, `booking_link`, `artist_name`. EN and ES variants; status `needs_approval | approved | paused`; **editing an approved template pauses it** until re-approved; every outbound text includes opt-out language per A-08.

**Activity log (36):** every decision: Sent, Skipped (reason code), Held (reason + next allowed time), Not delivered (provider error + fix action), Rebooked (attributed value). Exportable CSV.

**Win-back (33, D-20):** clients past window by ≥ 2× usual interval (configurable). Manual send only; optional artist-written offer text; Mova never invents discounts. Opted-out clients shown locked.

**Acceptance**
- F08-AC01 Cadence math matches fixture table (incl. 0/1/2/4+ intervals, IQR edge).
- F08-AC02 No send without matching consent at send time; consent revoked between scheduling and send → skipped with reason.
- F08-AC03 Frequency, per-cycle, daily caps and quiet hours enforced in client timezone.
- F08-AC04 Autopilot OFF → zero automatic sends; per-message approval path still works.
- F08-AC05 Edited template pauses until re-approved; paused template never sends.
- F08-AC06 Booking within attribution window marks Rebooked with value; double attribution impossible.
- F08-AC07 Win-back never sends without a tap; no Mova-generated discount text.
- F08-AC08 Activity log has one row per decision with reason code and consent reference.

### F09. Google presence
v1 F09 unchanged. Settings row "Reviews & Google profile" (16) shows connection status and manual guidance.

### F10. Artist share card and QR
**Screen 21 "Show my QR".** Near-full-screen QR (high contrast, quiet zone ≥4 modules, error correction M or better) encoding `PUBLIC_BASE_URL/s/:handle` (scan route, F16), artist photo and name, subtle **Share link** and **Share image** (Web Share API Level 2 with file; fallback download). No wallet buttons on the artist side. Artist wallet pass (A-06) optional later.

**Acceptance:** F10-AC01 QR decodes on iOS and Android cameras at 30 cm from a phone screen at 50% brightness; F10-AC02 unpublished profile → QR shows "publish your page first".

### F11. PWA, notifications, messaging foundation
v1 F11 plus: unified **messaging service** (§7.4) used by transactional notices, autopilot, seat filler, review requests and concierge; inbound message routing; STOP/HELP handling; per-artist sending identity; delivery receipts; quiet hours; cost metering per artist (for A-01/A-22).

### F12. Plans and entitlements
v1 F12: approved tier names, pricing, fee rates, feature allocation and monthly message allowances live in `docs/product/PLANS_FEATURES_FEES.md`. Migration 0084 stores boolean entitlements and stylist/client overrides. Feature gates fail closed; platform/provider/safety switches remain independent. AI Price Pilot is false by default and shown as a coming-soon teaser until explicitly granted. Its authenticated `price-pilot` Edge Function provides transient Google Places/Yelp/SerpAPI discovery and Firecrawl structured extraction from stylist-submitted HTTPS menu URLs with an explicit authorization confirmation. Only normalized service names, categories, durations, prices, confidence, source host and observation time are retained; raw page content and directory payloads are not. Comparisons require five distinct recent source hosts with matching category, duration and currency; the result is an observed middle-price band, not an automatic price change. Every request uses the shared request-ID logger; Price Pilot events record action/outcome/result counts and provider status/duration without page contents or submitted payloads. Provider credentials remain server-side. Screen 22 and public pricing use the approved allocation.

### F13. Internationalization
v1 F13 unchanged and extended to every new surface: client profile, sign-in codes, wallet pass text, claim page, review request and form, concierge replies (in the client's language, detected per conversation and confirmable), templates (EN/ES pairs), reports labels. Spanish templates and concierge system copy require human review (A-12).

### F14. Acquisition
v1 F14 unchanged.

### F15. Mova-wide client profile and sign-in
**Screens 26, 27, 29.**

**Flow:** checkout shows "Have a profile? Sign in" and an optional checkbox "Save my details in a free Mova profile" → sheet 27: mobile or email → one-time code (6 digits, 10-min expiry, 5 attempts, rate-limited) → signed in. "Continue as a guest" always available.

**Model (ADR-0004):** one `customer_account` per person (Supabase Auth user with role `client`); verified contact methods; per-artist `clients` rows (tenant-owned) linked via `client_customer_links` when the person books while signed in, or claims a past booking by verifying the same phone/email. A person may also be an artist (separate membership).

**Client sees (29):** client card, upcoming appointments across stylists, My stylists, contact preferences per stylist (appointment texts; reminders and offers), language, edit details, sign out, delete profile.

**Separation (D-17, A-18):** a client never sees stylist notes, internal tags, prices paid at other stylists, or other stylists' existence beyond their own bookings. A stylist never sees the client's bookings with other stylists, their reviews of others, or their other consents. Consents are **per stylist**.

**Acceptance**
- F15-AC01 Guest checkout works identically with profile features OFF.
- F15-AC02 OTP: expiry, attempt limit, rate limit per contact and IP; no account enumeration in responses.
- F15-AC03 Linking a booking requires a verified matching contact; no silent merge across artists.
- F15-AC04 Stylist A cannot query any data about the client's relationship with stylist B (DB and API tests).
- F15-AC05 Client deleting profile unlinks and deletes customer-owned data; stylist-owned client records persist per retention policy (A-08/A-27) and are no longer linkable.
- F15-AC06 Per-stylist consent toggles in 29 update `client_consents` for that tenant only.

### F16. Client card, wallet pass, QR scan landing
**Screens 28, 29, 30.**

- **Client card** (28, 29): forest card with "Client card", client name, "With {artist}", next appointment line (or "Requested · …" for pending), QR encoding a client-scoped token URL (`/c/:token`) that opens rebook/check-in for that client and artist. Buttons: Add to Apple Wallet, Add to Google Wallet (A-19, flag), "Save the card as an image" (fallback, always on).
- **Pass updates:** when the next appointment changes, the pass updates (Apple PassKit web service push; Google Wallet object update). If passes are off, the image fallback shows current data at generation time with a timestamp.
- **QR scanned · client view** (30): `/s/:handle` landing after scanning an artist's QR: large artist photo, name, specialties, locations, **Book with Ari**, **Save Ari's card to your phone** (wallet buttons, flagged; fallback "add to home screen" guidance), **Add Ari to My stylists** (sign-in), link to looks and services. Records a `qr_scan` traffic event (F20) without PII.

**Acceptance**
- F16-AC01 Wallet buttons hidden when flag OFF; image fallback always works.
- F16-AC02 Pass updates within 15 minutes of a reschedule when enabled; measure in local integration and verify production behavior only after GO.
- F16-AC03 `/c/:token` is unguessable (≥128-bit), revocable, and scoped to one client × artist.
- F16-AC04 `/s/:handle` for unpublished handle → friendly not-available page, no data.
- F16-AC05 QR scan event counted once per scan session; no IP or device ID stored in reports.

### F17. Client notes
**Screens 09, 12, 12b, 12c.**

- **General notes** (12): categories Hair, Color, Products, Preferences, Personal, plus free notes; add/edit with history.
- **Before you start** (12, 09): pinned items flagged by the artist (sensitivities, heat limits) plus the latest "For next time" note with "Show at next visit" ON. Shown on Appointment detail and in the day view.
- **Visits** (12b): every appointment newest first with date, location, value, note summary, photo count; today's visit flagged "Add notes".
- **Visit notes** (12c): before/after photos (private storage), what was done, products and settings (chips), for next time, toggle "Show at her next visit".
- **Privacy:** notes are tenant data; never in public DTOs, client profile, concierge replies, analytics or AI prompts except the artist's own drafting features explicitly scoped (none in V1). Sensitive fields (`is_sensitive=true`, e.g., allergies) use application-level envelope encryption per A-27; do not install `pgcrypto`.

**Acceptance**
- F17-AC01 Notes never appear in any client-facing endpoint or export to the client.
- F17-AC02 "Show at next visit" note appears on the next appointment's Before you start and nowhere else.
- F17-AC03 Visit photos are private, signed-URL only, EXIF stripped.
- F17-AC04 Sensitive notes encrypted at rest; included in the artist's data export; deleted with the client record per policy.

### F18. Seat filler (fill open slots)
**Screens 07, 31, 31b, 31c, 31d.** Adapted from the AI Seat Filler brief (Monitor → Selection → Copy → Approval → Dispatch), for one stylist instead of a salon.

**Triggers:** (a) event — cancellation or no-show at a Mova-controlled location (`slot.opened` from F04); (b) scan — scheduled job (every 15 min) finds gaps ≥ shortest active service duration + buffer within the configured horizon (default: next 3 days; minimum lead 2 h). **Dedupe:** one active `slot_event` per (artist, location, overlapping interval).

**Slot lifecycle:** `gap_found → drafting → needs_approval → live → filled | expired | cancelled`. With autopilot for slot texts ON (D-21, entitlement), `drafting → live` after drafting, using the approved `slot_offer` template only.

**Selection:** eligible clients have `rebooking_reminders` (or `offers`, per A-08) consent on a text-capable channel, are not opted out, not contacted within the throttle window, usual service fits the gap (duration + buffer ≤ gap), and have visited this location or are location-agnostic. Rank by: due score (how far into/past window), service-fit, location history, preferred time-of-day match, recency. Default waves **3, 2, 2**, 20 minutes apart, max recipients 10 (configurable within platform caps).

**Copy:** personalized text from the approved `slot_offer` template (deterministic fill) with optional AI polish (A-04) that must pass schema and length checks; social caption + branded image (no client data) for the share sheet.

**Approval (31b):** stylist sees matched count and wave plan, text preview (one personalized example), "just taken" fallback preview, social post preview; **Approve text & send wave 1**; social **Share to…** is a separate action (D-21). Campaign ends 2 h before slot (configurable).

**Dispatch (31c):** sends wave; schedules next waves; stops immediately on fill; sends "That spot was just taken" with other times to everyone already messaged who did not book; cancels remaining waves; records outcome (filled time-to-fill, value; or expired).

**Claim page (31d):** `/claim/:token` (per recipient): slot preselected, deposit, "first to book gets it" → checkout. If already taken: "Just taken" + next openings. Luxe/request locations: offers go out as **requests** with the same honesty rules.

**Home and results:** Home "Needs you" shows "Slot opened"; 31 shows recovered value this month, slots filled ratio, average time to fill.

**Acceptance**
- F18-AC01 One cancellation creates exactly one slot event (idempotent on retries).
- F18-AC02 Ineligible clients (no consent, opted out, throttled, service doesn't fit) are never selected.
- F18-AC03 Nothing sends before approval when slot autopilot is OFF.
- F18-AC04 Fill during wave 1 cancels waves 2–3 within 60 s and sends "just taken" only to wave-1 recipients who didn't book.
- F18-AC05 Two clients claiming simultaneously → one booking; the other sees "just taken".
- F18-AC06 Request-location slot offers create `pending_artist` bookings, never confirmed.
- F18-AC07 Social image contains no client data; share is user-initiated only.
- F18-AC08 Campaign expires at configured cutoff; expired slots stop all sends.

### F19. AI Revenue Center and forecast
**Screen 14** (tab **AI Revenue**). Hub: forecast card, autopilot status, tiles: Concierge, Fill open slots, Rebooking pipeline, Win back; link "How Mova estimates this".

**Forecast (deterministic, `packages/domain/forecast.ts`):** for the current month: `booked` = sum of gross for confirmed + completed appointments in month; `likely` = booked + Σ over remaining open bookable hours × historical fill rate for that weekday/location (trailing 8 weeks) × average ticket per hour (trailing 8 weeks) + expected rebookings (due clients × historical rebook conversion × avg ticket), bounded to a P10–P90 range; `usual` = mean of last 3 full months (if <3 months, hide and say "after 3 months"). Always labelled **Estimate**. Store inputs and version.

**Acceptance:** F19-AC01 forecast reproducible from stored inputs; F19-AC02 hidden with explanation when history insufficient; F19-AC03 label "Estimate" in both locales; F19-AC04 tiles show live counts matching their detail screens.

### F20. Reports dashboard
**Screen 37** (tab **Reports**) and **Home KPI strip (07)**.

Period 7/30/90 days, comparisons vs previous equal period.
- **Revenue:** service value, change %, weekly bars; opens Money (17).
- **Bookings:** completed count, rebook rate (share of clients with a next booking within their window), average ticket, no-shows.
- **Reputation:** rating, count, Mova/Google split, awaiting reply; opens 38.
- **Profile traffic:** page views, QR scans, views → booked conversion, top sources (Instagram, QR, Google, direct, other) from UTM/referrer classification.
- **Marketing:** seat filler recovered value and fills, rebooking reminders booked and value, social shares initiated.
- **Home strip:** this week revenue with change vs last week, % of offered hours booked, rating with new-review count; taps open Reports. (Which three KPIs show is configurable later; V1 fixed.)

Charts: single-hue, thin marks, accessible labels, tap/hover values, and a table view for every chart. Numbers from server rollups (ADR-0009); never computed from client-side lists.

**Acceptance:** F20-AC01 each tile reconciles to source tables for a fixture month; F20-AC02 traffic events contain no PII; F20-AC03 every chart has a data table alternative; F20-AC04 period switch recomputes comparisons correctly at month/DST boundaries.

### F21. Reviews and reputation
**Screens 23, 38, 39.**

- **Request:** after an appointment is marked completed, one review request (email by default per A-29; text only with consent) with a single-use token link (expires 14 days).
- **Form (39):** 1–5 stars (required), tags (Great results, Listened to me, On time, Clean space, Healthy hair), comment (optional, ≤1,000 chars), display name "First L.", "Also leave it on Google" (opens the artist's Google review link if configured).
- **Verified visit:** only clients with a completed appointment can review; one review per appointment.
- **Moderation:** profanity/abuse filter flags for review; artist can reply (one public reply, editable) and report; artist **cannot delete or edit** a client review; platform support handles reports. Publication on the showcase requires A-20.
- **Google reviews:** ingested read-only via GBP API where eligible (A-05/A-20); replies through Google where permitted, otherwise deep link.
- **Reputation (38):** rating, star breakdown, source split, filters (All, Mova, Google, Needs reply), list with Reply, toggle "Ask for a review after each visit".

**Acceptance:** F21-AC01 token single-use and appointment-bound; F21-AC02 no review without completed appointment; F21-AC03 artist cannot alter rating/text; F21-AC04 hidden from public while A-20 open; F21-AC05 showcase rating computed server-side with minimum-count rule.

### F22. AI Concierge
**Screens 40–45.** The stylist's assistant, not a salon receptionist (D-24).

**Channels:** Instagram messages (A-23), Mova business text number (A-24), missed-call text-back (call forwarding to the Mova number or carrier conditional forwarding; Mova does not answer voice in V1), chat widget on the showcase. Per-channel on/off.

**Always:** discloses "Ari's assistant · AI" on first message of each conversation and labels every AI message in the artist UI; replies in the client's language (EN/ES); uses only the artist's configured knowledge (services, prices, deposits, locations, hours, policies, FAQs, prep, location details) and live availability via server tools.

**Can do alone (each a setting, 43):** answer questions from the artist's info; book open times at locations with `booking_mode=instant`; create **requests** for `request` locations (and say the stylist will confirm with the salon); reschedule within policy; reply to seat-filler texts (e.g., alternative time).

**Never (hard rules, not settings):** quote custom prices, discount, waive policies, take payment at `payment_collector=salon` locations, promise salon slots, give medical/chemical safety advice beyond configured prep text, reveal another client's information, reveal private notes, claim to be human.

**Handoffs → "Needs you" (40, Home):** quote requests (custom services, color, extensions, corrections) — concierge collects photos (current front/back, inspiration), hair history, goal, budget, availability, and flags risks from configured rules (e.g., box dye in last 12 months → suggest strand test) → **Quote card (42)** with price chips and "offer consult/strand test"; exceptions (closed days, outside hours, policy questions); complaints or negative sentiment; anything below confidence threshold; any tool failure.

**Artist control (41):** see full thread with AI labels, created bookings/requests, "copy for salon's book" line; reply as yourself; toggle concierge per conversation; global pause.

**Logs and limits:** every AI turn stores prompt version, model, tool calls and results, cost; per-conversation and per-artist daily caps; abuse/spam detection; 24/7 or hours-limited operation (A-30).

**Acceptance**
- F22-AC01 First AI message in each conversation includes disclosure in the conversation language.
- F22-AC02 Request-location booking via concierge creates `pending_artist` and the reply never says "confirmed".
- F22-AC03 No payment request at salon-collected locations (eval + unit tests on tool policy).
- F22-AC04 Quote-type intents always create a handoff and never output a price not in the service catalog.
- F22-AC05 Prompt-injection fixtures (in client messages and uploaded image text) cannot trigger tools outside policy or reveal notes.
- F22-AC06 Turning the concierge off for a conversation stops AI replies within one message.
- F22-AC07 Spanish conversation replies in Spanish with reviewed system copy.
- F22-AC08 Evaluation suite (§8.4) meets thresholds before the flag can be turned on.

### F23. Get paid
**Screen 18 "Get paid".** Methods: **Card** (Stripe) with options **Show a pay QR code** (client scans at the chair, pays on their phone) and **Text a pay link**; **Zelle** (conditional A-16: until approved, "Recorded only" with optional confirmation number); **Cash** (recorded only); **Other** (recorded only, free-text method). "Who received it" applies to recorded methods (I did / The salon). Card shows Mova fee + processor fee notice.

**Pay link:** server creates a Stripe Checkout Session (or Payment Link, per ADR-0007) for the exact balance, bound to the appointment, single-use, expiring (default 24 h); QR encodes the session URL via a Mova short link `/p/:code`; webhook marks paid and posts ledger entries.

**Tap to Pay:** **not in V1** (V1.1, A-17).

**Acceptance:** F23-AC01 amount computed server-side from appointment balance; F23-AC02 paid link cannot be paid twice; expired link shows "ask for a new link"; F23-AC03 recorded methods never create processor records or platform fees; F23-AC04 if A-16 not approved at P17, Zelle disappears from UI and copy via flag.

---

## 2. Experience architecture

### 2.1 Routes

**Company/account:** `https://mova-beauty.co/` is the company home and `https://mova-beauty.co/auth` is account creation/sign-in. **Artist app:** authenticated operator routes use `https://ops.mova-beauty.co/{clientID}/`, where `{clientID}` is the artist business ID. The `/app/` prefix is not used.

| Route | Screen(s) | Notes |
|---|---|---|
| `https://ops.mova-beauty.co/{clientID}/` | 07 | Tab 1 |
| `https://ops.mova-beauty.co/{clientID}/calendar` · `/calendar/:date` | 08 | Tab 2 |
| `https://ops.mova-beauty.co/{clientID}/appointments/:id` | 09 | Before you start, running late (44 as sheet) |
| `https://ops.mova-beauty.co/{clientID}/requests/:id` | 10 | |
| `https://ops.mova-beauty.co/{clientID}/clients` | 11 | Tab 3 |
| `https://ops.mova-beauty.co/{clientID}/clients/:id` · `/visits` · `/visits/:appointmentId` | 12, 12b, 12c | |
| `https://ops.mova-beauty.co/{clientID}/clients/import` | 13 | |
| `https://ops.mova-beauty.co/{clientID}/revenue` | 14 | Tab 4 "AI Revenue" |
| `https://ops.mova-beauty.co/{clientID}/revenue/slots` · `/slots/:slotEventId` · `/slots/:slotEventId/live` | 31, 31b, 31c | |
| `https://ops.mova-beauty.co/{clientID}/revenue/pipeline` · `/winback` · `/autopilot` · `/autopilot/messages` · `/autopilot/activity` | 32–36 | |
| `https://ops.mova-beauty.co/{clientID}/revenue/concierge` · `/concierge/:conversationId` · `/concierge/quotes/:id` · `/concierge/setup` | 40–43 | |
| `https://ops.mova-beauty.co/{clientID}/reports` · `/reports/reputation` | 37, 38 | Tab 5 |
| `https://ops.mova-beauty.co/{clientID}/settings` | 16 | From Home avatar |
| `https://ops.mova-beauty.co/{clientID}/settings/money` · `/money/get-paid/:appointmentId` | 17, 18 (sheet) | |
| `https://ops.mova-beauty.co/{clientID}/settings/locations` · `/calendar-sync` · `/qr` · `/plan` · `/profile` · `/services` · `/reviews` · `/language` · `/privacy` | 19, 20, 21, 22, 02/02b, 03, 38 settings, — , — | |
| `/onboarding/:step` | 01–06 | `account, profile, photo, services, location, payments, publish` |

**Public / client**

| Route | Screen | Notes |
|---|---|---|
| `/a/:handle` (`?tab=services`, `?locale=en-US|es-US`) | 23, 24 | Canonical showcase; SSR on Vercel (ADR-0003); locale alternates use the `locale` query while canonical remains the base artist URL |
| `/a/:handle/book` | 25 → 26 | Date-first picker → details |
| `https://ops.mova-beauty.co/:clientID` | Operator portal entry | Resolves the supplied client/artist business ID through active membership before showing the operator shell. |
| `https://admin.mova-beauty.co` | — | Reserved for Mova administration; product view not defined. Return not-found and expose no client-facing admin view. |
| `/b/:token` | 28 | Booking status + manage + client card |
| `/me` | 29 | Signed-in client profile |
| `/signin` (sheet over checkout or standalone) | 27 | OTP |
| `/s/:handle` | 30 | QR scan landing (records scan) |
| `/c/:token` | — | Client card QR target (rebook / check-in) |
| `/claim/:token` | 31d | Seat-filler claim |
| `/p/:code` | — | Pay link short URL → Stripe |
| `/review/:token` | 39 | Leave a review |
| `/chat/:handle` | 45 (web chat variant) | Concierge web chat |
| Marketing `/en/*`, `/es/*` | F14 | |

Deep links in notifications use these routes and require auth or token scope.

### 2.2 Navigation rules
- Bottom tab bar on tab roots only: **Home, Calendar, Clients, AI Revenue, Reports**; 82 px including safe area; active tab mint pill; labels 11 px; `aria-current="page"`.
- Detail screens use a back chevron (44 × 44) and sticky primary actions at the bottom.
- Sheets (18, 27, 44) are modal dialogs with focus trap, `aria-modal`, swipe-down and Close.
- Settings opens from the Home avatar (photo) with Close (×).

### 2.3 Screen inventory (normative)

Every screen must implement: loading (skeleton), empty, error with retry, offline (read-only cached shell; network actions disabled with message), permission-denied, and validation states; 44 px targets; keyboard order; screen-reader labels; both locales; 320–430 px widths; safe areas; reduced motion.

| # | Canvas file | Screen | Features | Key elements and rules |
|---|---|---|---|---|
| 01 | Main | Account | F01, F13 | Language toggle EN/ES before login; email, password; app language radio; verify-email notice. |
| 02 | Onb-Profile | Artist profile | F01 | Photo circle → 02b; display name; handle with `[DOMAIN]/a/` prefix and availability; specialties (≤5); bio "shown in the language you write it in". |
| 02b | Onb-Photo | Profile photo | F01 | States: empty (face guide, 3 tips, Take/Choose) and preview (crop, zoom slider, small-size preview, Use/Retake). "Later" skip. |
| 03 | Onb-Services | Services & deposits | F03 | Edit card: name, duration, buffer, price, deposit toggle, $/% and amount; helper text; list; add service. |
| 04 | Onb-Location | Work location | F03 | Name, timezone, booking mode radio cards, payment collector, days, hours link, add another location. |
| 05 | Onb-Payments | Payments | F06 | Optional Stripe connect card; recorded methods toggles (Cash, Zelle per A-16); salon-collected notice; Skip. |
| 06 | Onb-Publish | Preview & publish | F01 | Preview card with photo; checklist; search-index toggle; "Booking turns on per location…"; Publish. |
| 07 | App-Home | Home | D-26, F20 | Greeting + avatar (→ Settings); KPI strip (→ Reports); Needs you (quote, request, slot opened; count); Today (time, location color bar, "Now"); Coming up (next 3 working days with tags: open, request, filling). |
| 08 | App-Calendar | Calendar | F04 | Week strip, location filter chips, day timeline with confirmed/blocked/salon blocks, banner "salon bookings don't appear here", FAB new appointment. |
| 09 | App-Appointment | Appointment detail | F04, F06, F17 | Status chip; when/where/client; payment breakdown; **Before you start**; links All notes / Notes for today; sync status; Mark complete, Get paid (→18), Reschedule, Cancel; Running late. |
| 10 | App-Request | Booking request | F04 | Pending chip with expiry; honesty banner; first/alt choices; location + payment collector; client language; note; Accept/Suggest/Decline. |
| 11 | App-Clients | Clients | F05 | Import, add, search, filter chips, rows with status tags. |
| 12 | App-Client | Client profile · notes | F17 | Header; Book again, Message; tabs Profile & notes / Visits; Before you start; General notes; privacy line; consent summary. |
| 12b | App-ClientVisits | Client visits | F17 | Visit list with summaries, photo counts, "Add notes" for today. |
| 12c | App-VisitNote | Visit notes | F17 | Before/after photos, what I did, products & settings chips, for next time, show-at-next-visit toggle, Save. |
| 13 | App-Import | Client import review | F05 | Counts (new, exact, need a look); duplicate resolver (Merge / Keep both); lawful-import notice; disabled Import until resolved. |
| 14 | App-Growth | AI Revenue Center | F19 | Forecast card; autopilot status; tiles: Concierge, Fill open slots, Rebooking pipeline, Win back; estimate link. |
| 15 | App-Outreach | Outreach approval | — | **TABLED. Do not build.** |
| 16 | App-Business | Settings | D-15 | Profile card; View my page; Show my QR; rows: profile/photo/portfolio, services, locations, payments & payouts, calendar sync, reviews & Google, plan, language & notifications, privacy & data; Sign out. |
| 16a | Settings-Services | Settings › Services | F03 | Manage service names, durations, buffers, prices, deposits, active state, and location-specific overrides. Owner-approved derived reference; not a source-canvas artboard. |
| 16b | Settings-Portfolio | Settings › Portfolio | F02, F03 | Upload and order portfolio items; manage alt text, service links, and published/draft state. Owner-approved derived reference; not a source-canvas artboard. |
| 17 | App-Money | Money | F06 | Month picker; breakdown bar + legend (with text labels); fees & refunds; estimated money to you; recent activity. |
| 18 | App-RecordPayment | Get paid (sheet) | F23 | Amount; method radiogroup Card/Zelle/Cash/Other with per-method panel; CTA text changes per method. |
| 19 | App-Locations | Locations & hours | F03 | Location cards with mode, collector ("deposits set per service"), hours, buffer/notice/horizon tiles, edit. |
| 20 | App-CalSync | Calendar sync | F07 | One-way explainer; Google connected card with privacy level; Apple feed URL masked, copy, reset. |
| 21 | App-ShareCard | Show my QR | F10 | Full-bleed forest; photo; name; large QR; link; Share link / Share image. |
| 22 | App-Plan | Plan | F12 | "Proposed pricing · not final"; three plans; entitlement placeholders; fee footnote. |
| 23 | Pub-Showcase | Showcase · Looks | F02, F21 | Cover, photo, rating, locations, bio, Looks/Services toggle, look tiles with Book this look, sticky Book. |
| 24 | Pub-Services | Showcase · Services | F02, F03 | Same header; service rows with deposit text and Book. |
| 25 | Pub-Book | Choose date & time | F04 | Summary with deposit; day strip with open counts; times grouped by location with mode tags; summary line; Continue. |
| 26 | Pub-Checkout | Details & deposit | F04, F15 | Summary; Sign in link; name, mobile, email; choices (appointment texts, save profile, reminders & offers); deposit Stripe field; policy; Pay & book. |
| 27 | Pub-SignIn | Sign in or create profile | F15 | Benefits; contact field; optional marketing opt-in; Send me a code; Continue as guest; terms links. |
| 28 | Pub-Status | Booking status + wallet | F04, F16 | States confirmed / request; summary; client card; Apple/Google Wallet; save image; Add to calendar; Manage or cancel. |
| 29 | Pub-Profile | Client profile & card | F15, F16 | Card + wallet; upcoming; my stylists; per-stylist contact toggles; edit, sign out, delete. |
| 30 | Pub-Scan | QR scanned · client view | F16 | Photo hero; Book; save card (wallet); add to My stylists; looks & services link. |
| 31 | App-FillSlots | Fill open slots | F18 | Results strip; slot cards with status; history; autopilot-for-slots line. |
| 31b | App-SlotCampaign | Review slot campaign | F18 | Match count + wave plan; text preview + just-taken; social post card + share; Approve text & send wave 1; cutoff note. |
| 31c | App-SlotLive | Live campaign · filled | F18 | States live / filled; timeline; Send next wave now, Stop; update story prompt. |
| 31d | Pub-ClaimSlot | Claim this spot | F18 | States open / just taken; photo; slot details; deposit; Claim; other times. |
| 32 | App-Pipeline | Rebooking pipeline | F08 | Month totals; Due / Contacted / Rebooked groups. |
| 33 | App-WinBack | Win back | F08 | Manual send; optional artist offer; consent line; locked opted-out. |
| 34 | App-Autopilot | Autopilot rules | F08, F18 | Master switch; rules list; messages; activity. |
| 35 | App-Templates | Autopilot messages | F08 | Template cards with status, EN/ES preview, variable chips, Edit/Approve; STOP footer note. |
| 36 | App-AutopilotLog | Autopilot activity | F08 | Filters; timeline with icons + text status (never color alone); Export. |
| 37 | App-Reports | Reports | F20 | Period; Revenue (bars), Bookings, Reputation, Traffic, Marketing. |
| 38 | App-Reputation | Reputation | F21 | Rating summary + breakdown; filters; review cards with Reply; ask-for-review toggle. |
| 39 | Pub-Review | Leave a review | F21 | Stars (radio semantics), tags, comment, display name note, Post, Also on Google. |
| 40 | App-Concierge | Concierge inbox | F22 | Status chip; today stats; Needs you; Handled for you; Teach it. |
| 41 | App-ConvoThread | Handled conversation | F22 | Thread with AI labels; system rows (request created, copy for salon); per-chat AI toggle; reply as yourself. |
| 42 | App-QuoteRequest | Quote request | F22 | Photos; details; AI risk flag; price chips; Send quote + times; strand test option; sent in client language. |
| 43 | App-ConciergeSetup | Teach your concierge | F22 | Channels; permissions (locked "Always you" row); knowledge; tone & languages. |
| 44 | App-RunningLate | Running late (sheet) | F04 | Next client; 5/10/15/20+; message preview; salon notice; Send. |
| 45 | Pub-ConciergeChat | Client view · text (Spanish) | F22, F13 | Disclosure header; bilingual thread; photo messages. |

### 2.4 Screens still to design before their phase starts
These are required for V1 and have no canvas artboard yet. The phase that needs them cannot be accepted until the product owner approves a design.

| Needed by | Screen / state |
|---|---|
| P06 | Cancel / reschedule flows (artist and client), refund confirmation, policy display |
| P06 | Client manage-appointment page variants (reschedule picker, cancel confirm) |
| P11 | Notification & language settings; in-app notification inbox |
| P16 | Privacy & data: export, delete account, delete client, retention notices |
| P13 | Spanish variants of guest flows 23–31d (UI is localized; layout must be verified with long strings) |
| P14 | Review reply composer; report review |
| P13 | Concierge exception "Decide" sheet; web chat widget on showcase |
| All | Loading / empty / error / offline states for each screen (pattern library acceptable) |
| P10 | `/c/:token` rebook/check-in page; delete-profile confirmation |

### 2.5 Design system
Tokens: the D-10 palette as CSS variables plus derived text tokens `--ink-primary #18392F`, `--ink-secondary #3F4D46`, `--ink-muted #4F5F57` (≥4.5:1 on ivory), `--line #DCE1D9`, `--line-subtle #EBEEE8`, `--surface #FFFFFF`, `--surface-alt #EEF3EC`, `--accent-warm #F3E3D6`, `--accent-warm-strong #C98F66` (decorative / large text only), `--danger #9A3B2E`. Location identity colours: first location botanical, second warm peach-dark, further from an approved extension list — **always paired with the location name**. Status: confirmed = mint chip + check icon + text; pending/request = warm chip + dashed border + clock icon + text; never colour alone. Type: Manrope 800/700 headings (28/25/20/17), DM Sans 400–700 body (16 input, 15/14/13/12/11 UI). Radii 12–28. Spacing 4-pt scale, 20 px gutters. Components to build (P02): Button (primary/secondary/destructive/ghost), Chip, StatusChip, Card, ListRow, TabBar, Sheet, Toggle (real checkbox), Segmented, Stepper progress, Avatar/Photo (placeholder silhouette), KPI tile, MiniBarChart (+ table), Timeline, Toast, Empty/Error states, QR display, Message bubble (client / AI-labelled / artist / system).

---

## 3. Technical architecture

### 3.1 Topology

```mermaid
flowchart TD
  subgraph Vercel
    APP[Artist PWA ops.mova-beauty.co/{clientID}/*]
    PUB[Public + client pages SSR/prerender]
  end
  subgraph Supabase
    AUTH[Auth: artist + client roles]
    DB[(Postgres + RLS)]
    ST[Storage: public + private buckets]
    EF[Edge Functions]
    CRON[Scheduled triggers]
  end
  APP --> AUTH
  PUB --> EF
  APP --> EF
  EF --> DB
  EF --> ST
  CRON --> JOBS[Job worker: leased jobs + outbox]
  JOBS --> EF
  EF --> STRIPE[Stripe Connect: checkout, pay links, webhooks]
  EF --> GCAL[Google Calendar API]
  ICS[Apple Calendar subscriber] --> FEED[ICS feed function]
  EF --> MSG[SMS provider: numbers, inbound, receipts]
  EF --> MAIL[Email provider]
  EF --> META[Meta Instagram messaging API]
  EF --> GBP[Google Business Profile API]
  EF --> WAL[Apple PassKit web service + Google Wallet API]
  EF --> AI[AI model provider via adapter]
  MSG -->|webhooks| EF
  META -->|webhooks| EF
  STRIPE -->|webhooks| EF
```

### 3.2 Repository layout (canonical, R-02)

```text
mova/
  AGENTS.md  README.md  package.json  pnpm-workspace.yaml  pnpm-lock.yaml  .nvmrc  .env.example  vercel.json
  .github/workflows/{ci.yml}
  apps/web/
    index.html  vite.config.ts  tsconfig.json
    public/{manifest.webmanifest,icons/}
    src/
      main.tsx  App.tsx  router.tsx
      app/            # shells: ArtistShell (tabs), PublicShell, ClientShell, OnboardingShell
      components/     # design-system primitives (§2.5)
      features/
        auth/ onboarding/ showcase/ services/ locations/ availability/ booking/ calendar/
        clients/ notes/ import/ money/ getpaid/ calendarsync/ qr/ settings/ plans/
        revenue/{hub,forecast,slots,pipeline,winback,autopilot,templates,activity}/
        concierge/{inbox,thread,quotes,setup}/
        reports/ reputation/ reviews/
        customer/{signin,profile,card,wallet,scan,claim}/
        acquisition/  notifications/
      i18n/{index.ts,locale.ts,resources/{en-US,es-US}/*.json}
      lib/{supabase.ts,api.ts,query-client.ts,env.ts,seo/,analytics.ts,share.ts}
      styles/
      pages/marketing/
  packages/
    contracts/src/   # zod DTOs per function, enums, errors, analytics events, locale
    domain/src/      # availability, deposits, fees, ledger, booking-state, rebooking, forecast,
                     # slot-matching, autopilot-rules, consent, review-rules, concierge-policy
    design-tokens/src/
    config/
  supabase/
    config.toml  seed.sql
    migrations/      # ordered, see §4.5
    functions/
      _shared/{auth.ts,tenant.ts,customer.ts,money.ts,idempotency.ts,ratelimit.ts,i18n/,providers/{stripe,gcal,sms,email,meta,gbp,wallet,ai}/,policy/,outbox.ts,jobs.ts,log.ts}
      <function-name>/index.ts   # one folder per function in §6
    tests/           # pgTAP RLS + invariants
  tests/{unit,integration,db,contracts,e2e,security,a11y,visual,performance,ai-evals}/
  scripts/{verify-phase.mjs,check-locales.mjs,render-public-pages.mjs,generate-sitemap.mjs,validate-seo.mjs,run-ai-evals.mjs}
  docs/{product/,architecture/,decisions/,engineering/,operations/,security/,runbooks/}
```

### 3.3 Trust boundaries
1. Browser uses the Supabase client **only** for RLS-protected reads/writes explicitly allowed in §4.4; everything involving money, availability reservation, state transitions, consent changes, messaging, AI, wallet, reviews and cross-tenant identity goes through Edge Functions.
2. Service-role key is server-only; CI fails if it appears in any client bundle.
3. Two authenticated roles share one Supabase Auth project: **artist** (has an active `artist_memberships` row) and **client** (has a `customer_accounts` row). A user may hold both; every request resolves an explicit `acting_as` context on the server; the client app shell and artist app shell never share query caches.
4. Public pages read **projections** only (views or functions returning allowlisted columns). No anonymous SELECT on base tables.
5. All inbound webhooks (Stripe, SMS, email, Meta, wallet) are signature-verified, stored raw in `webhook_events` with provider event ID uniqueness, then processed by jobs.
6. AI providers receive only the minimum data for the task (§8.6); never notes, never payment data, never other clients' data.

### 3.4 Jobs, outbox and scheduling (ADR-0010)
Transactional outbox for every domain event; later durable `background_jobs` with `queued|running|succeeded|failed|dead`, lease (`FOR UPDATE SKIP LOCKED`), exponential backoff with jitter, dead-letter alerting, idempotency keys passed to providers. For P06, Vercel Cron invokes the authenticated request-expiry endpoint every five minutes; `mova_expire_booking_requests` atomically expires the booking, releases holds and writes locale-bearing outbox events. Provider delivery and the general durable job dispatcher are later-phase work. Other scheduled triggers remain as specified for their owning phases: slot gap scan (15 min), autopilot planner (hourly; sends respect quiet hours), forecast + report rollups (nightly 03:00 artist local, plus on-demand refresh), wallet pass refresh (on event), Google reviews sync (6 h, flag), review requests (on `appointment.completed` + 2 h delay).

**Domain events (outbox `event_type`):** `appointment.created|confirmed|declined|expired|rescheduled|cancelled|no_show|completed`, `slot.opened`, `slot.filled`, `payment.succeeded|failed|refunded`, `paylink.created|paid|expired`, `client.consent_changed`, `client.linked`, `template.approved|paused`, `autopilot.decision`, `message.inbound|delivered|failed`, `conversation.handoff`, `review.submitted|replied`, `wallet.pass_update_needed`, `profile.published`.

---

## 4. Data model

### 4.1 Conventions
UUID PKs; `timestamptz` UTC; IANA timezones; `artist_business_id` on every tenant row with FK; money `bigint` minor units + ISO currency; basis points for rates; immutable ledger; `created_at`/`updated_at` with trigger; soft delete where retention requires; tenant-scoped uniqueness; enums as `text` + `CHECK` (or Postgres enums via migration) mirrored in `packages/contracts/src/enums.ts`.

**Project database identifier rule (CR-001, owner-approved):** every database object created or owned by this project must have a database identifier beginning with `mova_`. This includes tables, views and materialized views, sequences, SQL functions and procedures, triggers, indexes, constraints, RLS policies, custom types/domains, and project-created schemas. Names of Supabase-managed objects, PostgreSQL built-ins, and referenced objects the project does not create (for example `auth.users` and `auth.uid()`) are not renamed. Use Supabase's existing `public` schema; do not create a new schema unless a later approved decision requires one. Any project-created Storage bucket must also use a `mova_` name. API/Edge Function slugs are not database identifiers and retain their separately specified names.

Use logical entity names in product and API prose where helpful, but every migration must create the mapped `mova_` identifier. SQL references to managed objects remain unchanged. Explicitly name constraints, policies, triggers, and indexes with the prefix rather than relying on PostgreSQL-generated names.

### 4.2 Tables retained from v1
`artist_businesses, artist_memberships, artist_profiles, onboarding_progress, locations, location_hours, location_exceptions, location_policies, compensation_agreements, services, service_locations, portfolio_items, portfolio_service_links, clients, client_consents, client_import_batches, availability_blocks, appointments, appointment_events, booking_holds, payment_accounts, payments, refunds, financial_ledger, plans, subscriptions, entitlements, integration_connections, calendar_sync_settings, external_calendar_events, calendar_feed_tokens, growth_opportunities, rebooking_predictions, wallet_cards, outbox_events, background_jobs, audit_events, platform_events`.

### 4.3 Changes and additions

**Modified**

| Table | Change |
|---|---|
| `artist_profiles` | + `photo_path`, `photo_variants jsonb`, `photo_updated_at`, `preferred_locale`, `home_kpis jsonb` (fixed default in V1), `google_review_url` |
| `services` | + `deposit_type text CHECK (deposit_type in ('none','fixed','percent')) default 'none'`, `deposit_value bigint` (minor units if fixed; basis points if percent), CHECK percent ≤ 10000 |
| `location_policies` | − `deposit_policy` (moved to services); + `request_expiry_hours int default 24`, `client_details jsonb` (parking, entry, notes) and `door_code_encrypted bytea` (shown only to booked clients) |
| `locations` | + `location_type` (`suite`,`booth`,`commission_salon`,`mobile`), `display_color_index smallint` |
| `clients` | + `preferred_locale`, `customer_account_id uuid null` (denormalized from link for fast joins; source of truth is `client_customer_links`), `last_visit_at`, `visit_count` (maintained by trigger) |
| `client_consents` | `purpose` ∈ `appointment_updates`, `rebooking_reminders`, `offers`, `review_requests`; `channel` ∈ `sms`,`email`,`instagram`,`push`; + `locale`, `evidence jsonb` (form, IP hash, timestamp, copy version) |
| `appointments` | + `source` ∈ (`showcase`,`artist`,`concierge`,`seat_filler`,`autopilot`,`import`), `slot_event_id null`, `customer_account_id null`, `client_locale`, `deposit_due_minor`, `balance_due_minor` (derived, maintained) |
| `payments` | `method` ∈ (`card_checkout`,`card_paylink_sms`,`card_paylink_qr`,`wallet_checkout`,`zelle_recorded`,`zelle_verified`,`cash`,`other`,`salon_collected`); `collector` ∈ (`mova_processed`,`artist`,`salon`); + `paylink_id null`, `recorded_note`, `confirmation_ref` |
| `growth_opportunities` | `type` ∈ (`rebook_due`,`win_back`,`slot_fill`) |
| `wallet_cards` | renamed concept → see `wallet_passes` |

**New — client identity (F15, F16)**

| Table | Columns / constraints |
|---|---|
| `customer_accounts` | `id`, `user_id uuid UNIQUE FK auth.users`, `display_name`, `preferred_locale`, `status` (`active`,`deleted`), `created_at`, `deleted_at` |
| `customer_contact_methods` | `id`, `customer_account_id`, `type` (`phone`,`email`), `value_normalized`, `verified_at`, UNIQUE(type, value_normalized) where verified |
| `client_customer_links` | `id`, `artist_business_id`, `client_id`, `customer_account_id`, `linked_via` (`booking_signed_in`,`claim_verified`), `linked_at`, `unlinked_at`; UNIQUE(artist_business_id, customer_account_id) where `unlinked_at is null` |
| `otp_challenges` | `id`, `contact_hash`, `code_hash`, `expires_at`, `attempts`, `consumed_at`, `ip_hash`; never store raw codes |
| `client_card_tokens` | `id`, `artist_business_id`, `client_id`, `token_hash`, `revoked_at`, `created_at` |
| `wallet_passes` | `id`, `subject_type` (`client_card`,`artist_card`), `artist_business_id`, `client_id null`, `customer_account_id null`, `platform` (`apple`,`google`), `serial`, `auth_token_hash`, `status`, `last_payload_hash`, `last_pushed_at` |
| `wallet_device_registrations` | `id`, `wallet_pass_id`, `device_library_id`, `push_token_encrypted`, `registered_at`, `unregistered_at` (Apple web service) |

**New — notes (F17)**

| Table | Columns / constraints |
|---|---|
| `client_notes` | `id`, `artist_business_id`, `client_id`, `category` (`hair`,`color`,`products`,`preferences`,`personal`,`other`), `body text`, `is_sensitive bool`, `body_encrypted bytea` (when sensitive; `body` null), `pin_before_start bool`, `created_by`, timestamps, `deleted_at` |
| `visit_notes` | `id`, `artist_business_id`, `appointment_id UNIQUE`, `client_id`, `what_done`, `products jsonb` (array of strings), `next_time`, `show_next_visit bool`, timestamps |
| `visit_media` | `id`, `artist_business_id`, `visit_note_id`, `kind` (`before`,`after`,`other`), `storage_path` (private bucket), `width`, `height`, `created_at` |

**New — messaging (F11, F18, F22)**

| Table | Columns / constraints |
|---|---|
| `sending_identities` | `id`, `artist_business_id`, `channel` (`sms`,`email`,`instagram`), `address` (E.164 number / from-address / IG account id), `provider`, `registration_status` (A-24), `status`, `created_at` |
| `message_templates` | `id`, `artist_business_id`, `type` (`rebooking_reminder`,`slot_offer`,`slot_taken`,`win_back`,`review_request`,`running_late`,`transactional_*`), `locale`, `body`, `variables jsonb`, `version int`, `status` (`needs_approval`,`approved`,`paused`), `approved_by`, `approved_at`, `source` (`system_default`,`artist_edit`,`ai_draft`), UNIQUE(artist, type, locale, version) |
| `messages` | `id`, `artist_business_id`, `client_id null`, `conversation_id null`, `direction` (`outbound`,`inbound`), `channel`, `purpose` (consent purpose or `transactional`), `template_id null`, `body`, `media jsonb`, `status` (`queued`,`sent`,`delivered`,`failed`,`received`), `provider_message_id`, `error_code`, `idempotency_key UNIQUE`, `cost_micros`, timestamps |
| `suppressions` | `id`, `artist_business_id null` (null = platform-wide), `channel`, `address_hash`, `reason` (`stop`,`bounce`,`complaint`,`manual`), `created_at` |
| `autopilot_settings` | `artist_business_id PK`, `enabled bool default false`, `rules jsonb` (caps, quiet hours, new-client weeks, attribution days), `slot_texts_autopilot bool default false`, `updated_by`, `updated_at` |
| `autopilot_decisions` | `id`, `artist_business_id`, `client_id`, `opportunity_id null`, `slot_event_id null`, `action` (`sent`,`skipped`,`held`,`failed`,`rebooked`), `reason_code`, `consent_id null`, `message_id null`, `value_minor null`, `created_at` |

**New — seat filler (F18)**

| Table | Columns / constraints |
|---|---|
| `slot_events` | `id`, `artist_business_id`, `location_id`, `starts_at`, `ends_at`, `origin` (`cancellation`,`no_show`,`gap_scan`), `source_appointment_id null`, `status` (`gap_found`,`drafting`,`needs_approval`,`live`,`filled`,`expired`,`cancelled`), `wave_plan jsonb`, `expires_at`, `filled_appointment_id null`, `filled_at null`, `value_minor null`, `dedupe_key UNIQUE`, timestamps; EXCLUDE overlapping active events per (artist, location) |
| `slot_candidates` | `id`, `slot_event_id`, `artist_business_id`, `client_id`, `rank`, `wave smallint`, `reasons jsonb`, `status` (`planned`,`messaged`,`claimed`,`skipped`,`notified_taken`), `claim_token_hash`, `message_id null` |
| `slot_campaign_copy` | `id`, `slot_event_id`, `artist_business_id`, `sms_example`, `taken_message`, `social_caption`, `social_image_path`, `approved_by`, `approved_at`, `ai_used bool`, `prompt_version` |
| `social_share_events` | `id`, `artist_business_id`, `slot_event_id null`, `initiated_at`, `target_hint` (from share result if available) |

**New — revenue, reports, reputation (F19–F21)**

| Table | Columns / constraints |
|---|---|
| `forecasts` | `id`, `artist_business_id`, `period_start`, `period_end`, `booked_minor`, `likely_minor`, `likely_low_minor`, `likely_high_minor`, `usual_minor null`, `inputs jsonb`, `method_version`, `computed_at` |
| `metrics_daily` | `artist_business_id`, `date` (artist local), `location_id null`, `revenue_gross_minor`, `revenue_processed_minor`, `appointments_completed`, `appointments_noshow`, `offered_minutes`, `booked_minutes`, `new_clients`, `page_views`, `qr_scans`, `bookings_from_page`, `seat_filler_fills`, `seat_filler_value_minor`, `reminders_sent`, `reminders_rebooked`, `reminders_value_minor`, `social_shares`, PK(artist, date, location_id) |
| `traffic_events` | `id`, `artist_business_id`, `kind` (`page_view`,`qr_scan`,`booking_started`,`booking_completed`), `source` (`instagram`,`qr`,`google`,`direct`,`other`), `session_hash` (rotating daily salt), `occurred_at`; no IP, no UA string stored |
| `reviews` | `id`, `artist_business_id`, `source` (`mova`,`google`), `appointment_id null` (required for mova), `client_id null`, `customer_account_id null`, `rating smallint CHECK 1..5`, `tags text[]`, `body`, `display_name`, `locale`, `status` (`pending_moderation`,`published`,`hidden`,`reported`), `external_id null`, `reply_body`, `replied_at`, `created_at`; UNIQUE(appointment_id) where source='mova'; UNIQUE(artist, external_id) where source='google' |
| `review_requests` | `id`, `artist_business_id`, `appointment_id UNIQUE`, `token_hash`, `channel`, `sent_at`, `expires_at`, `used_at` |

**New — concierge (F22)**

| Table | Columns / constraints |
|---|---|
| `concierge_settings` | `artist_business_id PK`, `enabled`, `channels jsonb` (instagram, sms, missed_call, web_chat), `permissions jsonb` (answer, book_instant, request_salon, reschedule, reply_slot_offers), `tone`, `languages text[]`, `hours jsonb null`, `daily_ai_turn_cap`, `updated_at` |
| `concierge_knowledge` | `id`, `artist_business_id`, `kind` (`faq`,`prep`,`location_detail`,`policy`), `location_id null`, `question`, `answer_en`, `answer_es`, `status`, `updated_at` |
| `conversations` | `id`, `artist_business_id`, `channel`, `external_thread_id`, `client_id null`, `contact_hash`, `locale`, `status` (`handled`,`needs_you`,`closed`), `ai_enabled bool default true`, `last_message_at`; UNIQUE(artist, channel, external_thread_id) |
| `concierge_turns` | `id`, `conversation_id`, `artist_business_id`, `inbound_message_id`, `outbound_message_id null`, `model`, `prompt_version`, `tool_calls jsonb`, `decision` (`replied`,`handoff`,`blocked`), `confidence`, `cost_micros`, `latency_ms`, `created_at` |
| `handoffs` | `id`, `artist_business_id`, `conversation_id`, `type` (`quote`,`exception`,`complaint`,`low_confidence`,`tool_error`), `status` (`open`,`resolved`), `summary`, `created_at`, `resolved_at` |
| `quote_requests` | `id`, `artist_business_id`, `conversation_id`, `client_id null`, `service_category`, `details jsonb` (hair now, goal, budget, availability), `media jsonb` (private paths), `risk_flags jsonb`, `quoted_minor null`, `status` (`open`,`quoted`,`consult_offered`,`booked`,`closed`) |

**New — payments (F23)**

| Table | Columns / constraints |
|---|---|
| `paylinks` | `id`, `artist_business_id`, `appointment_id`, `amount_minor`, `currency`, `channel` (`sms`,`qr`), `short_code UNIQUE`, `provider_session_id`, `status` (`open`,`paid`,`expired`,`cancelled`), `expires_at`, `paid_payment_id null`, timestamps |
| `webhook_events` | `id`, `provider`, `provider_event_id`, `received_at`, `payload jsonb`, `processed_at`, `status`; UNIQUE(provider, provider_event_id) |

### 4.4 RLS matrix (must be proven by pgTAP in `supabase/tests/`)

| Table group | artist (member) | client (customer) | anonymous | worker |
|---|---|---|---|---|
| Tenant config (profiles, services, locations, policies, portfolio drafts) | CRUD own tenant | none | via public projections only | read |
| clients, client_consents | CRUD own tenant | **none direct**; own consents via `customer-consents` function | none | read/write via functions |
| client_notes, visit_notes, visit_media | CRUD own tenant | **never** | never | read only for export jobs |
| appointments, appointment_events | own tenant | own linked appointments via `client-appointments` function projection | token-scoped via function | read/write |
| payments, ledger, paylinks, refunds | read own tenant; writes via functions | own receipts projection only | paylink page via function | write |
| customer_accounts, contact methods | none | own row | none | write |
| client_customer_links | read own tenant rows (link status only) | read own links (artist display data only) | none | write |
| messages, conversations, turns, handoffs, quotes | own tenant | none (clients see messages on their own channel) | none | read/write |
| templates, autopilot, slot tables | own tenant | none | claim page via token function | read/write |
| reviews | read own tenant; reply via function | own reviews | published projection | write |
| metrics_daily, forecasts, traffic_events | read own tenant | none | insert-only via `track` function | write |
| audit_events | read own tenant (subset) | none | none | write |

Negative tests required for every row: other artist, client of same artist, client of another artist, anonymous, expired token.

### 4.5 Migration order
`0001_mova_helpers` (membership helper only; no extension installation) → `0002_tenancy_identity` → `0003_artist_profiles_onboarding` (including normalized-handle uniqueness index `mova_artist_profiles_handle_lower_uq`) → `0004_services_deposits_portfolio` → `0005_locations_policies_availability` → `0006_clients_consents_import` → `0007_appointments_holds_events` (booking-overlap concurrency mechanism selected by a P06 ADR; preserve the buffer-inclusive overlap invariant without installing an unprefixed extension) → `0008_notes_visits_media` (sensitive notes use application-level envelope encryption per A-27) → `0009_payments_ledger_paylinks_webhooks` → `0010_calendar_integrations` → `0011_customer_identity_links_otp` → `0012_wallet_passes_card_tokens` → `0013_messaging_identities_templates_messages_suppressions` → `0014_rebooking_predictions_opportunities_autopilot` → `0015_slot_events_candidates_copy` → `0016_concierge` → `0017_reviews_requests` → `0018_metrics_forecasts_traffic` → `0019_plans_entitlements` → `0020_outbox_jobs_audit_platform_events` → `0021_acquisition_waitlist` → `0022_rls_policies_all` (or per-migration policies; either way the full matrix test runs at `0022`). Each migration ships with pgTAP tests and seed updates. No PostgreSQL extensions are installed by this project unless a later owner-approved change specifies a `mova_`-prefixed extension name and that name is supported by the target platform.

**Seed fixture (`supabase/seed.sql`):** two artists in separate tenants; artist 1 with two locations (suite/instant/artist-collects; salon/request/salon-collects), three services (one fixed deposit, one percent, one none), five clients with varied consent and visit histories (0, 1, 2, 4+ intervals), one linked customer account linked to both artists, appointments across states, one slot event per state, templates in both locales, one conversation per channel type, reviews from both sources, metrics for 90 days. No real PII.

---

### 4.6 Physical identifier mapping (CR-001)
The v2.0 logical table names below map to these physical database identifiers for P03–P06. This mapping adds no columns or business rules. Migration-specific constraints, indexes, triggers, and RLS policies must be listed in migration documentation and use the same `mova_` prefix.

| Logical object | Physical identifier | Phase use |
|---|---|---|
| `artist_businesses` | `mova_artist_businesses` | P03 tenant root |
| `artist_memberships` | `mova_artist_memberships` | P03 tenant membership |
| `artist_profiles` | `mova_artist_profiles` | P03 profile/photo/publish; P04 public profile |
| normalized handle unique index | `mova_artist_profiles_handle_lower_uq` | P03 case-insensitive handle uniqueness, without `citext` |
| `onboarding_progress` | `mova_onboarding_progress` | P03 resumable onboarding |
| reserved handle list (F01) | `mova_reserved_handles` | P03 handle claim guard |
| `services` | `mova_services` | P04 services and deposits |
| `service_locations` | `mova_service_locations` | P04 per-location overrides |
| `portfolio_items` | `mova_portfolio_items` | P04 portfolio items |
| `portfolio_service_links` | `mova_portfolio_service_links` | P04 service links |
| `locations` | `mova_locations` | P05 location ownership and booking mode |
| `location_hours` | `mova_location_hours` | P05 weekly hours |
| `location_exceptions` | `mova_location_exceptions` | P05 date-specific hours and closures |
| `location_policies` | `mova_location_policies` | P05 lead, horizon, buffers, cancellation, request expiry, client details, encrypted door code |
| `availability_blocks` | `mova_availability_blocks` | P05 artist-blocked periods |
| `appointments` | `mova_appointments` | P06 booking state and snapshots |
| `booking_holds` | `mova_booking_holds` | P06 expiring checkout holds |
| `appointment_events` | `mova_appointment_events` | P06 immutable transition history |
| `outbox_events` | `mova_outbox_events` | P06 transactional event delivery handoff |
| handle-claim SQL routine, if implemented in SQL | `mova_claim_artist_handle` | P03 transactional claim |
| tenant-resolution SQL helper | `mova_current_artist_business_id` and any additional `mova_`-prefixed helpers | P03; exact set recorded with migration |
| location-save routine | `mova_save_location` | P05 owner-authorized location settings transaction |
| location-hours validation routine | `mova_location_window_is_open` | P06 server-side booking validation |
| booking-create routine | `mova_booking_create` | P06 transactional booking, overlap and idempotency checks |
| booking-transition routine | `mova_booking_transition` | P06 state machine and events |
| booking-reschedule routines | `mova_booking_reschedule`, `mova_booking_reschedule_review` | P06 client rescheduling and artist review |
| request-time suggestion routines | `mova_booking_suggest_time`, `mova_booking_suggestion_response` | P06 artist suggests an available slot; client accepts or declines it |
| request-expiry routine | `mova_expire_booking_requests` | P06 scheduled expiration and outbox handoff |
| profile-photo Storage bucket | `mova_profile_photos` | P03 profile/cover photos |
| portfolio-media Storage bucket | `mova_portfolio_media` | P04 portfolio uploads |

Do not create a separate showcase projection table unless separately approved. Public data may be exposed only through the allowlisted projection required by §3.3, using a prefixed SQL view/function or the specified server-side Edge Function.

## 5. Domain rules and state machines
All rules live in `packages/domain` as pure, unit-tested functions shared by Edge Functions (Deno imports the package build) and UI previews. The server is always authoritative.

### 5.1 Money
- `deposit(service, location, price)`: §F03 rule. `percent` uses basis points: `floor((price × bps + 5000) / 10000)`, min 0, max price.
- `platformFee(payment, planVersion)`: only for `collector = mova_processed`; `round_half_up(amount × fee_bps / 10000)`; snapshot plan version on the payment.
- `balance(appointment) = gross − Σ succeeded payments + Σ refunds`.
- Ledger postings per payment: `service_value` (once per appointment at confirmation), `processed`/`recorded_artist`/`collected_salon`, `platform_fee` (negative), `processor_fee` (from webhook balance transaction), `refund` (negative). `estimated_to_artist = processed − platform_fee − processor_fee − refunds + recorded_artist`.

### 5.2 Booking
An appointment may contain one to eight ordered services. `mova_appointment_services` stores each service identity, display name, effective duration (including that service's buffer), effective price, and deposit inputs/results as snapshots. `mova_appointments.service_id` and `service_name_snapshot` continue to mirror the first service during compatibility; its price, deposit and balance fields hold appointment-wide totals. Each service uses its location override when present and the service base value otherwise. Appointment duration is the sum of effective service durations; location before/after buffers apply once around that combined interval. Appointment deposit is the sum of independently rounded per-service deposits, capped at combined price; salon-collected bookings require no online deposit. Existing appointments backfill to one child row.

State machine per F04. Additional transitions: `pending_artist` created by concierge or seat-filler claim at request locations; `confirmed` created by claim at instant locations after deposit. Holds: `booking_holds` 10 min during checkout; expiry job releases. Booking integrity must prevent overlap across `[starts_at − buffer_before, ends_at + buffer_after)` for `confirmed|completed` appointments plus active holds. ADR-0012 uses a transaction-scoped advisory lock for tenant-scoped idempotency and locks the location row before checking and reserving its interval. All reservation and reschedule operations for one location serialize on that row; no unprefixed extension is installed, and the overlap invariant is preserved.

### 5.3 Client identity linking (ADR-0004)
1. Signed-in client books with artist A → if no link for (A, account): find A's `clients` row by verified phone/email **exact normalized match**; if exactly one, link; if none, create client row and link; if several, create a new client row and raise an artist-side duplicate suggestion (never auto-merge).
2. Claim: client verifies a contact method → system lists bookings (across artists) whose client contact matches the verified method → client confirms each link individually.
3. Unlink on profile deletion or artist removal of the client; history stays in tenant.
4. Projections: client sees for each linked artist: artist public profile, the client's own appointments with that artist (time, service, location, status, amounts they paid), their per-artist consents. Nothing else.

### 5.4 Rebooking and autopilot
- Cadence math per F08. Recompute on `appointment.completed` and nightly.
- **Autopilot planner (hourly):** for each artist with `enabled`, select due clients → filter: consent `rebooking_reminders` on an available channel, not suppressed, no future booking, caps not exceeded, not in an active slot campaign, last message ≥ 14 days → schedule send at next allowed time in client timezone → at send time **re-check everything** → send approved template in client locale → record decision. If no approved template in client locale → skip with `no_template_for_locale`.
- **Attribution:** booking created by the client within `attribution_days` (default 14) after a reminder → `rebooked` decision with value; last-touch only; seat filler takes precedence when the booking fills a slot event.

### 5.5 Consent purposes and enforcement
| Purpose | Used by | Default | Collected at |
|---|---|---|---|
| `appointment_updates` | confirmations, reminders of the booked appointment, changes, running late, manage links | ON when booking (transactional) | Checkout (26) |
| `rebooking_reminders` | autopilot reminders, seat-filler offers | OFF | Checkout (26), sign-in (27), profile (29) |
| `offers` | win-back with offers; any promotional content | OFF | Same |
| `review_requests` | review requests | ON for email at booking unless opted out (A-29) | Checkout policy text |
Enforcement function `canSend(artist, client, channel, purpose, now)` checks consent, suppressions (STOP is channel-wide per artist and platform-wide for SMS STOP to a shared number), quiet hours (purposes other than `appointment_updates`), caps, plan entitlement and global kill switches. Every send stores the consent row ID used.

### 5.6 Seat filler
States per F18. Transitions:
`gap_found → drafting` (selection + copy job) → `needs_approval` (approval mode) or `live` (slot autopilot ON with approved `slot_offer` template) → `live` on approval → `filled` (on booking whose interval covers the slot or the slot's offered start) | `expired` (at `expires_at`) | `cancelled` (artist stops; or slot becomes unavailable e.g., blocked).
Wave scheduler sends wave n at `approved_at + (n−1) × interval`; before each wave: re-check slot still free, recompute eligibility for that wave's candidates. Claim tokens: per candidate, single-use, expire at `expires_at`. Concurrent claims serialize on the reservation constraint; losers get "just taken". On fill: cancel future waves, send `slot_taken` to `messaged` candidates who did not claim (purpose `rebooking_reminders`, counts toward caps), record value and time to fill.

### 5.7 Forecast
Per F19; computed nightly and on `appointment.*` events (debounced 5 min). Inputs stored; UI shows "Estimate" and the range on tap.

### 5.8 Reviews
`review_requests` created on `appointment.completed` (+2 h); submit validates token, appointment completed, not already reviewed; status `pending_moderation` → `published` (auto if passes filters and A-20 approved; else held) | `hidden` (platform) | `reported`. Showcase rating = mean of published Mova + Google ratings, shown when count ≥ minimum.

### 5.9 Concierge conversation lifecycle
Inbound message → resolve conversation (artist, channel, thread) → if `ai_enabled` and concierge enabled and within hours → run turn (§8.3) → reply or handoff. Status `handled` when last turn replied without handoff; `needs_you` when an open handoff exists; `closed` after 7 days inactivity. Artist reply sets `ai_enabled=false` for 24 h on that conversation by default (configurable) to avoid talking over the artist.

### 5.10 Pay links
`open → paid` (webhook) | `expired` (job) | `cancelled` (artist). One open link per appointment per channel; creating a new one cancels the previous.

---

## 6. API and function contracts

### 6.1 Conventions (unchanged)
`/functions/v1/<name>`; envelope `{ data, error, request_id }`; errors `{ code, message, details? }`; Zod schemas in `packages/contracts/src/functions/<name>.ts`; `Idempotency-Key` on every mutation; caller classes `artist | client | guest | worker | provider`; OpenAPI generated in CI. Contract test template per v1 §6 applies to every function (401, 403/404, 422, 409, replay, upstream timeout, atomic DB + outbox, no secrets in logs).

### 6.2 Functions retained from v1
`publish-showcase, public-artist, availability-search, booking-create, booking-status, booking-transition, booking-reschedule, stripe-connect-onboard, payment-intent-create, stripe-webhook, refund-request, manual-payment-record, calendar-google-connect, calendar-google-callback, calendar-sync-settings, calendar-sync-run, calendar-ics-feed, calendar-ics-rotate, client-import-preview, client-import-commit, growth-opportunities-list, growth-opportunity-generate, wallet-card-create, subscription-checkout, subscription-portal, account-export, account-delete-request, waitlist-signup, job-dispatch, job-worker`.
Changes: `availability-search` returns `days[]` (open counts) and `groups[]` per location with `bookingMode`; `booking-create` accepts `source`, `slotClaimToken?`, `customerSession?`; `manual-payment-record` methods per §4.3; `outreach-approve`/`outreach-send` are replaced by the template/autopilot/slot functions below.

### 6.3 New functions

| Function | Caller | Request → Response | Guarantees |
|---|---|---|---|
| `photo-upload-url` | artist | `{kind: profile|cover|portfolio|visit}` → `{uploadUrl, path}` | MIME/size policy; private bucket for visit |
| `photo-process` | worker | storage event → variants | EXIF strip, variants, moderation hook |
| `otp-start` | guest | `{contact}` → `{challengeId}` | Rate limit per contact/IP; generic response |
| `otp-verify` | guest | `{challengeId, code}` → session | Attempts ≤5; creates/links `customer_accounts` |
| `customer-profile` | client | GET/PATCH | Own data only |
| `customer-appointments` | client | GET | Projection across linked artists |
| `customer-consents` | client | GET/PATCH `{artistId, purpose, channel, status}` | Per-artist; evidence recorded |
| `customer-claim-bookings` | client | `{verifiedContactId}` → candidates; POST confirm | Exact verified match only |
| `customer-delete` | client | `{confirmation}` | Unlink + delete customer-owned data; audit |
| `client-card-token` | client/guest-token | → `{cardUrl, qrUrl}` | ≥128-bit token, revocable |
| `wallet-pass-create` | client/guest-token | `{platform}` → pass file / save URL | Flag A-19; signed pass |
| `wallet-apple-webservice` | provider | PassKit web service endpoints | Auth token check; device registration; latest pass |
| `wallet-pass-refresh` | worker | `{passId}` | Push update on appointment change |
| `scan-landing` | guest | `{handle}` → DTO; records `qr_scan` | No PII |
| `client-notes` | artist | CRUD | Tenant; encryption for sensitive |
| `visit-notes` | artist | CRUD + media | Private media |
| `before-you-start` | artist | `{appointmentId}` → items | Pinned + last show-next-visit |
| `paylink-create` | artist | `{appointmentId, channel}` → `{shortUrl, qrSvg?, expiresAt}` | Server amount; cancels prior |
| `paylink-redirect` | guest | `/p/:code` → 302 Stripe | Expired → page |
| `running-late-send` | artist | `{appointmentId, minutes, offerNewTime}` → `{messageId}` | Transactional purpose; next appointment only |
| `templates` | artist | list/edit/approve/pause | Edit pauses; versioned |
| `autopilot-settings` | artist | GET/PATCH | Entitlement + A-21 flag |
| `autopilot-plan` | worker | hourly | §5.4 |
| `autopilot-activity` | artist | list/export | Paginated, CSV |
| `rebooking-pipeline` | artist | `{month}` → groups + totals | |
| `winback-list` / `winback-send` | artist | send requires explicit call per client | No offer text generated by Mova |
| `slot-scan` | worker | 15 min | Dedupe |
| `slot-draft` | worker | `{slotEventId}` | Selection + copy |
| `slot-approve` | artist | `{slotEventId, smsEdits?}` → live | Re-checks slot free |
| `slot-stop` / `slot-send-next-wave` | artist | | Idempotent |
| `slot-dispatch` | worker | wave send | Re-check per wave |
| `slot-claim` | guest | `{claimToken}` → DTO / → booking-create | Single use; concurrency safe |
| `social-share-image` | artist | `{slotEventId}` → image URL | No client data |
| `social-share-record` | artist | `{slotEventId}` | Records initiation |
| `forecast-get` | artist | `{month}` | Stored inputs |
| `reports-summary` | artist | `{period}` → tiles | From rollups |
| `track` | guest | `{handle, kind, source, sessionHash}` | Insert-only, rate-limited, no PII |
| `review-request-send` | worker | on completed + 2 h | Consent `review_requests` |
| `review-submit` | guest | `{token, rating, tags, body}` | Single use; moderation |
| `review-reply` / `review-report` | artist | | Cannot edit client content |
| `google-reviews-sync` | worker | 6 h | Flag A-05/A-20 |
| `messaging-inbound-sms` | provider | signed webhook | STOP/HELP; route to conversation |
| `messaging-status` | provider | delivery receipts | Updates `messages` |
| `missed-call-webhook` | provider | call event → text back | Only when enabled |
| `instagram-webhook` | provider | Meta webhook (verify token + signature) | Flag A-23 |
| `web-chat` | guest | `{handle, sessionToken, message}` | Rate limit; captcha on abuse |
| `concierge-turn` | worker | `{inboundMessageId}` | §8.3 |
| `concierge-settings` / `concierge-knowledge` | artist | CRUD | |
| `conversations` | artist | list/get/reply/toggle-ai | Artist reply pauses AI |
| `quote-respond` | artist | `{quoteId, amountMinor?, offerConsult?}` | Sends in client locale |
| `handoff-resolve` | artist | `{handoffId, action}` | |
| `sending-identity-provision` | artist | number/email setup | A-24 status gating |

---

## 7. Integrations
Every integration has: adapter interface in `supabase/functions/_shared/providers/<name>/`, a sandbox/mock implementation used in CI, contract tests with recorded fixtures, a feature flag, health status surfaced in Settings, and a runbook. **Verify every capability against the provider's current official documentation at implementation time; nothing below is proof that a capability is available to Mova's account.**

### 7.1 Stripe (A-02, ADR-0007)
Connect onboarding for artists; Checkout Sessions for deposits and pay links (supports Apple Pay / Google Pay where eligible); webhook ingestion with signature verification and `webhook_events` dedupe; platform fee via the approved charge topology; refunds; disputes surfaced read-only. Pay-link QR = Mova short URL to a Checkout Session. **Tap to Pay** requires Stripe Terminal's native mobile SDKs and Apple's Tap to Pay entitlement → V1.1 native shell (A-17); not reachable from the PWA.

### 7.2 Zelle (A-16)
No Stripe path. Options to evaluate in ADR-0007: bank or processor partner with Zelle-for-business acceptance and payment notification; or keep recorded-only. Exit criterion: if no approved integration by P17, flag `zelle` OFF and remove Zelle from UI, copy and templates.

### 7.3 Calendars
Unchanged from v1 (Google OAuth least scopes, encrypted refresh tokens, idempotent event mapping; Apple RFC 5545 feed with hashed revocable token).

### 7.4 Messaging (A-03, A-24, ADR-0005)
- **SMS provider:** outbound, inbound webhooks, delivery receipts, STOP/HELP keyword handling, per-artist numbers or a shared pool with per-artist routing (decide in ADR-0005). US application-to-person texting requires carrier registration (10DLC brand/campaign or toll-free verification); no live texting until registered.
- **Missed-call text-back:** artist forwards unanswered calls (carrier conditional forwarding) to their Mova number; the provider call webhook triggers a text-back; Mova does not answer or record voice in V1.
- **Email provider:** transactional + review requests; SPF/DKIM/DMARC on the approved domain; bounce/complaint webhooks → suppressions.
- **Push:** Web Push (VAPID) where supported; iOS requires Home-Screen-installed PWA; always fall back to in-app + email.

### 7.5 Instagram messaging (A-23)
Meta's messaging API for Instagram professional accounts: artist connects via OAuth; webhooks for inbound messages; replies within Meta's messaging-window policy; app review for messaging permissions. If not approved, Instagram channel stays OFF and Settings shows "coming soon" only after owner approval of that copy.

### 7.6 Google Business Profile (A-05, A-20)
Manual booking-link guidance always available. Where an artist has an eligible, verified profile and API access is approved: read reviews, reply where permitted, and set booking link if permitted. Many booth renters will not have their own profile; UI must handle "not eligible" honestly.

### 7.7 Wallet passes (A-06, A-19, ADR-0008)
Apple: Pass Type ID certificate, signed `.pkpass`, PassKit web service (register device, latest pass, unregister) with push via APNs on updates. Google: Wallet API pass class + objects, "Save to Google Wallet" link/JWT, object updates. Pass content: Mova brand, client name, artist name, next appointment, barcode encoding `/c/:token`. No sensitive notes. Fallback: image card + QR.

### 7.8 AI provider (A-04, A-25, ADR-0006)
Adapter `generate(task, input, schema, policy)` with task types `slot_copy`, `social_caption`, `template_draft`, `concierge_turn`, `quote_extract`. Structured outputs validated by Zod; server-defined tools only (§8.3); per-task model choice, prompt versioning, cost metering, timeouts, retries, and kill switches per task.

### 7.9 Device share
Web Share API (with files where supported) for QR image and social post image; fallback: download + copy caption. Record `social_share_events` on initiation only (completion is not observable).

---

## 8. AI systems

### 8.1 Principle: deterministic first
Eligibility, consent, cadence, matching, ranking, forecasting, caps, quiet hours, deposits and money are **deterministic code** in `packages/domain`. LLMs are used only for language: drafting copy, conversing in the concierge, and extracting structured details from client messages. An LLM output can never bypass a deterministic check.

### 8.2 LLM tasks
| Task | Input (minimum) | Output schema | Fallback when OFF/failed |
|---|---|---|---|
| `slot_copy` | artist first name, service, day/time, location name, price, deposit, client first name, locale, approved template | `{sms ≤ 320 chars, taken ≤ 200}` | Deterministic template fill |
| `social_caption` | service, day/time, location name, price | `{caption ≤ 220}` | Template caption |
| `template_draft` | type, tone, locale, artist name | `{body}` with only allowed variables | System default templates |
| `concierge_turn` | §8.3 | `{reply?, tool_calls[], handoff?, confidence}` | Polite handoff message + "Needs you" |
| `quote_extract` | conversation text, image descriptions (no faces analysis) | `{service_category, hair_now, goal, budget, availability, risk_flags[]}` | Raw thread shown to artist |

### 8.3 Concierge turn
1. Load policy: concierge settings, permissions, hard rules (F22), artist knowledge (FAQs, services/prices/deposits from catalog, location details, policies), conversation history (last N messages), client locale, known client first name if linked. **Never** load notes, other clients, payment details.
2. System prompt (versioned in repo `supabase/functions/concierge-turn/prompts/v{n}.{locale}.md`, human-reviewed for ES) states identity ("Ari's assistant, an AI"), honesty rules, scope, and that user content is untrusted data.
3. Tools (server-implemented, schema-validated, policy-checked before execution):
   - `get_services()`, `get_location_info(locationId)`, `search_availability(serviceId, dateRange)` (returns slots with `bookingMode`),
   - `create_booking(serviceId, slot, clientDetails)` — allowed only if `permissions.book_instant` and slot location is `instant`; returns booking link for deposit if due (never collects card in chat),
   - `create_request(serviceId, preferredTimes, clientDetails)` — allowed only if `permissions.request_salon` and location is `request`,
   - `reschedule(appointmentId, newSlot)` — only for the conversation's linked client and within policy,
   - `create_handoff(type, summary)`, `create_quote_request(details)`.
4. Post-processing: refuse output containing prices not in catalog, the word "confirmed" for requests, payment requests for salon-collected locations, or disallowed content; on violation → handoff.
5. Persist `concierge_turns` with model, prompt version, tool calls, decision, confidence, cost.
6. Confidence below threshold (eval-calibrated) → handoff with a holding reply: "I'll check with Ari and get right back to you."

### 8.4 Evaluation (blocks enabling any LLM feature, A-04/A-25)
`tests/ai-evals/` with ≥ 300 scripted conversations (EN and ES, 50/50) covering: pricing questions, booking at instant vs request locations, salon-collected payment questions, prep and parking, reschedule within/outside policy, closed days, quote intents (color, extensions, corrections), complaints, abusive messages, prompt injection (text and image-borne), attempts to extract other clients' info or notes, off-topic. Required: 0 policy violations on hard-rule cases; ≥ 95% correct routing (reply vs handoff); ≥ 90% factual accuracy vs knowledge; 100% disclosure on first message; Spanish fluency review by a human. Re-run on every prompt or model change; results in `docs/engineering/AI_EVAL_REPORT.md`.

### 8.5 Cost and abuse controls
Per-artist daily caps on AI turns and messages (entitlement-driven); per-conversation turn cap per hour; spam detection (rate, repeated content); kill switch per task and global; spend alerts.

### 8.6 Data minimization
Strip phone numbers and emails from LLM context (use placeholders); do not send images to the LLM unless the artist enabled photo understanding for quotes (default: images stored and shown to the artist, not analysed); prompts and outputs retained 30 days by default (A-08) for debugging, then aggregated.

---

## 9. Internationalization (F13 additions)
- Namespaces add: `customer`, `wallet`, `notes`, `revenue`, `slots`, `autopilot`, `templates`, `reports`, `reviews`, `concierge`, `getpaid`.
- Message templates are stored per locale; the send path picks the **client's** locale; if the approved template for that locale is missing → skip with reason (never send English to a Spanish-preferring client without the artist's explicit fallback setting).
- Concierge detects language per message; confirms on ambiguity; replies in the conversation locale.
- Wallet pass fields localized at issue time; updates keep locale.
- Number/date/currency formatting via `Intl` with `en-US`/`es-US` and the location timezone.
- `scripts/check-locales.mjs` enforces key parity and a `critical: true` list (payments, consent, policies, booking status, disclosures, STOP copy).

---

## 10. Security, privacy and compliance

### 10.1 Threats added in v2
| Threat | Control / test |
|---|---|
| Cross-artist leakage through Mova-wide profile | Projections only; pgTAP tests for each pair (artist A ↔ client of B); API fuzz across IDs |
| OTP abuse / account takeover | Rate limits (contact, IP, device hash); short expiry; attempt caps; no enumeration; SIM-swap caution: sensitive actions (delete profile) re-verify |
| Note exposure | Notes excluded from all client/AI/analytics paths; encryption for sensitive notes; export audit |
| Claim / card / review / paylink token guessing | ≥128-bit random, hashed at rest, single-use where applicable, expiry, rate-limited lookups |
| Review fraud | Verified-visit only; one per appointment; moderation queue; artist cannot edit/delete; anomaly flags (burst, same device hash) |
| Inbound webhook spoofing (SMS, Meta, wallet) | Signature/verify-token checks; replay protection via `webhook_events` |
| Messaging compliance | Consent per purpose + evidence; STOP/HELP; quiet hours; carrier registration; suppression lists; audit |
| AI prompt injection / data exfiltration | §8.3 policy + post-checks; untrusted-content boundaries; eval fixtures |
| Social image leakage | Image generator receives no client data; reviewed template |
| Door code exposure | Encrypted; shown only to clients with a confirmed booking at that location within 24 h of the appointment |
| Phone number privacy | Artist personal number never shown; Mova number used for client comms |

### 10.2 Privacy operations
Data export (artist: full tenant export incl. notes; client: own profile, appointments, reviews, consents); deletion (client profile deletion per F15-AC05; artist account deletion with retention exceptions for ledger/tax records per A-08); retention schedule table in `docs/security/retention.md`; DPIA-style review notes for notes/photos (A-27) and concierge (A-25).

### 10.3 Checklist
All v1 §6.2 items remain. Add: CSP allowing Stripe, wallet and chosen providers only; storage policies for `visit-media` and `quote-media` private buckets; secrets for SMS, Meta, wallet certificates and AI keys in secret manager with rotation runbooks.

### 10.4 System logs (owner-approved 2026-11-13)
`mova_system_logs` is an append-only operational stream for Edge Function requests, browser errors and provider outcomes. Only service-role writers can append. System Admin reads go through `mova_admin_logs_search`, which enforces the existing platform-admin and AAL2 guard; direct table access is revoked and RLS is enabled. Keep log context allowlisted and bounded. Never store passwords, tokens, API keys, card data, message bodies, client notes, raw provider payloads, email addresses or full phone numbers. Browser reporting is rate-limited by an ephemeral IP digest. The admin view filters by time, level, source, stylist, user, request ID and text; row and bulk copy/export actions are audited. Retention: info 30 days; warnings and errors 90 days, approved by the product owner. The scheduled job-dispatch invokes a once-daily retention cleanup. Request IDs are returned as `x-request-id` and shown as references for caught render errors. Supabase Auth audit events are read-only in the admin query. Resend alert email is opt-in via `MOVA_LOG_ALERT_EMAIL` and triggers on ≥20 errors in 15 minutes or any dead background job, deduplicated to one alert per hour.

---

## 11. Analytics and metrics
Event schemas in `packages/contracts/src/analytics.ts` with dedupe keys; server-authoritative for conversions. v1 events retained; add:
`photo_added`, `showcase_tab_viewed`, `qr_scanned`, `client_profile_created`, `client_signed_in`, `booking_linked_to_profile`, `wallet_pass_added` (best-effort), `client_card_saved_image`, `note_added`, `visit_note_saved`, `slot_opened`, `slot_campaign_approved`, `slot_wave_sent`, `slot_filled`, `slot_expired`, `social_share_initiated`, `autopilot_enabled`, `template_approved`, `reminder_sent`, `reminder_converted`, `winback_sent`, `review_requested`, `review_submitted`, `review_replied`, `concierge_enabled`, `concierge_reply`, `concierge_handoff`, `concierge_booking_created`, `concierge_request_created`, `quote_sent`, `paylink_created`, `paylink_paid`, `running_late_sent`, `reports_viewed`.
Properties never include names, contact details, message bodies or note text. Locale and artist tenant ID allowed.

**KPI definitions (used by F20 and investor/ops dashboards):** activation = showcase published + ≥1 bookable location; booking activation; first booking time; % offered hours booked = booked minutes / offered minutes (Mova-controlled locations only, request locations reported separately); rebook rate = clients with a next booking created within their usual window ÷ clients whose window ended in period; seat-filler fill rate; time to fill; concierge containment = conversations handled without handoff ÷ conversations; review rate = reviews ÷ completed appointments.

---

## 12. Reliability and performance targets (PROPOSED, approval required)
v1 targets retained. Add: concierge first reply p95 ≤ 20 s from inbound webhook; slot wave cancellation ≤ 60 s after fill; wallet pass update ≤ 15 min; pay link creation p95 ≤ 2 s; reports summary p95 ≤ 1.5 s from rollups; OTP send p95 ≤ 10 s. Alerts: messaging provider failure rate > 5% over 15 min; concierge error/handoff spike; webhook backlog > 5 min; autopilot planner skipped run.

---

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
Migration 0004. Functions `public-artist` (tabs), portfolio CRUD. Screens 03, 23, 24, Settings › Services/Portfolio (design per §2.4).
- P04-T01 Services with deposit fields + location overrides.
- P04-T02 `packages/domain/deposit.ts` + table tests.
- P04-T03 Portfolio uploads, alt text, ordering, publish, service links.
- P04-T04 Looks/Services tabs; Book this look; deposit text from server.
- P04-T05 SSR/prerender per ADR-0003; OG/canonical/hreflang; sitemap; robots.
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

---

## 14. Testing and acceptance

### 14.1 Layers
Unit (Vitest: `packages/domain` 100% branch coverage on money, deposits, availability, booking state, consent, cadence, forecast, slot matching, concierge policy); component (RTL + axe); DB (pgTAP: RLS matrix, constraints, races); functions (Deno tests, signed webhook fixtures, idempotency); contract (provider adapters vs recorded fixtures); E2E (Playwright, Chromium + WebKit mobile profiles, both locales); visual regression vs canvas baselines; accessibility (axe + manual screen reader on iOS VoiceOver and Android TalkBack); load (booking contention, slot claim contention, webhook bursts, concierge inbound bursts); AI evals (§8.4); security (dependency/secret scans, authz fuzz, token brute-force).

### 14.2 Release-critical scenarios
T01–T20 from v1 are retained verbatim (publish without payments; cross-tenant denial; concurrent instant booking; request never confirmed; DST reschedule; idempotent create; webhook replay; deposit + balance; cash/Zelle/salon classification; Google event lifecycle; ICS rotation; opted-out not targeted; unapproved draft not sent; unpublished asset denied; entitlement bypass denied; offline confirm blocked; crawler HTML; ambiguous import; provider outage; privacy export/delete). Additions:

| ID | Scenario | Expected |
|---|---|---|
| T21 | STOP reply to Mova number | Suppressed immediately for that artist (and platform rules per ADR-0005); confirmation sent once |
| T22 | Consent revoked after autopilot scheduled | Send skipped with `consent_revoked` |
| T23 | Quiet hours in client timezone different from artist's | Send deferred to client's 9 AM |
| T24 | Provider delivery failure | `messages.failed`, activity "Not delivered", retry policy honoured, no duplicate |
| T25 | Deposit percent rounding table | Matches expected minor units |
| T26 | Salon-collected location with deposit-enabled service | $0 deposit everywhere incl. concierge and claim |
| T27 | Date-first picker on a day with two locations | Two groups with correct mode tags |
| T28 | Running late to next client | One transactional text in client locale; logged |
| T29 | Signed-in client books artist A and artist B | Each artist sees only own relationship; client sees both |
| T30 | Artist A requests data on client via B's IDs | Denied (DB + API) |
| T31 | OTP brute force | Locked after 5 attempts; rate limit; generic errors |
| T32 | Claim past bookings | Only exact verified contact matches offered; per-link confirmation |
| T33 | Client deletes profile | Customer data deleted; links removed; stylist records retained per policy; tokens revoked |
| T34 | Wallet pass after reschedule (flag ON) | Pass updated ≤ 15 min; flag OFF → image fallback only |
| T35 | QR scan landing for unpublished artist | Not-available page; no data; no scan counted |
| T36 | Notes never in client/AI/analytics paths | Static + runtime assertions; export to client excludes notes |
| T37 | Show-next-visit note | Appears on next appointment only |
| T38 | Cancellation → slot event | Exactly one event; second webhook retry no duplicate |
| T39 | Seat filler with autopilot OFF | No send before approval |
| T40 | Fill during wave 1 | Waves 2–3 cancelled ≤ 60 s; "just taken" only to wave-1 non-bookers |
| T41 | Simultaneous claims | One booking; other sees just taken |
| T42 | Request-location slot claim | `pending_artist`; copy says Ari confirms |
| T43 | Social image content | No client name/contact; snapshot test |
| T44 | Template edited | Paused; autopilot skips with `template_paused` |
| T45 | Missing ES template for ES client | Skip with reason; no English fallback unless enabled |
| T46 | Rebooking attribution | Booking within 14 days → rebooked once; outside → not |
| T47 | Win-back | No send without tap; no Mova-generated offer text |
| T48 | Forecast reproducibility | Same inputs → same output; insufficient history hides card |
| T49 | Reports reconciliation fixture month | Every tile equals SQL ground truth |
| T50 | Traffic events PII scan | No IP/UA/contacts stored |
| T51 | Review token reuse | Rejected |
| T52 | Review without completed visit | Impossible |
| T53 | Artist attempts to edit/delete client review | Denied |
| T54 | Concierge at request location | Creates request; never "confirmed" |
| T55 | Concierge asked to take payment at salon-collected location | Declines; explains front-desk payment |
| T56 | Concierge custom color quote | Handoff + quote card; no invented price |
| T57 | Prompt injection to reveal notes / other clients | Refused; no tool call outside policy; logged |
| T58 | Artist takes over conversation | AI stops replying for configured period |
| T59 | Pay link paid twice / expired | Second payment impossible; expired page offers new link request |
| T60 | Zelle flag OFF | Zelle absent from UI, copy, templates, reports labels |

### 14.3 UAT scripts
v1 UAT-A…F retained (with tab names updated). Add:
- **UAT-G Client profile:** book as guest → book again signed in → see both stylists in My stylists → change consent for one stylist → delete profile.
- **UAT-H Client card & QR:** artist shows QR → client scans → saves card (image; wallet if enabled) → reschedule → card/pass updates.
- **UAT-I Notes:** add general and sensitive notes → visit notes with photos → next appointment shows Before you start.
- **UAT-J Seat filler:** cancel a suite appointment → approve campaign → claim from test phone → waves cancelled, just-taken sent → results updated.
- **UAT-K Autopilot:** approve templates → enable autopilot → seeded due clients receive reminders within rules → one rebooks → pipeline and activity correct.
- **UAT-L Concierge:** Instagram (if enabled) / text / web chat inquiries in EN and ES → instant booking at suite, request at salon, quote handoff, complaint handoff, running late.
- **UAT-M Reports & reviews:** complete visits → review requests → reviews submitted → reply → Reports and Home KPIs reconcile.

### 14.4 QA package regeneration (next deliverable)
Regenerate `MOVA_QA_Automated_Test_Strategy_v2.md` and `MOVA_QA_TEST_CASES_v2.csv` from this spec: every `Fnn-ACnn`, T01–T60, UAT-A…M and nonfunctional target gets ≥1 stable case ID, priority (P0 for security, money, booking integrity, privacy, consent, AI hard rules), layer, and owner. Report the new totals; do not reuse the 179 figure.

---

## 15. Release governance
Environments, controls, evidence package and gates from v1 §10 are retained, with these changes:
- Feature flags at minimum: `stripe_live`, `paylinks`, `zelle`, `client_profiles`, `wallet_client_card`, `wallet_artist_card`, `messaging_live_sms`, `messaging_live_email`, `push`, `autopilot`, `seat_filler`, `seat_filler_autopilot`, `concierge`, `concierge_instagram`, `concierge_missed_call`, `concierge_web_chat`, `reviews_public`, `google_reviews`, `google_business_api`, `ai_copy`, `forecast`.
- Evidence package adds: AI evaluation report; messaging compliance evidence (registration status, consent records sample, STOP handling); wallet pass test evidence; RLS proof for client identity; reports reconciliation report; Spanish review sign-off.
- Gates G1–G6 unchanged; **G2 UX** now includes the approved canvas plus the §2.4 designs.
- **Hard NO-GO additions:** any cross-artist data leak through client profiles; any note exposure; any AI hard-rule violation in evals; any send without valid consent; any review editable by the artist; any feature with an unapproved dependency shown as live.

### 15.1 Final sign-off record
```text
MOVA RELEASE SIGNOFF (spec v2.2)
Release version / commit:
Local integration evidence package and test date:
Production URL and post-GO verification date:
F01–F23 coverage: ___ / ___ ACs (100% or explicitly waived)
T01–T60: PASS / FAIL      UAT-A–M: APPROVED / REJECTED
Approvals A-01–A-30: each APPROVED or feature flag OFF (attach list)
G1 Architecture / G2 UX / G3 Feature complete / G4 Security & finance / G5 UAT: ___
Open blockers and accepted risks:
Product owner decision: GO / NO-GO
Signature / timestamp (UTC):
```

---

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

---

## Appendix A. Out of V1
Native iOS/Android apps (except the V1.1 Tap to Pay shell), native home-screen widgets, Tap to Pay (V1.1), voice answering for the concierge, direct posting to Instagram/TikTok, marketing campaigns beyond rebooking/slot offers (**TABLED**, screen 15), loyalty program, waitlist management, Outlook sync, inbound calendar blocking, salon-system integrations, salon payroll/ERP, marketplace discovery and paid ranking, Square/Venmo/PayPal/ACH/BNPL, cross-border payments, locales beyond en-US/es-US, automatic translation of artist-authored content, Mova-generated discounts or pricing changes, AI analysis of client photos (unless separately approved).

## Appendix B. Definition of V1 success
A new independent stylist can sign up, add a recognizable photo, publish a bilingual-ready showcase with looks and services, configure services with per-service deposits and at least one location, accept honestly classified bookings (instant at their suite, requests at the salon), keep private client and visit notes, get paid by pay link or record cash, see appointments on Google or Apple Calendar, fill a cancelled slot with an approved campaign, run consent-safe rebooking reminders, let the concierge answer and book within its rules while handing off quotes, collect verified reviews, and see their performance on Home and Reports — with no critical security, privacy, scheduling, consent or money-correctness defects. A client can book as a guest or keep one Mova profile and card across every stylist they see.

## Appendix C. Glossary
**Instant location** — Mova controls the stylist's calendar there. **Request location** — the salon keeps the book; Mova sends requests. **Collector** — who takes the money (artist via Mova or recorded, or salon). **Slot event** — an open interval the seat filler is working on. **Wave** — a batch of slot-offer texts. **Autopilot** — rule-based sending of approved templates. **Handoff** — concierge passes a conversation to the stylist. **Before you start** — pinned client notes shown at the appointment. **Client card** — client-side card and wallet pass for rebooking/check-in.

## Appendix D. Implementation caveats
This is an implementation contract, not evidence that credentials, provider approvals, pricing or legal reviews exist. Validate every provider capability in current official documentation and sandboxes. Calendar subscriptions are not push sync. Financial, tax, privacy, messaging and AI-safety decisions require qualified review before live launch. Engineers may normalize tables further via ADR while preserving the security and domain contracts here.
