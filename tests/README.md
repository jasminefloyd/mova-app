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
