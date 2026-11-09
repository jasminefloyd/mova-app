# Decision log

Normative source: `docs/product/ENGINEERING_SPEC.md` v2.2. Locked decisions are transcribed without resolving unrelated approval items.

## Locked decisions

| ID | Decision | Status | Owner / date | Source |
|---|---|---|---|---|
| D-01 | Primary ICP: independent hairstylists (booth/chair renters, suite renters, commission stylists who control some client relationships, multi-location stylists, stylists changing salons). Secondary: comparable independent beauty pros. Schemas must not hardcode hair as the only profession. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-02 | One mobile-first web app / PWA: React + TypeScript + Vite on Vercel. **Amended:** a thin native shell is permitted in **V1.1 only** for Tap to Pay (A-17). No other native code in V1. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-03 | Supabase: Postgres, RLS, Auth, Storage, Edge Functions, scheduled triggers, durable jobs. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-04 | **Amended by D-15.** Public showcase and booking work without an account. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-05 | V1 pillars: showcase; multi-location calendar; booking and payment orchestration; client relationships and notes; AI Revenue Center (rebooking, seat filler, win-back, forecast); AI Concierge; reports and reputation; Google presence; wallet cards; bilingual acquisition. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-06 | Instant booking only where Mova controls the inventory; request-to-book where a salon must verify. A request is never shown as confirmed. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-07 | **Amended.** V1 payments: Stripe-processed card / Apple Pay / Google Pay / other Stripe-supported wallets via online checkout and **pay links** (sent by text or shown as a QR code); manually recorded **cash** and **other**; **Zelle** conditional (A-16); salon-collected tracked only. No Mova fee on non-Mova-processed money. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-08 | Proposed plans unchanged (Free $0 + 1.5%, Pro $19 + 1.0%, AI Growth $39 + 0.5%, Stripe processing extra) and **not approved**. Pricing competitiveness review is open (A-26). | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-09 | Google Calendar outbound sync and Apple private subscribed `.ics` feed. No inbound availability blocking in V1. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-10 | Locked visual identity: forest `#18392F`, botanical `#264E3E`, sage `#8BA990`, mint `#C9E6D4`, peach `#E7C3AA`, ivory `#F7F5EF`; Manrope (display) + DM Sans (UI). | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-11 | No production launch without the product owner's written GO. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-12 | US bilingual: `en-US` default, `es-US` full V1; artist and client locales independent. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-13 | Bilingual acquisition surfaces (marketing site, calculator, waitlist, attribution). Paid ad test is a proposal, not spend. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-14 | Logo is a concept until vector, trademark and domain clearance (A-07, A-15). | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-15 | **New.** Artist bottom tabs: **Home, Calendar, Clients, AI Revenue, Reports.** "AI Revenue" is a working label (screen title "AI Revenue Center"); the name lives in one i18n key so it can change. **Settings** (former Business tab) opens from the artist's photo on Home. Money is reached from Reports and Settings. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-16 | **New.** One **Mova-wide client profile** per person, usable across every stylist they book with ("My stylists"). Optional, passwordless (one-time code by text or email). Guest booking stays available everywhere. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-17 | **New.** Stylist **client notes are private to the stylist** (tenant data). Neither the client nor any other stylist can read them, including through the Mova-wide profile. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-18 | **New.** Deposits are configured **per service** (none / fixed amount / percent). They are charged only when the booking's location has `payment_collector = artist`. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-19 | **New.** Card payments in V1: Stripe online checkout, pay links by text, and pay-link QR shown at the chair. Tap to Pay is V1.1. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-20 | **New.** Win-back messages are always **manual** (stylist taps Send). | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-21 | **New.** Seat filler: stylist **approves each slot text by default**; per-artist autopilot for slot texts is an optional setting (default OFF). Social posts are always shared manually through the device share sheet. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-22 | **New.** Rebooking **autopilot** sends approved templates under stylist-approved rules to consenting clients only (subject to A-21). | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-23 | **New.** Reviews come from two sources shown together: **Mova verified-visit reviews** and **Google reviews** (Google ingest conditional on A-05/A-20). | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-24 | **New.** AI Concierge acts as the **stylist's** assistant (not a salon receptionist): answers on Instagram, a Mova business text number, missed-call text-back and page chat; always discloses it is AI; quotes, exceptions and complaints always go to the stylist. Voice answering is out of V1. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-25 | **New.** Marketing campaigns beyond rebooking/slot offers (canvas screen 15) are **tabled**. Do not build screen 15. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |
| D-26 | **New.** Home is the stylist's at-a-glance view: KPI strip (this week's revenue, % of hours booked, rating), "Needs you", today, coming up. | LOCKED | Not recorded in source / spec v2.0 | §0.3 |

## Approval register

| ID | Decision needed | Blocks | Safe default | Status | Owner | Decision date / rationale |
|---|---|---|---|---|---|---|
| A-01 | Plan entitlements, quotas (incl. message credits, concierge volume) | F12, F18, F22 | Three plans: Free, Pro, AI Growth. Rebooking autopilot, AI Concierge, Instagram Concierge and client wallet card: AI Growth only. Manual seat-filler campaigns and text autopilot: Pro and AI Growth. Advanced reporting and public Mova reviews: Pro and AI Growth. Monthly campaign/AI credits: 50 / 250 / 1,000; AI Growth Concierge replies: 1,000 monthly, each also consumes one general credit. Transactional messages excluded. Plan prices remain open under A-26; gated features stay off pending their separate approvals. | APPROVED | Product owner | 2026-11-07; owner decisions in chat; entitlements only, no feature activation |
| A-02 | Stripe Connect account type, charge topology, merchant of record, refunds, disputes, negative balances, tax | F06, F23 | Stylist-managed Standard accounts with direct charges; customer-facing service seller is the stylist's business; Mova fee 1.5% (150 bps), proportionally refunded; stylist handles disputes and Stripe processing fees; Stripe bears connected-account losses; stylist handles tax. Legal classification has not been independently verified. Live processing OFF pending provider setup and release approval. | APPROVED | Product owner | 2026-11-07; owner decisions in chat; ADR-0007 |
| A-03 | Email and SMS providers, sending limits, cost caps | F11, F08, F18, F22 | Resend email + Twilio SMS; campaign/AI messages use monthly A-01 plan allotments with no separate daily cap; initial combined provider spend ceiling $100/month, hard stop at cap. Transactional credits are excluded from plan allotments. Live sending remains OFF pending credentials, sending identities, A-08 and A-24. | APPROVED | Product owner / engineering lead under owner delegation | 2026-11-07; providers and monthly-only limit selected by owner; initial cost cap selected under owner delegation |
| A-04 | AI model vendor(s), evaluation thresholds, spend caps | F08, F18, F22 | Claude primary with OpenAI API fallback (ChatGPT product plan is not an API credential). Provider key placeholders are in ignored `.env` and `.env.example`; no adapter is wired. Deterministic baselines remain; AI stays OFF until evaluation thresholds, model configuration, and spend caps are approved. | OPEN | Product owner | 2026-11-07; owner selected providers; evaluation and spend controls remain open |
| A-05 | Google Business Profile eligibility and permitted API operations | F09, F21 | Manual booking-link guidance; Google reviews ingest OFF. | OPEN | Product owner approval required | — |
| A-06 | Apple/Google Wallet issuer, certificates, refresh | F10, F16 | QR/share card and "save as image" fallback. | OPEN | Product owner approval required | — |
| A-07 | Domain and trademark ownership; artist URL shape | F02, F14, F16 | Owner specified parent `mova-beauty.co`, public `/a/:handle`, operator `ops.mova-beauty.co/:clientID`, reserved admin host `admin.mova-beauty.co`, and custom client domains later. DNS/trademark ownership and clearance remain unverified. | OPEN | Product owner approval required | — |
| A-08 | Consent purposes, retention schedule, salon data rights, marketing compliance (TCPA/CAN-SPAM/state law) | F05, F08, F15, F17, F18, F22 | Minimal collection; explicit opt-in per channel and purpose; legal review before live messaging. | OPEN | Product owner approval required | — |
| A-09 | Push notification coverage and channels | F11 | In-app + email; web push where supported. | OPEN | Product owner approval required | — |
| A-10 | Calendar event detail visible to external providers | F07 | Service name only; no client contact data. | OPEN | Product owner approval required | — |
| A-11 | Earnings estimate semantics | F06, F20 | Label as estimate; no payroll/tax claims. | OPEN | Product owner approval required | — |
| A-12 | Human review of Spanish legal/financial/consent copy and AI templates | F13 | Block release of unreviewed critical strings. | OPEN | Product owner approval required | — |
| A-13 | Public rendering (SSR/prerender), canonical, hreflang | F02, F14 | Owner selected SSR on Vercel; artist alternates are `/a/:handle?locale=en-US` and `/a/:handle?locale=es-US`, both canonicalizing to `/a/:handle`; marketing routes emit reciprocal language alternates. | APPROVED | Product owner | 2026-11-05 |
| A-14 | Waitlist privacy, anti-bot, production domain | F14 | No production submissions until verified. | OPEN | Product owner approval required | — |
| A-15 | Final logo vector and usage | Brand | Concept asset only. | OPEN | Product owner approval required | — |
| A-16 | **Zelle integration feasibility** (bank/processor partner, verification method, cost) | F23 | Owner-directed safe default: Zelle is recorded-only and labelled; no transfer processing or verification. Remove Zelle if feasibility is not approved by P17. | OPEN | Product owner approval required | 2026-11-06; ADR-0007 |
| A-17 | **Tap to Pay (V1.1)**: native shell approach, Stripe Terminal, Apple Tap to Pay entitlement | F23 (V1.1) | Not built in V1. Pay-link QR is the in-person path. | OPEN | Product owner approval required | — |
| A-18 | **Mova-wide client identity**: legal model for a platform-level customer account alongside each stylist's client list; data-sharing boundaries | F15, F16 | Build per §5.3 with strict separation; launch flag OFF until approved. | OPEN | Product owner approval required | — |
| A-19 | **Client wallet card** pass design and issuance (extends A-06) | F16 | Save-as-image + QR fallback. | OPEN | Product owner approval required | — |
| A-20 | **Reviews policy**: verified-visit rules, moderation, fake-review policy, display rules (incl. FTC rules on reviews), Google reviews display rights | F21 | Mova reviews collected but hidden from public until approved; Google ingest OFF. | OPEN | Product owner approval required | — |
| A-21 | **Rebooking autopilot** (sending approved templates without per-message approval) | F08 | Autopilot master switch hidden; per-message approval mode only. | OPEN | Product owner approval required | — |
| A-22 | **Seat-filler messaging volume and cost** (waves, credits per plan) | F18 | Waves capped by config; sandbox only. | OPEN | Product owner approval required | — |
| A-23 | **Instagram messaging**: Meta app review, permissions, messaging-window policy | F22 | Instagram channel OFF; other channels work. | OPEN | Product owner approval required | — |
| A-24 | **US business texting registration** (A2P 10DLC or toll-free verification), per-artist vs shared numbers, number porting | F11, F18, F22 | Sandbox numbers only; no live texting. | OPEN | Product owner approval required | — |
| A-25 | **AI Concierge** safety review, evaluation set, escalation rules, disclosure copy | F22 | Concierge OFF in production; local integration with provider test numbers only. | OPEN | Product owner approval required | — |
| A-26 | **Pricing competitiveness** vs incumbents (e.g., flat all-in processing offers) | F12 | Plan prices remain configurable PROPOSED values. | OPEN | Product owner approval required | — |
| A-27 | **Sensitive client notes** (allergies, sensitivities, photos): retention, export, deletion, encryption | F17 | Application-level AES-256-GCM envelope encryption for sensitive note text using a 32-byte deployment KEK; artist-initiated export includes decrypted notes; deleting the client cascades notes and note media records; no automatic retention deletion until a retention period is defined. Private visit media remains in private storage and requires signed URLs. | APPROVED | Engineering lead (owner-delegated) | 2026-11-05; owner delegated phase decisions to engineering lead until manual review is requested. |
| A-28 | **Social posting**: V1 = device share sheet only; any direct platform posting later | F18 | Share sheet + image download only. | OPEN | Product owner approval required | — |
| A-29 | **Review request messaging** (purpose classification and frequency) | F21 | Email only, one request per completed visit, opt-out honoured. | OPEN | Product owner approval required | — |
| A-30 | **Concierge business hours / response promises** shown to clients | F22 | No response-time promises in client copy. | OPEN | Product owner approval required | — |

## Owner decisions from the Nov 7 engineering checklist

| Decision | Status | Owner / date | Source |
|---|---|---|---|
| Stylist signup is limited to an owner-managed email allowlist. | APPROVED | Product owner / 2026-11-07 | Direct reply to invite-policy question |

This decision was retired by P6 migrations `20261109010000_mova_0060_open_signup.sql` and `20261109011000_mova_0061_retire_waitlist.sql`. New stylist signup is open; the Before User Created hook must remain disabled. The invite table is retained for historical records, but the signup flow and invite functions were removed. Do not use the SQL or hook setup instructions below; they are preserved only in the historical runbook.

Historical invite SQL (retired; do not run):

```sql
insert into public.mova_early_access_invites (email_normalized)
values (lower(btrim('stylist@example.com')))
on conflict (email_normalized) do nothing;

delete from public.mova_early_access_invites
where email_normalized = lower(btrim('stylist@example.com'));
```

The old Before User Created hook configuration is also retired. `supabase/config.toml` is the local reference; production configuration follows the P6 open-signup decision.

## Owner constraint: database identifier prefix

The product owner instructed that every project-created Supabase database/schema object use the `mova_` prefix. CR-001 was approved on 2026-11-05 and is normative in Engineering Spec v2.2 §§4.1 and 4.6. Owner additionally directed that no unprefixed PostgreSQL extensions be installed; see v2.2 §4.5.

## Approved change requests

| Change request | Owner decision | Normative effect |
|---|---|---|
| CR-001 | APPROVED, 2026-11-05 | All project-created database objects and Storage buckets use the `mova_` prefix; see spec v2.2 §§4.1 and 4.6. |
| CR-007 | APPROVED, 2026-11-05 | No hosted staging environment; local integration evidence satisfies phase evidence; production deployment remains blocked until written GO. See spec v2.2 §13.1 and §15. |
