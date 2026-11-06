# ADR-0003: Public rendering for SEO and social previews

- Status: APPROVED — owner selected SSR on Vercel, `locale` query alternates and the F02 base canonical.
- Date: 2026-11-05
- Source: Engineering Spec v2.3 §§0.5, 0.6, 3.2, 7.1; public rendering decision retained from v2.2

## Context

Public artist pages and acquisition routes must return crawler-readable HTML, canonical URLs, and reciprocal hreflang where applicable. The product owner selected SSR on Vercel and approved English/Spanish artist-page alternates on 2026-11-05. The owner selected `/a/:handle?locale=en-US` and `/a/:handle?locale=es-US` as the alternate URLs. Per F02's single canonical artist URL, both locale variants use `/a/:handle` as canonical; the Services tab is also a non-canonical view. Artist-authored text remains in its original language when the UI locale changes. Marketing `/en/*` and `/es/*` route pairs also use reciprocal hreflang. Domain/trademark ownership remains open under A-07.

## Options recorded in the spec

- Server-side rendering on Vercel.
- Build-time or request-time prerendering on Vercel.

## Decision

**Rendering:** Use server-side rendering on Vercel.

**Canonical and language URLs:** Use `/a/:handle?locale=en-US` and `/a/:handle?locale=es-US` as reciprocal hreflang alternates. Both use `/a/:handle` as canonical, following F02's single canonical artist URL; the Services tab does not create a separate canonical page. Artist-authored text may remain in its original language across the two alternates; the locale parameter identifies the rendered UI language. Marketing `/en/*` and `/es/*` counterparts use reciprocal hreflang as required by F14.

## Consequences

- Implement SSR on Vercel in P04 with origin configured through `PUBLIC_BASE_URL`; this ADR does not establish domain ownership.
- The owner-specified public profile path is `/a/:handle` on `mova-beauty.co`; operator/admin host routing is recorded in Engineering Spec v2.3 and does not imply domain or trademark clearance.
- A-13 is resolved. Domain/trademark ownership remains open under A-07 and is not decided by this ADR.
