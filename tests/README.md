# tests

Layers and tooling: `docs/qa/TEST_STRATEGY.md`. Every case has a stable ID and a suggested file path in `docs/qa/TEST_CASES.csv`.

| Folder | Layer |
|---|---|
| `unit/` | Vitest for `packages/domain` and app logic |
| `integration/` | Cross-module and function integration |
| `db/` | Extra SQL invariants (RLS matrix lives in `supabase/tests/`) |
| `contracts/` | Function contract suites (`TC-CT-*`) and provider adapter fixtures (`TC-INT-*`) |
| `e2e/` | Playwright, Chromium + WebKit mobile profiles, en-US + es-US |
| `security/` | Authz fuzz, token brute force, upload attacks, leak scans |
| `a11y/` | axe + manual screen-reader scripts |
| `visual/` | Baselines from `docs/design/screens/png` (`TC-SCR-*`) |
| `performance/` | Load and latency targets (`TC-NFR-*`) |
| `ai-evals/` | ≥300 scripted concierge conversations, EN/ES 50/50 (§8.4) |

Run `pnpm test:e2e` to build a fresh production preview using fixed synthetic Supabase values, then start a fresh Playwright preview server. The operator-session fixtures mock Auth, REST and Edge Function requests and do not read the project `.env`. Port 4173 must be available; the runner never reuses an existing preview server.

The Supabase CI job runs pgTAP from `supabase/tests/` and then runs `scripts/test-handle-claim-race.mjs` against two concurrent local PostgreSQL sessions. The race check uses synthetic verified Auth users and removes its rows after each run.
