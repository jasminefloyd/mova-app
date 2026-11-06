# ADR-0001: Stack and hosting

- Status: Stack specified; CR-007 hosting environment policy owner-approved 2026-11-05; production deployment remains subject to P18 GO.
- Date: 2026-11-05
- Source: Engineering Spec v2.0 §§0.6, 3.2, 13; CR-007 amendment in v2.1 §§13.1, 15

## Context

The normative spec selects React + TypeScript + Vite, a Vercel-hosted PWA, and Supabase (Postgres with RLS, Auth, Storage, Edge Functions, scheduled triggers, and durable jobs). The repository target is `jasminefloyd/mova-app`. The connected GitHub repository currently has an empty `main` branch.

## Decision recorded by the spec

Use the stack above. Hosted environments are production only; there is no hosted staging environment. Local development/integration evidence satisfies phase gates. This ADR does not select additional services or approve production deployment. Runtime versions verified in the local environment and pinned for the P00 scaffold are Node.js 20.13.1 and pnpm 9.15.0 (resolved by installed Corepack). Production deployment still requires the written P18 GO.

## Consequences

- Runtime package choices and Vercel/Supabase environment setup must be implemented in their planned phases.
- No database object names may be implemented without the owner's `mova_` prefix requirement (CR-001).
- Protected `main` and required PR checks remain an external GitHub setting (CR-006).
