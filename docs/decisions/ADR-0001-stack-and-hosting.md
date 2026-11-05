# ADR-0001: Stack and hosting

- Status: Draft for review; implementation stack is specified, deployment details remain subject to phase gates.
- Date: 2026-11-05
- Source: Engineering Spec v2.0 §§0.6, 3.2, 13

## Context

The normative spec selects React + TypeScript + Vite, a Vercel-hosted PWA, and Supabase (Postgres with RLS, Auth, Storage, Edge Functions, scheduled triggers, and durable jobs). The repository target is `jasminefloyd/mova-app`. The connected GitHub repository currently has an empty `main` branch.

## Decision recorded by the spec

Use the stack above. This ADR does not select additional services or approve production deployment. Runtime versions verified in the local environment and pinned for the P00 scaffold are Node.js 20.13.1 and pnpm 9.15.0 (resolved by installed Corepack).

## Consequences

- Runtime package choices and Vercel/Supabase environment setup must be implemented in their planned phases.
- No database object names may be implemented without the owner's `mova_` prefix requirement (CR-001).
- Protected `main` and required PR checks remain an external GitHub setting (CR-006).
