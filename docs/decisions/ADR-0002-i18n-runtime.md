# ADR-0002: Internationalization runtime

- Status: Draft for review; library choice proposed in the normative spec.
- Date: 2026-11-05
- Source: Engineering Spec v2.0 §§0.6, 9, 13

## Context

The app requires en-US and es-US, independent artist and guest locales, persistence, localized transactional templates, and release-blocking parity for critical strings.

## Proposed decision

Use `react-i18next`, versioned typed locale catalogs, Intl formatting, and explicit fallback rules as stated in the spec. This remains a proposal pending the engineering ADR review; it does not authorize machine-only Spanish legal or financial copy.

## Consequences

- Locale runtime and CI checks are part of P01.
- Human review remains required for critical Spanish copy (A-12).
