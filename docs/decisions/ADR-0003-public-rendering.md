# ADR-0003: Public rendering for SEO and social previews

- Status: OPEN — owner approval A-13 required before P04 acceptance.
- Date: 2026-11-05
- Source: Engineering Spec v2.0 §§0.5, 0.6, 3.2, 7.1

## Context

Public artist pages and acquisition routes must return crawler-readable HTML, canonical URLs, and reciprocal hreflang where applicable. The spec requires SSR or prerendering on Vercel but does not choose between them. The final domain and artist URL ownership remain open under A-07/A-13.

## Options recorded in the spec

- Server-side rendering on Vercel.
- Build-time or request-time prerendering on Vercel.

## Decision

Not selected. Record a decision only after the owner approves the rendering architecture and URL/canonical implications.

## Consequences

- Do not implement public rendering architecture in P00.
- P04 remains blocked from acceptance until ADR-0003 and A-13 are resolved.
