# AGENTS.md: operating rules for AI engineers (Codex and humans)

You are implementing **Mova**, a mobile-first web app (PWA) that gives independent hairstylists a business that moves with them. Brand: `mova` (no dot; owner decision O13, 2026-11-08), *Your business moves with you.*

## Read first, every session
1. `docs/product/ENGINEERING_SPEC.md` (v2.1). **The single engineering source of truth.**
2. `docs/engineering/IMPLEMENTATION_PLAN.md`: phases P00–P18 and checklists (extract of spec §13 and §16).
3. `docs/design/README.md`, `docs/design/SCREEN_MAP.md` and `docs/design/COMPONENTS.md`: how the app must look.
4. `docs/qa/TEST_STRATEGY.md` and `docs/qa/TEST_CASES.csv`: the tests each phase must pass.
5. `docs/engineering/PHASE_STATUS.md`, `REQUIREMENTS_MATRIX.csv`, `DECISION_LOG.md` and open `CHANGE_REQUESTS.md` (created in P00). Confirm the current phase and approvals.

## Stack
- **apps/web:** React + TypeScript (strict) + Vite PWA on Vercel; React Router, TanStack Query, Zod, Tailwind mapped to design tokens, react-i18next (ADR-0002).
- **Supabase:** Postgres with RLS, Auth (artist and client roles), Storage, Edge Functions (Deno), scheduled triggers, durable jobs.
- **Database naming:** every project-created Supabase database object and Storage bucket uses the `mova_` prefix, as specified in Engineering Spec v2.1 §§4.1 and 4.6. CR-001 is closed. Preserve specified behavior while applying the prefix; Supabase-managed objects and PostgreSQL built-ins retain their existing names.
- **Git workflow:** commit directly to `main` by default. Branch protection is not required. Follow a different branch or workflow only when the product owner says otherwise.
- **apps/mobile is reserved for V1.1** (Expo shell for Tap to Pay, approval A-17). Do not add code there in V1.
- Pin Node/pnpm and all dependency versions in P00/P01.

## Operating protocol (spec §13.1)
1. Work one phase and one vertical slice at a time (UI → validated function → DB → events → tests). Never start a later phase to hide a missing dependency.
2. Before edits: list the files you intend to touch, requirement IDs, tests, risks and blockers. After edits: list the actual files, commands and results, screenshots, deviations and next action.
3. `DONE` requires all of: passing tests, local phase integration evidence, traceability and reviewer acceptance. `BLOCKED` is never `DONE`. No `test.skip` on critical paths. Production-host verification is part of P18 after written GO.
4. Mocks only in tests/sandbox, visibly labelled. No fake data in production UI. No simulated provider success.
5. No secrets in Git. The service-role key never goes in the browser. RLS on every tenant table, with negative tests.
6. No production deploy, live payments, live messaging, AI enablement or business-rule change without a recorded approval (§0.5). Approval-dependent features ship behind flags that default **OFF**.
7. After a context reset, recover state from committed docs. End every session by updating `PHASE_STATUS.md`.
8. Ambiguity → write a decision request with a recommended safe default. Do not invent behaviour, prices, provider capabilities or approvals.
9. Re-run all previously accepted critical-path tests at every phase.
10. **Match the design canvas.** If a screen needs a design listed in `docs/design/SCREEN_MAP.md` → "Screens with no artboard yet", stop and request it.

## Testing and production stop rules (Nov 8 checklist)
- Run `pnpm db:test` and `pnpm fn:check` before committing any migration, SQL test or Edge Function change (see `docs/operations/environments.md`). If you cannot run them, report the change as unverified; it is not done.
- Never test against production: no fixture writes, no rollback-only assertions, no "read-only" probes that create rows. Use a local or development database.
- Stop and ask before: any production write (migrations, data, settings, deploys, Auth, secrets); anything that moves real money or messages a real person; work that needs an open owner decision; editing an applied migration, deleting data or force-pushing; changes to scope, price, legal or consent copy, or the brand; spending on a new service.
- Inside a pre-approved phase, decide everything else yourself, finish the phase, post the phase summary, and wait for the go-ahead before the next phase.

## Design rules (from docs/design/README.md)
- Build the components in `docs/design/COMPONENTS.md` first (P02). Screens are composed **only** from `apps/web/src/components/` and styled **only** with tokens from `packages/design-tokens` (source: `docs/design/tokens/tokens.json`). No raw hex values in feature code.
- Use `docs/design/screens/png/*.png` as the visual target. `screens/html/` is a reference for spacing and copy and must **never be copied** into the app.
- Canvas names, prices, times and the `[DOMAIN]` placeholder are **illustrative sample data**. Never hardcode them.
- Every screen also needs loading, empty, error + retry, offline, permission-denied and validation states; 320–430 px; en-US + es-US; 44 px targets; status never shown by colour alone.
- Screen 15 (Outreach) is **TABLED**. Do not build it.

## Repository map
```text
apps/web/            the app (artist, onboarding, public/client, marketing)
apps/mobile/         reserved for V1.1 native shell (empty)
packages/contracts/  Zod DTOs, enums, errors, analytics schemas
packages/domain/     pure business rules (money, availability, consent, …)
packages/design-tokens/  tokens → CSS variables + Tailwind theme
packages/config/     TS / lint presets
supabase/            migrations, functions (one folder per function), pgTAP tests, seed
tests/               unit, integration, db, contracts, e2e, security, a11y, visual, performance, ai-evals
scripts/             phase gate, locale check, SEO, AI evals; design export tools
docs/product/        ENGINEERING_SPEC.md (contract), MASTER_BLUEPRINT.md, archive/, reference/
docs/engineering/    IMPLEMENTATION_PLAN.md, BASELINE_MANIFEST.md, + P00 control files
docs/design/         screens, tokens, fonts, icons, components, screen map
docs/qa/             TEST_STRATEGY.md, TEST_CASES.csv (539 cases)
docs/{architecture,decisions,operations,security,runbooks}/
```

## First task
Follow spec §16 "First instruction to Codex" (repeated at the end of `docs/engineering/IMPLEMENTATION_PLAN.md`):
1. Do P00.
2. Then do P01 and P02 only.
3. Stop at gate G2a for the product owner's design approval.
