# Phase status

> Read this at the start of every session (AGENTS.md "Read first", step 5). Update it at the end of every session: current phase, task status,
> blockers, and a log line. Status values: `NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `DONE` (tests pass, staging proof, traceability
> and reviewer acceptance; spec §13.1) · `DONE – AWAITING REVIEW`. `BLOCKED` is never `DONE`.

| | |
|---|---|
| **Current phase** | **P00 — Contract lock & bootstrap** |
| **Phase status** | BLOCKED |
| **Spec baseline** | `docs/product/ENGINEERING_SPEC.md` v2.0 (SHA-256 in `BASELINE_MANIFEST.md`) |
| **Last updated** | 2026-11-05 · P00 local workspace, traceability, ADRs, verifier and CI scaffold completed; GitHub branch protection remains unverified |
| **Next gate** | Verify GitHub `main` protection and required check, run CI after initial repository setup, and obtain review of P00 evidence; then P01 → P02 → **G2a design approval** (stop there per spec §16) |

## P00 tasks

| Task | Description | Status | Notes / evidence |
|---|---|---|---|
| P00-T01 | Repo, protected `main`, PR policy, pinned Node/pnpm | BLOCKED | Local Git initialized on `main` with `origin` set to `https://github.com/jasminefloyd/mova-app.git`; PR policy documented; Node 20.13.1 and pnpm 9.15.0 pinned. Remote is empty (size 0); rulesets endpoint returned `[]`; branch-protection endpoint returned 403, so branch protection is unknown and cannot be configured with available GitHub operations (CR-006). |
| P00-T02 | Copy spec; record SHA-256 | DONE – AWAITING REVIEW | Spec unchanged; SHA-256 `d9a9650c06e64cd4aa8b6d70ec8cb606866775cbd13aa3e2442452e6a2058f59` matches `BASELINE_MANIFEST.md` and verifier output. |
| P00-T03 | Transcribe D-01–D-26 and A-01–A-30 with status in `DECISION_LOG.md` | DONE – AWAITING REVIEW | 26 locked decisions and 30 OPEN approvals transcribed; no approvals self-resolved. |
| P00-T04 | `REQUIREMENTS_MATRIX.csv`: rows for every F01-AC…F23-AC, Fnn-V1 items, D-xx, A-xx, T01–T60, NFRs | DONE – AWAITING REVIEW | 264 unique rows; all 90 feature ACs, 38 inherited criteria, 26 D items, 30 A items, 60 tests and 20 NFRs have QA case IDs. |
| P00-T05 | `SCREEN_INVENTORY.md`: canvas 01–45 → routes → components → ACs | DONE – AWAITING REVIEW | 51 artboards copied from `SCREEN_MAP.md`; 15 is TABLED; implementation paths are blank pending their phases. |
| P00-T06 | `scripts/verify-phase.mjs` rejects missing evidence/approvals; CI wired | DONE – AWAITING REVIEW | CI workflow and verifier added; structural run passed; negative fixture checks reject missing completion evidence and an unrecorded approval resolution. Remote CI run is pending repository setup. |
| — | Other P00 files: `CHANGE_REQUESTS.md`, `TEST_EVIDENCE.md`, `RELEASE_ACCEPTANCE.md`, `SALES_PROMISES_MATRIX.md`, ADR-0001…0003, `.env.example`, workspace config | DONE – AWAITING REVIEW | P00 deliverables created; external branch protection and owner review remain open. |

P00 acceptance:

| Criterion | Status |
|---|---|
| AC01 clean install deterministic | DONE – AWAITING REVIEW |
| AC02 hash recorded | DONE – AWAITING REVIEW |
| AC03 no approval self-resolved | DONE – AWAITING REVIEW |
| AC04 screen inventory complete | DONE – AWAITING REVIEW |

## All phases

| Phase | Name | Status | Depends on | Approvals needed to finish (build may proceed behind flags) |
|---|---|---|---|---|
| P00 | Contract lock & bootstrap | BLOCKED | — | — |
| P01 | App shell, environments, Supabase infra, i18n runtime | NOT STARTED | P00 | — |
| P02 | Design system & navigation | NOT STARTED | P01 | Design sign-off (G2a) |
| P03 | Identity, tenancy, onboarding, profile photo | NOT STARTED | P02 | — |
| P04 | Showcase, services & deposits, portfolio, SEO | NOT STARTED | P03 | A-13 (ADR-0003) |
| P05 | Locations, hours, availability engine | NOT STARTED | P04 | — |
| P06 | Booking lifecycle, calendar UI, requests, manage links, running late | NOT STARTED | P05 | §2.4 cancel/reschedule designs |
| P07 | Clients, consent, import, client notes & visits | NOT STARTED | P06 | A-27 |
| P08 | Money: Stripe, deposits, ledger, Get paid, recorded methods | NOT STARTED | P06 | A-02, A-16 |
| P09 | Calendar sync | NOT STARTED | P06 | A-10 |
| P10 | Client identity, sign-in, profile, client card, wallet, QR scan | NOT STARTED | P06, P08 | A-18, A-19, A-06 |
| P11 | Messaging foundation, notifications, push, sending identities | NOT STARTED | P07, P10 | A-03, A-24, A-09 |
| P12 | AI Revenue: hub, forecast, pipeline, autopilot, templates, win-back, seat filler | NOT STARTED | P08, P11 | A-04, A-21, A-22, A-28 |
| P13 | AI Concierge | NOT STARTED | P11, P12 | A-04, A-23, A-25, A-30 |
| P14 | Reports, reputation & reviews, Google presence | NOT STARTED | P08, P11 | A-05, A-20, A-29 |
| P15 | Plans, entitlements, billing, analytics | NOT STARTED | P08–P14 | A-01, A-26 |
| P16 | Security, privacy ops, reliability, observability | NOT STARTED | P15 | A-08 |
| P17 | Full regression, accessibility, performance, UAT, acquisition readiness | NOT STARTED | P16 | A-07, A-12, A-14, A-15 |
| P18 | Owner sign-off & controlled release | NOT STARTED | P17 | **GO** |

F13 (i18n) runs continuously from P01. F14 (acquisition site) may run as a parallel slice after P02.

## Approvals snapshot

All approvals **A-01 – A-30 are OPEN**. Nothing has been recorded as approved yet. Until `DECISION_LOG.md` says otherwise, build each affected
capability behind its flag (default OFF) with the safe default from spec §0.5. Never mark an approval resolved in this file. Record decisions in
`DECISION_LOG.md` with owner, date and rationale.

Gates: G1 Architecture · G2a Design (after P02) · G2 UX · G3 Feature complete · G4 Security & finance · G5 UAT · G6 Production GO. **All gates are NOT STARTED.**

## Open blockers and pending inputs

| Item | Blocks | Owner |
|---|---|---|
| §2.4 screens without approved designs (cancel/reschedule, manage page, notification settings, privacy & data, Spanish guest-flow layouts, review reply, concierge Decide sheet + web chat, `/c/:token` + delete-profile confirm, Settings services/portfolio, loading/empty/error/offline patterns) | P02, P06, P10, P11, P13, P14, P16 acceptance | Product owner |
| Load-test tool not named in the spec (ADR-0001 addendum) | P06+ load cases | Engineering |
| AI eval set (≥300 conversations, EN/ES) needs an author and a Spanish reviewer | P13 | Product owner + AI engineer |
| F04-AC08 wording (running-late texts during quiet hours) needs confirmation | P06 | Product owner |
| v1-inherited ACs (`Fnn-V1-nn`, 38 items) should be added to spec §1; currently traced to QA source pending spec revision | Contract consistency | Product owner |
| Owner-required `mova_` prefix conflicts with unprefixed database examples in spec v2.0; prefix itself is confirmed by owner, but a versioned spec update is needed before DB implementation | P03+ database work | Product owner / engineering |
| GitHub branch-protection status cannot be inspected (403) or changed with available connector operations; rulesets endpoint returned an empty list | P00-T01 | Repository owner |

## Session log

| Date (UTC) | Who | Phase | What changed | Next action |
|---|---|---|---|---|
| 2026-11-05 | Codex | P00 | Initialized local Git on `main` with GitHub `origin`; pinned Node/pnpm; added workspace, lockfile, CI, P00 verifier, 264-row traceability matrix, 51-artboard inventory, decision/change/evidence/release/sales docs, ADRs 0001–0003; verified structural gate and negative checks; committed locally (not pushed). P00 remains blocked on remote branch protection and awaiting review. | Repository owner verifies/enables `main` protection and required check; review P00 evidence; do not proceed past P00 until gate closes. |
| 2026-11-05 | Claude (setup) | P00 | Added folder structure (§3.2), `AGENTS.md`, spec v2.0, implementation plan, QA strategy + 539 cases, design handoff (`docs/design`), `BASELINE_MANIFEST.md`, this file | Codex: finish P00-T01, T03–T06 and the remaining P00 files; then P01 |
