# apps/web: the Mova app (React + Vite PWA)

One mobile-first web app, installable as a PWA (spec D-02). It serves:
- **Artist app** `/app/*` (five tabs: Home, Calendar, Clients, AI Revenue, Reports; Settings from the Home photo)
- **Onboarding** `/onboarding/:step`
- **Public and client pages**: showcase `/artists/:handle`, booking, `/b/:token`, `/me`, `/s/:handle`, `/claim/:token`, `/p/:code`, `/review/:token`, `/chat/:handle` (SSR/prerender per ADR-0003)
- **Marketing** `/en/*`, `/es/*` (F14)

The active route table is `app/routes.ts`; the screen-by-screen map is in `docs/design/SCREEN_MAP.md`.

## Stack (versions pinned in P00/P01, not here)
React + TypeScript (strict), Vite, React Router, TanStack Query, Zod (schemas from `packages/contracts`), Tailwind mapped to `packages/design-tokens`,
react-i18next (proposed, ADR-0002), `@supabase/supabase-js` for RLS-allowed reads/writes only. Money, bookings, consent, messaging, AI, wallet and
reviews go through Edge Functions (§3.3).

## Layout
```text
app/
  root.tsx  routes.ts
src/
  app/          shells: ArtistShell (tabs), PublicShell, ClientShell, OnboardingShell, TabBar (separate query caches artist vs client)
  components/   design-system primitives from docs/design/COMPONENTS.md (P02)
  features/     one folder per feature (screens, hooks, feature components); see list below
  i18n/         index.ts, locale.ts, resources/{en-US,es-US}/<namespace>.json
  lib/          supabase.ts, api.ts, query-client.ts, env.ts, seo/, analytics.ts, share.ts
  styles/       global CSS, token import, fonts
  pages/marketing/
```
Features: `auth`, `onboarding`, `showcase`, `services`, `locations`, `availability`, `booking`, `calendar`, `clients`, `notes`, `import`, `money`, `getpaid`, `calendarsync`, `qr`, `settings`, `plans`, `revenue/hub`, `revenue/forecast`, `revenue/slots`, `revenue/pipeline`, `revenue/winback`, `revenue/autopilot`, `revenue/templates`, `revenue/activity`, `concierge/inbox`, `concierge/thread`, `concierge/quotes`, `concierge/setup`, `reports`, `reputation`, `reviews`, `customer/signin`, `customer/profile`, `customer/card`, `customer/wallet`, `customer/scan`, `customer/claim`, `acquisition`, `notifications`.

i18n namespaces (§9 + v1 F13): common, onboarding, booking, payments, clients, growth, legal, marketing, customer, wallet, notes, revenue, slots,
autopilot, templates, reports, reviews, concierge, getpaid. `scripts/check-locales.mjs` enforces locale parity, critical strings, and literal translation-call keys during builds.

## Rules
- Screens compose `src/components/` only, styled with tokens. No raw hex values (see `docs/design/README.md`).
- Never import note types or tenant-private DTOs into public/client routes (F17-AC01).
- Service-role key never in this app (CI check).
