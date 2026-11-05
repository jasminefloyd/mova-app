# mova.
*Your business moves with you.*

Mova gives independent hairstylists (booth renters, suite renters and commission stylists) a portable business: a public showcase, honest
location-aware booking, client relationships and private notes, real money tracking, an AI Revenue Center (seat filler, rebooking autopilot,
win-back, forecast), an AI Concierge, and reports and reviews. It's bilingual (US English and US Spanish).

**Status:** pre-build. The repo contains the contract, design handoff and QA plan. Implementation starts at phase **P00**.

## Start here
| If you are… | Read |
|---|---|
| An AI engineer / Codex | [`AGENTS.md`](AGENTS.md), then [`docs/engineering/IMPLEMENTATION_PLAN.md`](docs/engineering/IMPLEMENTATION_PLAN.md) |
| Building UI | [`docs/design/`](docs/design/README.md) (screens, tokens, components, screen map) |
| Testing | [`docs/qa/TEST_STRATEGY.md`](docs/qa/TEST_STRATEGY.md) and [`docs/qa/TEST_CASES.csv`](docs/qa/TEST_CASES.csv) |
| Reviewing scope or decisions | [`docs/product/ENGINEERING_SPEC.md`](docs/product/ENGINEERING_SPEC.md) §0 (decisions D-01–D-26, approvals A-01–A-30) |

## Stack
React + TypeScript + Vite PWA (Vercel) · Supabase (Postgres + RLS, Auth, Storage, Edge Functions) · Stripe Connect · SMS/email providers ·
AI provider via adapter. A native shell (`apps/mobile`) is reserved for V1.1 Tap to Pay only.

## Repository layout
See [`AGENTS.md` → Repository map](AGENTS.md#repository-map) and spec §3.2. Folders contain a README describing what belongs there and which
phase creates it.

## Ground rules
No production deploy, live payments, live messaging or AI enablement without the product owner's recorded approval. Every approval-dependent
feature ships behind a flag that defaults OFF.

## P00 workspace setup

The repository requires Node.js `20.13.1` (`.nvmrc`) and pnpm `9.15.0` (Corepack `packageManager` pin).
After installing the pinned Node version, use Corepack to run `pnpm install --frozen-lockfile`.
The checked-in `.env.example` lists blank placeholders; copy it to `.env.local` and fill only the values
needed for the environment. Never commit local env files or expose server-only keys through `VITE_` variables.

## Pull request policy

Changes to `main` must arrive through a pull request. The required check is `P00 contract gate`; reviewers
must inspect the diff and evidence before merge. The GitHub `main` branch must have branch protection enabled
with direct pushes blocked and the required check enforced. The remote repository settings are not controlled
by this local scaffold; confirm them in GitHub before treating P00-T01 as complete.
