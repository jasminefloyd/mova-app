# MOVA — Master Product & Business Blueprint
**Version:** 1.0 · **Date:** 2026-11-04 · **Status:** Consolidated decision baseline; outstanding approvals explicitly flagged · **Owner:** Product owner

> **Mova (`mova.`)** — **Your business moves with you.** A mobile-first, artist-owned business home for independent hairstylists: get discovered, showcase work, get booked, get paid, and keep clients coming back. **This document describes the intended product, not a currently live service.**

## Document control and source hierarchy
This is the **authoritative product/business intent**. The updated `MOVA_PRD_Technical_Architecture_Engineering_Handoff_v1.md` is the normative implementation contract; `MOVA_Codex_File_by_File_Implementation_Plan_v1.md` is the file-level execution contract; `MOVA_QA_Automated_Test_Strategy_v1.md` and case CSV are test baselines; the acquisition launch package contains nonproduction HTML previews. If they disagree, **stop, log discrepancy, obtain owner decision, and synchronize all affected documents**. Neither an agent nor a sales rep can silently resolve ambiguity. A locked feature with an unresolved external-provider approval is a **release dependency**, not proof that a live integration is ready. This document uses **LOCKED**, **PROPOSED**, **OPEN**, and **DEFERRED** precisely.

## 1. Executive summary
Mova addresses a structural problem: a stylist's reputation, portfolio, clients, booking, availability, and income often sit in disconnected tools or within the salon's systems. When the stylist changes chairs or works at several venues, their business identity should not reset. Mova gives the professional a portable public showcase and an operating layer without claiming to replace every salon system. **Hair-first, artist-owned, mobile-first, bilingual US launch.** The customer books through the artist's public link, without a required customer account. The stylist manages their business through one installable PWA.

**Business hypothesis (unvalidated):** the combination of portable identity, multi-location-aware booking, client continuity, and opt-in growth intelligence can win a meaningful subset of independent stylists despite established booking tools. Validate through interviews, activation, retention, and paid conversion; do not equate waitlist interest with willingness to pay.

## 2. Who it is for
**Primary ICP — LOCKED:** US independent hairstylists: booth/chair renters, commission-based stylists who control some client relationships, stylists working at two or more locations, and stylists transitioning between salons. Their priorities are professional visibility, client continuity, appointment accuracy, simple payment handling, and rebooking.

**Secondary ICP — LOCKED but not launch marketing focus:** independently operating barbers, nail artists, lash artists, estheticians, and related beauty professionals with similar business models. Hair-specific language and service taxonomy come first; underlying schemas should not hardcode hair as the only profession.

**Other actors:** clients/guests booking appointments; salon operators as external stakeholders (not primary buyers); Mova support/admin with restricted audited access. **Not the target:** multi-employee salon ERP buyers, national chains, consumers looking for a generic beauty marketplace.

**Research questions:** Which segment controls its own booking inventory? Who legally controls/export client information? What booking/payment stack is already used? What is their actual willingness to pay? How often do multi-location conflicts occur? Do Spanish-speaking stylists prefer a full Spanish operational UI or bilingual communication? Avoid assuming uniform salon policies.

## 3. Product vision and principles
**Customer promise:** *Your business moves with you.* Five verbs: **Discover → Showcase → Book → Pay → Rebook**. The artist's profile/link, portfolio, policies, and relationship history remain usable when locations change, subject to permission and law. The product must never pretend to know external salon availability, silently send AI marketing, claim custody of salon-owned records, or disguise gross service value as artist earnings.

**Product principles:** (1) artist identity is portable; (2) location-specific truth beats false convenience; (3) no account required for a guest to book; (4) mobile-native ergonomics in a web PWA; (5) financial and consent accuracy over flashy demos; (6) bilingual by design; (7) honest integration capability and recoverable failures; (8) artist-approved outreach; (9) explicit data ownership and revocation controls; (10) showcase value can precede booking activation.

## 4. How Mova works — end-to-end journeys
### 4.1 Artist setup
Create account and verify email → choose preferred language (`en-US` default, `es-US` optional) → create public identity/handle → add specialties and portfolio → configure services and prices → configure one or more work locations, working hours, service eligibility, booking mode, payment collector, policies and time zone → optionally connect Stripe/Google Calendar → preview → **publish showcase**. The showcase can publish without Stripe or booking. Booking only turns on after valid location, service, schedule and policy setup. Six onboarding stages: Account, Artist Profile, Services, Work Location, Payments, Preview & Publish; allow skip where payment collection is salon-only.

### 4.2 Customer discovery and booking
Guest follows artist's branded URL, QR, social link or search result → views portfolio, specialties, services, policies and locations → selects service or **Book This Look** → chooses location/date/time → sees explicit booking status. **Instant booking** is allowed only for inventory Mova controls; **request-to-book** is required when an artist must verify an external salon booking system. Request receipt is **not confirmation**. Customer gets an appropriate localized status notification and a secure limited appointment-management link.

### 4.3 Calendar and operations
Artist's five tabs: **Home, Calendar, Clients, Growth, Business**. Multi-location availability respects time zones, duration, buffers, lead time, exceptions and appointments. Google Calendar receives outbound Mova appointment updates via OAuth; Apple Calendar subscribes to a private, revocable `.ics` feed and refreshes on Apple's schedule. Both may appear in device calendar widgets. **Neither is a guaranteed two-way conflict blocker in V1.** External salon calendars require manual confirmation unless an approved supported integration exists.

### 4.4 Client relationships and money
Artist manages consented client directory, service history, preferences/formulas and permitted CSV imports with deduplication. Payment flows distinguish **gross service value**, **Mova-processed amount**, **artist-collected**, **salon-collected**, **refunds**, **platform fees**, and **estimated artist earnings**. Stripe handles supported online payments/deposits; cash and Zelle are manually recorded; salon-collected payments are tracked, not charged a Mova processing/platform fee. No false implication that manual payments are verified or settled by Mova.

### 4.5 Growth
Predictive rebooking estimates service-specific return windows, surfaces an explainable recommendation and suggests appropriate clients/empty slots. The AI Revenue Agent may draft outreach but **artist approval and valid consent are required before sending**. Store evidence, attribution, audit history, opt-outs and failures; model output is advisory, not an autonomous sales promise.

### 4.6 Public presence and wallet
Offer Google Business Profile booking-link guidance and eligible API operations only after provider permission checks. Provide a shareable stylist identity/QR card; native Apple/Google Wallet passes are conditional on issuer/certificate approval, with a working non-wallet fallback.

## 5. Visual identity and interaction design
**LOCKED:** editorial, premium, beauty-forward; never a generic B2B dashboard. Brand `mova.` and tagline *Your business moves with you.* Forest `#18392F`, botanical `#264E3E`, sage `#8BA990`, mint `#C9E6D4`, peach `#E7C3AA`, ivory `#F7F5EF`. **Manrope** for headings, **DM Sans** for interface. Use authentic licensed hairstylist/portfolio imagery, botanical/organic motifs, clear whitespace, subtle warm accents and accessible contrast. Public artist pages may be expressive; operational screens prioritize legibility, thumb reach, clear status and minimal taps. Design **mobile-forward**, not merely responsive: sticky actions, short forms, tap targets, accessible modal/focus behavior, loading/empty/error states, 320–360px testing, keyboard and screen-reader support.

**Logo status:** a proposed forest/cream wordmark with flowing peach/gold motif has been generated; **final vector lockup, trademark clearance, favicon and usage standards are OPEN**, not assumed approved merely because a concept exists. Existing landing page and 26-screen HTML prototype are **illustrative previews**, not production components.

## 6. V1 feature commitments and product boundaries
| ID | V1 domain | What must actually work | Guardrail |
|---|---|---|---|
| F01 | Account/onboarding | Auth, persistent six-step setup, preview/publish, artist language preference | No forced Stripe for salon-collected services |
| F02 | Showcase/portfolio | Crawlable public profile, service links, Book This Look, social sharing, QR | Private/draft content excluded from index |
| F03 | Services/locations/availability | Location-specific rules, timezone/DST, buffers, booking mode | Never infer external salon inventory |
| F04 | Booking | Instant vs request, conflict-safe booking, lifecycle and notices | Request ≠ confirmed |
| F05 | Clients | Consent, service history, preferences, import/dedupe, privacy | No unauthorized salon data harvesting |
| F06 | Money | Stripe-supported deposits/payments, manual cash/Zelle, salon-collected tracking, immutable ledger | No fee on non-Mova-processed transactions |
| F07 | Calendars | Google outbound OAuth, private revocable Apple `.ics` feed | No guaranteed two-way sync |
| F08 | AI/rebooking | Explainable predictions, approved consent-checked outreach, audit | No unsupervised AI sends |
| F09 | Google presence | Eligible integration or honest manual booking-link path | Provider restrictions respected |
| F10 | Artist wallet/share | Identity/rebook QR card; wallet passes if approved | Functional fallback required |
| F11 | PWA/notifications | Installable responsive web app, appropriate offline states, email/in-app and supported push | No native app/widget claim |
| F12 | Plans | Configurable plans, entitlements, billing, fees only where applicable | Final pricing/entitlements approval gate |
| F13 | Localization | Full core `en-US` + `es-US` workflows, templates, policies, validation, accessibility | Artist and guest locale independent |
| F14 | Acquisition | Public bilingual SEO/AEO site, articles, calculator, secure consented waitlist and attribution | No fake signups or unverified claims |

**F13 and F14 are newly explicit cross-cutting V1 domains.** They extend the existing F01–F12, not replace them. Native Apple/Google Wallet pass delivery is **conditional**; the QR/share-card fallback is the guaranteed experience. Google Business API functionality is **conditional**; manual guidance is the guaranteed experience. Financial/marketing integrations must pass provider and legal gates before live activation.

## 7. Bilingual US language strategy — LOCKED
Default **US English (`en-US`)**, with **US Spanish (`es-US`) as a V1 launch requirement**. Separate artist UI locale from guest booking locale; allow language switch before login and within public booking. Persist preferences; use `en-US` fallback for missing noncritical strings but **missing critical translations block release**. Localize onboarding, navigation, validation, booking status, payment/refund notices, transactional email/SMS, consent/privacy and critical policy language, help for core journeys, AI draft review, landing pages, calculator and core acquisition content. Artist-authored bio/portfolio/service descriptions **are not automatically translated**; label original language and offer optional future assisted translation with review. Format USD and US time zones appropriately; Spanish does **not** imply support for other countries, currencies, tax regimes or localized payment methods. Human review for critical legal/financial Spanish. Avoid machine-only unchecked policy copy.

SEO uses separate indexable `/en/` and `/es/` marketing routes (or owner-approved equivalent), correct canonical and reciprocal `hreflang`, translated metadata, XML sitemaps and crawlable HTML. Public artist pages need a deliberate locale/canonical strategy without duplicating artist-authored content; default to one canonical artist URL with localized UI state unless an ADR proves genuinely differentiated translated content. Tests include locale switching, direct-link preservation, cross-locale checkout, long labels, accessibility, email templates and missing-key CI checks.

## 8. Technical architecture and delivery
**LOCKED stack:** React + TypeScript + Vite, React Router, TanStack Query, Tailwind/Mova tokens, `vite-plugin-pwa`, hosted on Vercel; Supabase PostgreSQL/RLS, Auth, Storage, Edge Functions, Realtime and scheduled durable work. Monorepo with `apps/web`, `packages/contracts`, `packages/design-tokens`, `supabase`, `tests`, `docs`. Shared app serves `/app/*` and public showcase/booking. Public SEO pages require approved prerender/SSR or server-visible HTML; client-only React metadata is insufficient. Use `react-i18next` (recommended implementation choice) with versioned typed locale catalogs, Intl formatting and explicit fallback rules. Record SSR/prerender decision by ADR before public pages ship.

**Trust boundaries:** all tenant-owned records scoped by `artist_business_id` and RLS; signed guest tokens scoped/expiring; no service role key in browser; server-authoritative booking transactions, payment fees, entitlements and consent; money in integer minor units; time in UTC plus IANA zone; durable outbox, idempotent webhook processing and retries. Audit privileged actions, data export/deletion, messaging consent and financial changes. Provider secrets server-side; use staging/sandbox for Stripe, Google and messaging until approvals.

**Release dependencies OPEN:** Stripe Connect charge topology/merchant-of-record/disputes/tax; messaging provider and deliverability; AI vendor/eval and budgets; Google Business API eligibility; wallet pass certificates; domain/trademark; privacy/consent/retention and salon data rights; plan entitlements; financial estimate semantics; localized legal review. Build honest fallback or block affected capability—do not mark conditional V1 features production-ready without approvals.

## 9. Engineering execution and Codex drift prevention
**Start from an empty repository.** Phases P00–P15: P00 contract/guardrails; P01 app/infrastructure; P02 design/PWA; P03 identity/onboarding; P04 showcase; P05 locations; P06 booking; P07 clients; P08 money; P09 calendars; P10 AI; P11 Google presence/wallet/notifications; P12 plans/analytics; P13 hardening; P14 E2E/UAT; P15 owner signoff/release. **F13 localization begins in P00/P01 and continues through every phase. F14 acquisition starts P01/P02 and is release-gated in P14/P15.** Do not postpone either until final QA.

Root `AGENTS.md` enforces read-first baseline, phase scope, unique requirement IDs, exact file manifest, test-first or test-alongside, traceability, PR evidence, explicit blockers, human review and no unapproved architecture changes. `PHASE_STATUS.md`, `REQUIREMENTS_MATRIX.csv`, ADR/decision log and change requests survive Codex context resets. A task is DONE only after real code, integrated flow, automated test, evidence and review. No placeholder, skipped P0 or mocked provider counted as live integration. All prior accepted critical paths rerun after each phase. Product owner alone authorizes production GO.

## 10. QA, acceptance and release validation
Existing QA baseline: **179 specified cases (159 P0, 20 P1)** across unit, component, DB/RLS, Edge contracts, browser E2E, accessibility, visual, security, performance and PWA/SEO. **These are specifications, not already implemented or passing tests.** F13/F14 require **additional case IDs and regenerated counts** in QA CSV before engineers claim complete coverage; do not continue to quote 179 as exhaustive after this scope update.

Mandatory additional suites: locale catalog parity, no hardcoded UI strings, guest/artist independent locale, booking and financial Spanish translations, RTL not required, Spanish mobile layout, transactional messaging, SEO `hreflang`/canonical/sitemap/indexability, calculator edge cases and privacy, waitlist consent/rate limit/dedupe/UTM/qualification, attribution and accessible form states. P0 = all pass, no skip/quarantine; P1 requires explicit exception; security, money, privacy and booking integrity are nonwaivable. Staging must use real test providers where feasible, not just mocks. Human UAT with English and Spanish users, actual phones, and explicit owner GO/NO-GO remains required.

## 11. Acquisition, lead generation and funnel
**Primary:** evergreen SEO and AI-answer discoverability (AEO) via original useful content, crawlable pages, legitimate expertise, and clear structured information; no promise of AI answer placement. **Initial content cluster:** booth rent vs commission, keeping clients when changing salons, managing bookings across salons, independent hairstylist booking tools; original free **Booth Rent vs Commission Calculator**. English and Spanish versions of the core landing page and calculator are V1; prioritize human-reviewed Spanish versions of initial articles. **Community:** Reddit and relevant stylist Facebook groups/forums for transparent research and helpful participation, not automated spam or covert promotion. **Paid test:** $200 total experiment, initially $150 Meta with two creative angles (independence and portfolio/bookings), $50 uncommitted reserve; Google Search only if intent/CPC justify; Reddit paid deferred pending organic learning. This is an **experiment**, not a committed CAC forecast.

**Funnel:** search/AI/community/ad/referral → localized landing page or calculator → transparent optional waitlist with consent and qualification → email nurture → product invitation → artist profile published → booking enabled → first completed booking → repeat booking → subscription upgrade. Track source/medium/campaign, locale, consent and qualification. Privacy-respecting events: `landing_view`, `calculator_view`, `calculator_completed`, `waitlist_submit`, `waitlist_success`, `qualified_artist_signup`, `artist_signed_up`, `showcase_published`, `booking_enabled`, `first_booking_completed`, `subscription_started`. **Never advertise unfinished features as live.** The current landing page/calculator are static prototypes: no deployed domain, live waitlist or running ads confirmed.

**Organic flywheel hypothesis:** opted-in indexable public artist showcases generate artist-specific consumer discovery and referral exposure; avoid indexing draft/private profiles, doorway pages, thin duplicative content or client data. Validate search traffic and quality rather than assuming automatic ranking.

## 12. Monetization and sales motion
**PROPOSED, not approved commercial terms:** Free `$0/month + 1.5%` Mova platform fee; Pro `$19/month + 1.0%`; AI Growth `$39/month + 0.5%`, only on eligible **Mova-processed** payments; Stripe processing extra. No Mova transaction fee on manually tracked cash/Zelle or salon-collected transactions. Exact plan entitlements, caps, billing/refund policy, and payment topology remain OPEN. Do not launch live paid subscriptions or quote final binding terms until approval. Avoid implying all payment methods are available for all artists/devices.

**Sales motion:** digital-first self-serve, not cold-call-heavy. Free public showcase/QR as low-friction entry; early access waitlist and practical calculator lead magnet; product-led invitation to enable booking, payments and growth. Sales enablement focuses on discovery, proof and objections, not pressure. Activation and retention precede paid conversion. For sales conversations, distinguish **planned V1** from **currently available**, and never claim universal salon integrations or automatic two-way calendar sync.

## 13. Competitive differentiation and tradeoffs
**Alternatives to validate against:** GlossGenius, Booksy, StyleSeat, Square Appointments, Vagaro, Fresha, SQUIRE (barber-adjacent), salon-owned software and manual Instagram/DM/Google Calendar workflows. These are positioning comparisons, **not a current feature-by-feature market audit**. Do not claim competitors lack features without verified research.

**Differentiators Mova aims to prove:** (1) artist-owned portable identity across venues; (2) location-aware booking with honest instant/request distinction; (3) hair-first editorial portfolio with Book This Look; (4) financial visibility separating salon-collected from artist-collected from Mova-processed; (5) consent-based explainable AI rebooking; (6) bilingual US artist/guest experience; (7) free showcase before payments/booking setup. **Tradeoffs:** competitors may have deeper mature POS, native apps, marketplace demand, staff management, marketing automation or integrations. Mova must win a narrowly defined workflow rather than pretend to be the most complete salon suite.

## 14. Known adoption gaps and friction (mitigation + honest disclosure)
| Friction | Customer impact | V1 mitigation | Residual limitation |
|---|---|---|---|
| Salon controls booking | Stylist cannot guarantee open slot | Request-to-book + explicit pending state | Manual verification and slower conversion |
| Salon controls customer records | Import may be restricted | Consent-first manual/CSV import, dedupe | Some histories cannot be migrated |
| Two calendars, no inbound blocking | Double-booking risk | Clear sync direction, manual review, internal DB overlap guard | External bookings can still conflict |
| Apple `.ics` refresh delay | Device calendar may lag | Explain delay and feed revocation | No real-time Apple push guarantee |
| Payment collector varies by venue | Confusing deposits/fees/earnings | Location-specific collector, separated ledger | Complex refunds/commissions require policy review |
| Stripe onboarding | KYC/eligibility friction | Publish showcase without Stripe; manual/salon tracking | Online payment not universal |
| Artist has an existing booking link | Switching costs, fear of losing clients | Gradual showcase-first adoption; share link/QR | No automatic import from every provider |
| Clients distrust unfamiliar booking links | Booking abandonment | Clear brand, policy, status and guest checkout | Trust must be earned |
| AI recommendations inaccurate | Wrong timing, unwanted outreach | Evidence, approval, consent, feedback | Predictions are estimates |
| Spanish copy quality | Misunderstood financial/policy language | Human-reviewed critical translations | Artist-written content stays original-language |
| PWA install/push variability | App may feel less native | Clear install guidance, graceful browser fallback | No native home-screen widget in V1 |
| Artist acquisition cost | $200 test may be inconclusive | Organic content + measured qualified waitlist | SEO takes time; no ranking guarantee |
| Google/wallet provider restrictions | Feature may be limited | Manual Google link + QR/share fallback | Native/API path may not activate at launch |
| SEO artist pages and privacy | Accidental exposure | Explicit publish/index controls, noindex drafts, consent | Discoverability depends on content quality |

## 15. Explicit V1 won't-do list and rationale
| Deferred item | Why not V1 | Revisit trigger |
|---|---|---|
| Native iOS/Android apps, native home-screen widgets | PWA-first speed, cost and shared code | Proven PWA limitation/retention impact |
| Two-way Google/Apple/salon availability imports | Authorization, sync conflict and provider complexity | Measured conflict pain + viable API contracts |
| Universal salon POS/booking integrations | Many proprietary systems and legal constraints | Partner/API demand from concentrated ICP |
| Salon ERP, payroll, team scheduling, full inventory | Different buyer and bloated scope | Evidence ICP shifts to salon operators |
| Consumer marketplace and paid artist ranking | Expensive supply/demand dynamics | Strong organic artist network and demand |
| Square, Venmo, PayPal, Tap to Pay, BNPL, ACH | Extra compliance/integration matrix | Validated lost conversion by method |
| Automated outbound AI without artist review | Consent, trust and reputation risk | Explicit new policy and compliance approval |
| Autonomous pricing changes or financial advice | High consequence, unvalidated | Evidence and governance framework |
| Cross-border payments, non-US tax/currency/regimes | US-only operational focus | Validated geographic demand |
| More than `en-US`/`es-US` | Translation QA and support cost | Meaningful qualified demand by locale |
| Beauty-supply ads in free tier | Distracts from core retention and trust | Sufficient audience + curated sponsor controls |
| Advanced marketing suite, omnichannel campaigns | Too broad for launch | Retention data proves demand |
| Public automatic translation of artist-authored content | Quality, consent and meaning risks | Opt-in reviewed translation workflow |
| Podcast/community/social network, autonomous agents | Outside core hairstylist operations | Product-market fit and ROI |

## 16. Post-V1 roadmap (not promises)
**V1.x — PROPOSED:** improve Spanish editorial depth; instrument conversion/activation; add guided CSV migration; stronger waitlist/nurture; polish PWA install; more robust customer booking reminders; expanded SEO utilities. **V2 candidates — DEFERRED:** opt-in inbound busy-time imports, supported salon partnerships, Square and other payments, more advanced AI segmentation, additional beauty vertical workflows, improved native wallet passes if approved, expanded consented communications. **Longer-term bets:** native apps/widgets if justified, broader internationalization, curated beauty-supply sponsorship, marketplace/discovery only after artist density and customer demand are proven. No item is automatically scheduled or approved by its appearance here.

## 17. Metrics and validation framework
**Acquisition:** qualified waitlist signups, source/locale, organic nonbrand search clicks, calculator completion, cost per qualified signup (paid experiment), content-to-signup rate. **Activation:** signup → published showcase, time to publish, booking enabled, calendar connection, first booking. **Engagement/retention:** completed appointments per activated artist per month (north star), repeat bookings, 30/90-day active artist retention, location usage, request-to-confirmation time. **Revenue:** paid conversion, MRR, net processed volume, platform-fee revenue, payment failure/refund/dispute rates, churn and contribution margin. **Trust/reliability:** double-booking incidence, stale sync, job failure, support tickets, consent violations (target zero), Spanish critical-flow failures (target zero). Define event schemas, denominators and cohorts before reporting. **Go/no-go:** no launch with failing P0, privacy/money/booking violations or unapproved live providers; owner signs final gate.

## 18. Open decisions, risks and owner approvals
| Decision | Status | Required owner action |
|---|---|---|
| Final domain, trademark, logo vector lockup | OPEN | Legal/brand/domain clearance |
| Free/Pro/AI Growth entitlements and final pricing | OPEN | Approve commercial matrix and billing copy |
| Stripe Connect topology, KYC, disputes, tax and merchant of record | OPEN | Financial/compliance architecture approval |
| Email/SMS provider, cost limits and opt-out semantics | OPEN | Vendor and consent policy signoff |
| AI vendor, evaluations, accuracy and spend caps | OPEN | Model governance signoff |
| Google Business Profile API eligibility | OPEN | Provider capability review; manual fallback |
| Native wallet pass issuer/certificates | OPEN | Provider/certificate approval; QR fallback |
| Client ownership/import, privacy, deletion/retention and policy translations | OPEN | Legal/privacy and Spanish-language review |
| SEO public route SSR/prerender implementation | OPEN ADR | Approve rendering architecture before P04 |
| Localization library (`react-i18next`) | PROPOSED default | Engineering ADR; equivalent requires approval |
| Production SEO canonical domain and artist URL shape | OPEN | Approve final URL design |
| Marketing/ads launch and spend | PROPOSED | Approve $150 Meta test + $50 reserve; no spend assumed |
| Performance/SLO and coverage thresholds | PROPOSED | Approve measurable staging thresholds |

**Known major risks:** insufficient differentiation versus incumbent booking tools; salon-system dependencies; unclear client-data rights; platform payment costs/complexity; slower SEO ramp; PWA platform limits; AI outreach trust; multilingual QA load; underfunded acquisition learning. Mitigate with narrow ICP interviews, transparent status, feature flags, staged rollout, strong QA and explicit decision logs. **Never present an unresolved assumption as an approved launch promise.**

## Appendix A. Traceability and handoff map
- **Business/product:** this blueprint §§1–18.
- **Engineering requirements:** `MOVA_PRD_Technical_Architecture_Engineering_Handoff_v1.md`, features F01–F14, approvals A-01–A-15, security and release gates.
- **File-level execution:** `MOVA_Codex_File_by_File_Implementation_Plan_v1.md`, P00–P15, unique `MOVA-I18N-*` and `MOVA-ACQ-*` tasks.
- **QA:** `MOVA_QA_Automation_Package_v1/MOVA_QA_Automated_Test_Strategy_v1.md` + `MOVA_QA_TEST_CASES.csv`; add F13/F14 cases and refresh counts before acceptance.
- **Acquisition previews:** `MOVA_Acquisition_Launch_v1/` (static, not live).
- **Brand reference:** approved editorial concept image; logo is still concept-level pending vector/clearance.

## Appendix B. Release acceptance checklist
- [ ] All F01–F14 acceptance criteria mapped to implementation and tests; no silent gaps.
- [ ] English/Spanish core artist + guest workflows demonstrated on mobile.
- [ ] SEO pages and artist public previews crawlable with correct privacy and locale metadata.
- [ ] Waitlist real consented persistence and calculator tested, no fake success.
- [ ] External providers approved and staging verified; conditional capabilities use truthful fallback.
- [ ] No skipped P0, unapproved P1, open nonwaivable security/money/booking/privacy defects.
- [ ] Final product-owner written **GO** recorded against release SHA.
