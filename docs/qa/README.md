# docs/qa

- **`TEST_STRATEGY.md`**: QA & Automated Test Strategy v2 (layers, environments and flag profiles, case ID scheme, coverage, execution per phase, CI stages, exit criteria, open gaps).
- **`TEST_CASES.csv`**: 539 cases. Every `Fnn-ACnn` in the spec, the v1-inherited ACs (`Fnn-V1-nn`), T01–T60, UAT-A–M, NFR-01–20, the full RLS matrix, a contract suite per Edge Function, approval safe defaults, screens, domain rules, AI evals, security, analytics, integrations and release checks. Each case has a priority, phase, layer, owner and suggested test file path.

Generated against `docs/product/ENGINEERING_SPEC.md` v2.1 (original v2.0 baseline and current v2.1 hash are recorded in `docs/engineering/BASELINE_MANIFEST.md`). When the spec changes, regenerate and report the new totals. Never quote an old total.
