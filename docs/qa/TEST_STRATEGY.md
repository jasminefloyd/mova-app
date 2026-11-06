# MOVA — QA & Automated Test Strategy v2
**Version:** 2.1 · **Date:** 2026-11-05 · **Status:** Replaces `MOVA_QA_Automated_Test_Strategy_v1.md` and `MOVA_QA_TEST_CASES.csv` · **Built against:** `docs/product/ENGINEERING_SPEC.md` v2.1, §14.4
**Companion file:** `docs/qa/TEST_CASES.csv` (delivered as `MOVA_QA_TEST_CASES_v2.csv`) (539 cases)

> **Repository placement:** `docs/qa/TEST_STRATEGY.md` and `docs/qa/TEST_CASES.csv`. Each case's `requirement_ids` feed the `test_files` column of `docs/engineering/REQUIREMENTS_MATRIX.csv`. The old 179-case figure is retired and must not be quoted.

---

## 1. Scope and sources

The inventory covers everything §14.4 requires, plus the spec sections that state testable rules without an AC number:

| Source in spec | What gets a case |
|---|---|
| §1 F01–F23 | Every `Fnn-ACnn` (90 in the spec) has at least one case. |
| §1 "unchanged from v1" (F05, F06, F07, F09, F11, F12, F13, F14) | The v1 acceptance criteria these features still carry. The spec gives them no IDs, so they are numbered here as `Fnn-V1-nn` (38 items, listed in §12). |
| §14.2 | T01–T60, all flagged `release_critical = Y`. |
| §14.3 | UAT-A … UAT-M (A–F updated for v2 navigation and flows). |
| §12 + v1 §6.3 | Nonfunctional targets `NFR-01 … NFR-20`. |
| §4.4 | The RLS matrix: one positive case per table group and one case for each of the five required adversaries. |
| §6 | One contract-suite case per Edge Function (30 retained + 56 new). |
| §0.5 | The safe default for each approval A-01 … A-30 while it is OPEN. |
| §0.3 | D-01 … D-26, each traced to at least one case. |
| §2.3 / §2.4 | Canvas fidelity and the required states for every built screen; screen 15 confirmed not built; the undesigned §2.4 screens are cases blocked on design. |
| §3.4, §5, §8, §10, §11, §7, §15 | Domain rules, AI evals and LLM guards, threats, analytics, provider adapters, release governance. |

Out of scope for V1 (Appendix A) gets **no positive tests**. A few cases instead assert absence, for example no Tap to Pay, no screen 15, and no native code.

## 2. Quality risks and priority rules

| Priority | Rule (from §14.4) | Gate effect |
|---|---|---|
| **P0** | Security, tenant isolation, money, booking integrity, privacy, consent, AI hard rules | Must pass to close the phase that owns it and every later phase (re-run rule §13.1-10). A single failure is a NO-GO. |
| **P1** | Core functional behaviour, reliability targets, accessibility of core flows | Must pass for phase acceptance. A waiver needs owner risk acceptance in `DECISION_LOG.md`. |
| **P2** | Secondary UX, visual fidelity, non-critical copy | A failure becomes a defect; it does not block the phase unless the owner says so. |
| **P3** | Cosmetic or absence checks on deferred items | Tracked only. |

| Priority | Cases |
|---|---|
| P0 | 265 |
| P1 | 190 |
| P2 | 80 |
| P3 | 4 |

P0 is about half the inventory. That is expected: the RLS matrix, function contracts and security cases are all P0 by rule, and they are cheap automated checks.

## 3. Test layers and tooling (§14.1)

| Layer (`layer` column) | Tool / location | Runs |
|---|---|---|
| Unit | Vitest, `packages/domain` (100% branch coverage on money, deposits, availability, booking state, consent, cadence, forecast, slot matching, concierge policy) | Every PR |
| Component | React Testing Library + axe | Every PR |
| DB | pgTAP in `supabase/tests/` (RLS matrix, constraints, races) | Every PR touching migrations; full on main |
| Function / Contract | Deno tests with signed webhook fixtures; contract template per function; provider adapters against recorded fixtures | Every PR (touched functions); full on main |
| E2E | Playwright: Chromium and WebKit mobile profiles × en-US and es-US | Main + nightly |
| Visual | Playwright screenshots vs approved canvas baselines (seed data, never canvas sample data) | Nightly + phase gate |
| A11y | axe automated + manual VoiceOver / TalkBack | Nightly (auto); phase gate (manual) |
| Load | `tests/load/` (tool chosen in an ADR-0001 addendum; the spec names none) | Pre-gate for P06, P12, P13, P16, P17 |
| AI-eval | `tests/ai-evals/`, ≥300 scripted conversations (EN/ES 50/50) | On any prompt/model change, and nightly while LLM work is active |
| Security | Authz fuzz, token brute force, upload attacks, dependency/secret scans | Every PR (scans); nightly (fuzz); P16 full |
| Static | Scripts in `scripts/` (locale parity, flag inventory, no-skip lint, release checks) | Every PR |
| Manual / Manual-UAT | Real devices, human review, product-owner UAT | Phase gate, P17 |

| Layer | Cases |
|---|---|
| A11y | 5 |
| AI-eval | 23 |
| Component | 18 |
| Contract | 97 |
| DB | 79 |
| E2E | 72 |
| Function | 66 |
| Load | 13 |
| Manual | 7 |
| Manual-UAT | 13 |
| Security | 31 |
| Static | 18 |
| Unit | 36 |
| Visual | 61 |

## 4. Environments, flags and data

**Environments.** Local and CI (sandbox adapters only), provider sandboxes, and production (never a test target). PR preview builds may be used for code review only; there is no hosted staging environment or production-like preview target.

**Two flag profiles run on every nightly:**
1. **Launch-default profile.** Every flag from §15 is OFF and every approval is OPEN. The `TC-APR-*` cases and the fallback paths run here, because this is what ships if an approval does not land.
2. **Full-feature profile.** Flags are ON in local integration with provider sandbox services. Feature cases run here; this does not represent production-provider verification.

A case whose `flags_approvals` names a flag must pass in the profile it belongs to. Cases for approvals that are not yet granted still run in sandbox. "Ready" means it can be automated now, not that the feature is live.

**Test data.**
- `supabase/seed.sql` per spec §4.5: two tenants; artist 1 with suite (instant, artist collects) and salon (request, salon collects); fixed, percent and no-deposit services; clients with 0, 1, 2 and 4+ visit intervals and mixed consent; one customer account linked to both artists; appointments in every state; slot events in every state; EN and ES templates; one conversation per channel; reviews from both sources; 90 days of metrics. No real PII.
- Named fixtures referenced in the CSV:
  - deposit rounding table (TC-F03-AC01-01)
  - cadence table (TC-F08-AC01-01)
  - **fixture month** for Money, Reports and forecast reconciliation
  - DST days 2027-03-14 and 2027-11-07 (America/New_York)
  - the eval set
  - the injection corpus
  - a canary note string for leak scans
- Canvas names and figures (e.g. "Ari Monroe", "$150") are illustrative. Fixtures may reuse them, but app code must never hardcode them; TC-SCR cases compare layout, not data.

## 5. Case ID scheme and CSV columns

IDs are stable and readable: `TC-<family>-<source>-<nn>`. For example, `TC-F04-AC03-01` is the first case for F04-AC03, and `TC-RLS-NOTES-ANON` is the anonymous-adversary case for the notes table group. Never renumber an ID. Retire it with status `Retired` and add a new one.

| Column | Meaning |
|---|---|
| `case_id` | Stable ID. |
| `title` | One-line intent. |
| `requirement_ids` | Every spec ID covered, separated by `;` (Fnn-ACnn, Fnn-V1-nn, Tnn, UAT-x, A-nn, D-nn, NFR-nn, §refs). |
| `feature` / `spec_section` | Owning feature or family; spec location. |
| `phase` | Phase in which the case must first pass (§13.2). |
| `layer` | See §3. |
| `priority` | P0–P3 per §2. |
| `release_critical` | Y for T01–T60, UAT and P0 nonfunctional/approval cases. |
| `automation` | Automated or Manual. |
| `owner` | Role accountable for writing and maintaining the case. |
| `status` | `Ready`, `Blocked: design (§2.4)` or `Ready (targets PROPOSED, approval required)`. |
| `flags_approvals` | Flags and approvals the case depends on. |
| `screens` | Canvas screen numbers. |
| `locales` | `en-US + es-US` or `n/a`. |
| `fixtures` / `preconditions` | Data required. |
| `steps` / `expected_result` | Executable description. |
| `suggested_test_file` | Path where the automated test should live (adjust when the repo layout settles). |

## 6. Coverage summary

**Total: 539 cases** (519 automated, 20 manual). 99 are release-critical.

| Family | Cases |
|---|---|
| Feature acceptance (F01–F23, incl. v1-inherited) | 160 |
| UAT scripts | 13 |
| Nonfunctional targets | 20 |
| RLS matrix (§4.4) | 72 |
| Function contract suites (§6) | 86 |
| Approval safe defaults (§0.5) | 30 |
| Screens (§2.3/§2.4) | 61 |
| Navigation | 5 |
| Domain rules (§5, §3.4, §11) | 20 |
| AI eval categories and thresholds (§8.4) | 20 |
| LLM task guards (§8.2–8.6) | 10 |
| Concierge channels and controls | 5 |
| Security threats (§10, v1 §6) | 15 |
| Analytics (§11) | 4 |
| Provider adapters (§7) | 10 |
| Release governance (§15) | 8 |
| **Total** | **539** |

Feature-level cases (cases whose owning feature is Fnn, any family):

F01 9 · F02 5 · F03 6 · F04 8 · F05 10 · F06 10 · F07 7 · F08 10 · F09 3 · F10 4 · F11 10 · F12 6 · F13 10 · F14 7 · F15 7 · F16 5 · F17 5 · F18 11 · F19 4 · F20 5 · F21 6 · F22 40 · F23 7

**Coverage guarantees.** These were verified by the generator against the spec text. The build fails if any of them breaks.
- All 90 `Fnn-ACnn` IDs in the spec have at least one case, and no case cites an AC that does not exist in the spec.
- T01–T60, UAT-A–M, A-01–A-30, D-01–D-26 and NFR-01–NFR-20 each have at least one case.
- Where an AC and a T-scenario describe the same behaviour, one case carries both IDs, for example `F04-AC03; T03`. This avoids duplicate tests while keeping both traceable.

## 7. Execution plan by phase

Each phase gate (§13.1 standard gate) runs all of the following:
- every case whose `phase` ≤ the current phase, not only the new ones (rule 10);
- a full Playwright run in both locales;
- the RLS matrix for every migration so far;
- the contract suite for every function deployed so far.

| Phase | New cases | of which P0 | Cumulative regression set |
|---|---|---|---|
| P01 | 8 | 3 | 8 |
| P02 | 8 | 0 | 16 |
| P03 | 24 | 10 | 40 |
| P04 | 11 | 4 | 51 |
| P05 | 4 | 1 | 55 |
| P06 | 40 | 21 | 95 |
| P07 | 38 | 24 | 133 |
| P08 | 36 | 27 | 169 |
| P09 | 15 | 3 | 184 |
| P10 | 51 | 32 | 235 |
| P11 | 24 | 13 | 259 |
| P12 | 70 | 30 | 329 |
| P13 | 57 | 27 | 386 |
| P14 | 40 | 20 | 426 |
| P15 | 13 | 5 | 439 |
| P16 | 49 | 26 | 488 |
| P17 | 43 | 16 | 531 |
| P18 | 8 | 3 | 539 |

Phase-specific emphasis:
- **P03–P06:**
  - booking integrity: concurrency (TC-F04-AC03-01, NFR-05), DST, idempotency;
  - honest request copy (TC-F03-AC05-01, TC-F04-AC01-01).
- **P07–P08:**
  - notes leak scan with the canary;
  - money reconciliation against the fixture month;
  - webhook replay.
  - P08 cannot close while TC-F06-AC01-01, T07, T08 or T09 fail.
- **P10:** cross-artist isolation (TC-F15-AC04-01, TC-RLS-LINKS-*, TC-RLS-CUST-*), OTP abuse, token entropy.
- **P11–P12:**
  - consent and canSend decision table;
  - STOP handling;
  - quiet hours in the client's timezone;
  - autopilot OFF means zero sends;
  - seat-filler wave cancellation ≤ 60 s;
  - claim contention.
- **P13:**
  - the AI eval suite and thresholds (TC-AIE-THR-*) must pass before the `concierge` flag can be switched on, enforced by TC-F22-AC08-01;
  - injection corpus.
- **P14:** Reports reconciliation, review immutability, traffic PII scan.
- **P16:** full security sweep (TC-SEC-*), restore rehearsal, alerts.
- **P17:**
  - all UAT;
  - real-device QR scan;
  - Spanish human review;
  - WCAG 2.2 AA;
  - browser matrix;
  - performance targets;
  - the launch-default flag profile.

## 8. CI pipeline

| Stage | Contents | Blocks |
|---|---|---|
| PR | lint, typecheck, Unit, Component, Static (incl. `check-locales.mjs`, no-skip lint), pgTAP for changed migrations, Function/Contract for changed functions, secret/dependency scan | Merge |
| Main | Everything automated except Load and full AI evals; E2E smoke (both locales, WebKit + Chromium) | Phase evidence; no automatic production deployment |
| Nightly | Full E2E, Visual, A11y-auto, authz fuzz, both flag profiles, AI evals if prompts/models changed in the last 24 h | Next phase gate if red |
| Phase gate | All cases with `phase` ≤ current; Load for the phase; manual cases for the phase | Phase acceptance |
| Release (P17/P18) | Everything, incl. UAT, real devices, eval report, evidence package | GO / NO-GO |

Flaky tests are quarantined only with an owner and a ticket, never for P0 cases. A flaky P0 is treated as a failing P0.

## 9. Special strategies

- **Tenant isolation.** pgTAP for every §4.4 row × {other artist, client of same artist, client of other artist, anonymous, expired token}, plus API fuzz that swaps every UUID in every function (TC-SEC-FUZZ-01).
- **Money.** Every amount is an integer in minor units. Reconciliation runs against SQL ground truth for the fixture month. Webhook replay and out-of-order delivery are tested, along with no fee on recorded or salon-collected money and no double pay on pay links.
- **Booking integrity.** Contention load on the GiST exclusion including buffers and holds; idempotency; DST; request honesty checked on every surface and channel.
- **Consent and messaging.** A decision-table test of `canSend`; consent is re-checked at send time; STOP is channel-wide for the artist and platform-wide on shared numbers; quiet hours use the client's timezone; ES clients never receive English without an explicit fallback setting.
- **AI.** Deterministic code decides and the LLM only phrases. Every LLM task has schema/length validation, a fallback, a kill switch and minimization tests. The concierge has the ≥300-conversation eval set with hard thresholds and an injection corpus that includes text inside images. Turning on any LLM flag requires a passing `AI_EVAL_REPORT.md`.
- **Privacy leaks.** A canary string is seeded into notes, then every client, guest, AI-prompt and analytics output is crawled for it, alongside a static rule that public DTOs cannot import note types.
- **Internationalization.** Locale parity and the critical-string list fail CI; E2E runs in both locales; long-string layout checks at 320 px; a human signs off the Spanish copy.
- **Visual fidelity.** Baselines come from the approved canvas, rendered with seed data. Every screen also covers loading, empty, error, offline, permission-denied and validation states.

## 10. Defects and exit criteria

| Severity | Definition | Release effect |
|---|---|---|
| S1 Critical | Any §15 hard NO-GO: authz/tenant leak, cross-artist leak via client profiles, note exposure, double booking, money reconciliation error, unauthorized or no-consent send, false booking confirmation, AI hard-rule violation, leaked calendar/claim/card token, artist able to edit a review, an unapproved dependency shown as live, broken core mobile booking | NO-GO; fix and re-run the owning phase's P0 set |
| S2 High | P1 failure in a core flow, or a P0 failure with a workaround that is not acceptable | Blocks phase unless owner risk acceptance is recorded |
| S3 Medium | P2 failure; degraded but usable | Fix before GA or accept |
| S4 Low | Cosmetic | Backlog |

**Phase exit:**
- every P0 and P1 case for the phase and all earlier phases passes;
- no open S1 or S2;
- evidence linked in `TEST_EVIDENCE.md`;
- matrix updated.

**Release exit (G5/G6):**
- all of the above for P00–P17;
- UAT-A–M approved;
- T01–T60 pass;
- each approval is either APPROVED or its flag-OFF case passes;
- evidence package complete (TC-REL-EVIDENCE-01).

## 11. Evidence mapping (§15)

| Evidence item | Produced by |
|---|---|
| T01–T60 report | CI report filtered by `release_critical = Y` |
| RLS proof incl. client identity | TC-RLS-* pgTAP output |
| Reports reconciliation report | TC-F20-AC01-01, TC-F06-AC01-01 |
| AI evaluation report | TC-AIE-* → `docs/engineering/AI_EVAL_REPORT.md` |
| Messaging compliance (registration, consent sample, STOP) | TC-F11-T21-01, TC-F11-ID-01, TC-F05-V1-04, TC-APR-A24-01 |
| Wallet pass evidence | TC-F16-AC02-01, TC-NFR-12-01 |
| Spanish review sign-off | TC-F13-V1-06, TC-AIE-THR-5 |
| Mobile screenshots/video | TC-SCR-* baselines + UAT recordings |

## 12. Gaps and decisions found while building this

1. **v1-inherited acceptance criteria have no IDs in the spec.** F05, F06, F07, F09, F11, F12, F13 and F14 say "unchanged from v1" (or "in addition to v1"), but v1 wrote those criteria as prose. This package numbers them `Fnn-V1-nn` (38 items: `F05-V1-01`, `F05-V1-02`, `F05-V1-03`, `F05-V1-04`, `F06-V1-01`, `F06-V1-02`, `F06-V1-03`, `F06-V1-04`, `F06-V1-05`, `F07-V1-01`, `F07-V1-02`, `F07-V1-03`, `F07-V1-04`, `F07-V1-05`, `F07-V1-06`, `F09-V1-01`, `F09-V1-02`, `F09-V1-03`, `F11-V1-01`, `F11-V1-02`, `F11-V1-03`, `F12-V1-01`, `F12-V1-02`, `F12-V1-03`, `F13-V1-01`, `F13-V1-02`, `F13-V1-03`, `F13-V1-04`, `F13-V1-05`, `F13-V1-06`, `F13-V1-07`, `F14-V1-01`, `F14-V1-02`, `F14-V1-03`, `F14-V1-04`, `F14-V1-05`, `F14-V1-06`, `F14-V1-07`). **Recommendation:** add these IDs to spec §1 so `REQUIREMENTS_MATRIX.csv` can cite them.
2. **F04-AC08 wording.** "Respects quiet hours override for same-day transactional use" is read here as: running-late texts *may* send during quiet hours because they are transactional and same-day. Please confirm.
3. **Nonfunctional targets are PROPOSED (§12).** The 20 NFR cases are written and runnable, but their pass/fail thresholds only bind once approved. Their status says so.
4. **12 cases are blocked on §2.4 designs.** Examples are cancel/reschedule, privacy and data, the delete-profile confirmation, and the review reply composer. They cannot pass until the owner approves designs, which blocks P06, P10, P11, P13, P14 and P16 acceptance as §2.4 already states.
5. **Load tool not named in the spec.** It needs a one-line ADR-0001 addendum; any tool that can drive concurrent HTTP and report p95 works.
6. **Eval set authorship.** The ≥300 conversations need an owner and a Spanish reviewer before P13. Nothing in the spec assigns them yet.
7. **Review-request consent default.** `review_requests` is ON for email unless opted out (§5.5, A-29). TC-APR-A29-01 tests that default; legal review under A-08 may change it.
