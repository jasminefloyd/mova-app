# Test and phase-gate evidence

Evidence is recorded only after a command or review has actually run. A planned command is not evidence of a pass.

| Phase / criterion | Command or review | Result | Evidence location / output | Date | Reviewer |
|---|---|---|---|---|---|
| P00-AC01 clean deterministic install | `corepack pnpm install --frozen-lockfile` | PASS (exit 0; empty workspace, no packages; registry metadata lookup warned due network restriction) | Command output in session log | 2026-11-05 | — |
| P00-AC02 baseline spec hash | `corepack pnpm phase:verify` | PASS; actual hash matches manifest | `P00 structural verification passed`; `d9a9650c06e64cd4aa8b6d70ec8cb606866775cbd13aa3e2442452e6a2058f59` | 2026-11-05 | — |
| P00-AC03 approvals remain owner-controlled | `corepack pnpm phase:verify` + negative fixture | PASS; all A-01–A-30 remain OPEN; unrecorded APPROVED state rejected | Session verification output | 2026-11-05 | — |
| P00-AC04 screen inventory completeness | `corepack pnpm phase:verify`; count source map and inventory | PASS; 51 artboards, screen 15 TABLED | `P00 structural verification passed` | 2026-11-05 | — |
| P00-T01 GitHub main protection / PR policy | GitHub rulesets and branch-protection inspection | BLOCKED; rulesets list is empty; branch-protection read returned 403, no write operation available | CR-006; repository `jasminefloyd/mova-app` | 2026-11-05 | — |
| Remote CI initial run | GitHub Actions run for `2fc4d6d8ca2b63cf0ec2a2485518f3d1492bcef3` | FAIL at `setup-node`; its pnpm cache step ran before `corepack enable` | Workflow job log; fix applied in `.github/workflows/ci.yml` | 2026-11-05 | — |
| P00-T06 verifier negative cases | Temporary fixture: P00 marked DONE without evidence; A-01 changed to APPROVED without rationale | PASS; both invalid states rejected | Temporary fixture removed | 2026-11-05 | — |
| CI YAML / package manifest syntax | Ruby YAML parse; Node JSON parse | PASS | Command output in session log | 2026-11-05 | — |
