# Mova design handoff (`docs/design/`)

This folder is everything an engineer or coding agent needs to make the app **look and behave like the approved canvas**, built from **this repo's own components and tokens**.

- **Source:** the "Mova App Screens" design canvas (51 artboards), exported 2026-11-05. Two Settings management references (Services and Portfolio) were derived from the approved design system with owner approval on 2026-11-05; they are not canvas artboards. On 2026-11-08, O12 owner approval added multi-service summaries to the Screen 25/26 reference variants; the source canvas itself was unavailable, so those two files are explicitly recorded as local approved updates in `design-manifest.json`. `design-manifest.json` records the canvas version and file hashes.
- **Status:** normative UI reference (spec §0.1). The engineering spec (`docs/product/ENGINEERING_SPEC.md`) wins on behaviour; this folder wins on layout, hierarchy and visual style.

## What's here

| Path | What it is | How to use it |
|---|---|---|
| `screens/png/` | 60 renders at 390 × 844 @2x: every canvas artboard, two owner-approved derived Settings references, plus state variants (photo empty/preview, Get paid × 4 methods, booking confirmed/request, campaign live/filled, claim open/just taken) | The **visual target**. Visual regression baselines and `TC-SCR-*` QA cases compare against these. |
| `screens/html/` | Static reference HTML of the same screens, offline, with self-hosted fonts and links between screens | Read for exact spacing, sizes, copy and semantics (aria labels, roles). **Never copy this markup into the app.** |
| `screens/index.html` | Gallery of all screens | Open in a browser to browse. |
| `screens/manifest.json` | Machine-readable list: id, number, title, state, canvas file | Use to generate baselines or inventories. |
| `SCREEN_MAP.md` | Each screen → route → shell → features/ACs → phase → components | Starting point for `docs/engineering/SCREEN_INVENTORY.md` (P00-T05). |
| `COMPONENTS.md` | The §2.5 component set with measured sizes, variants, states and accessibility rules | What P02 builds in `apps/web/src/components/`. |
| `tokens/tokens.json`, `tokens/tokens.css` | Colours, type, radii, spacing, sizes, shadows, motion | Source for `packages/design-tokens` and the Tailwind theme (P01-T01, P02-T01). |
| `fonts/` | Manrope 600/700/800 and DM Sans 400–700 (latin, woff2) + SIL OFL 1.1 licences | Self-host these (P02-T01). Add `latin-ext` subsets for Spanish names if needed. |
| `icons/` | The 30 stroke icons used on the canvas (24 px, currentColor) + `index.html` gallery + `icons.json` usage | Use these, or the closest match in the icon set chosen in P02. |
| `CANVAS_NOTES.md` | The canvas sticky notes (decisions and scope flags) | Context only; the spec wins where they differ. |

## Rules for implementers (also in root `AGENTS.md`)

1. **Build components first (P02), then screens.** Screens compose components from `apps/web/src/components/` only. No one-off styled divs that duplicate a component.
2. **Tokens only.** No raw hex values, font sizes or radii in feature code. Map `tokens.json` into Tailwind / CSS variables once.
3. **Sample data is illustrative.** Names (Ari Monroe, Andrea L.), prices, times, counts and the `[DOMAIN]` placeholder must never be hardcoded. Screens render from the API and seed data.
4. **Draw the states the canvas doesn't.** Loading, empty, error + retry, offline, permission denied and validation are required on every screen (§2.3). Use the pattern-library components in `COMPONENTS.md`.
5. **Responsive and bilingual.** Layouts are drawn at 390 px but must work at 320–430 px, in en-US and es-US (longer strings), with safe areas.
6. **Honesty copy is product behaviour.** Request-mode labels ("Ari confirms"), "Estimate", "Recorded only", "Proposed pricing · not final" and the AI disclosure come from i18n keys and must not be dropped or reworded without approval.
7. **Do not build screen 15** (TABLED, D-25).
8. **Third-party artwork:** use the official Apple Wallet and Google Wallet badges, Stripe Elements and the official Instagram/Google marks per their guidelines, not the canvas placeholders.
9. **Accessibility:** WCAG 2.2 AA, 44 px targets, focus-visible ring, status never shown by colour alone, real form controls.
10. **Mismatch = stop.** If a screen can't match its render, or needs a screen listed under "Screens with no artboard yet" in `SCREEN_MAP.md`, open a design request in `docs/engineering/CHANGE_REQUESTS.md`. Don't invent the design.

## Updating this folder
The canvas stays the design source of truth. After an approved canvas change, re-export and commit with a note naming the screens that changed. Re-export means:
- regenerate `screens/` with the scripts in `scripts/design/`;
- update `design-manifest.json`;
- re-run `SCREEN_MAP.md`.

## Email design system (EM0)

Email templates use the Mova app colors, rounded panels, status chips, date tiles and pill buttons. Render a 600px max-width, single-column email with a header, one state-led hero, appointment details, one primary action and a footer. Use inline styles and table layout for mail client compatibility; retain plain-text alternatives and escape interpolated values. Minimum body text is 15px and CTA targets are at least 44px. Spanish strings must not truncate.

Voice is warm and direct: lead with the event (“You’re booked, Simone.”), use the stylist’s name in client emails, describe who acts next, and state what was paid, is due, refunded or not charged. No emoji, urgency tricks or exclamation marks. Subject stays concise; preview supplies date/time.

| State | Visual treatment | Templates |
|---|---|---|
| Confirmed | Forest hero, ivory date tile and mint status chip | Booking confirmed, request accepted, reminder, moved, stylist welcome |
| Not confirmed | Warm dashed panel, explicit pending language | Request sent, stylist new request |
| Closed | White hero | Declined, cancelled, password reset |
| Review | Forest hero with warm stars | Review request (A-29 approval and real postal address required) |

| Template | Recipient | Language | State |
|---|---|---|---|
| Booking confirmed | Client | EN/ES | Built; existing provider gate |
| Request sent | Client | EN/ES | Built; existing provider gate |
| Request accepted | Client | EN/ES | Built; existing provider gate |
| Request declined | Client | EN/ES | Built; existing provider gate |
| Reminder | Client | EN/ES | Built; existing provider gate |
| Appointment moved | Client | EN/ES | Built; proposed-template gate defaults off |
| Appointment cancelled | Client | EN/ES | Built; proposed-template gate defaults off |
| Review request | Client | EN/ES | Branded renderer built; delivery awaits A-29 and postal address |
| Confirm email | Stylist | EN/ES | Supabase Auth template files/config added; hosted dashboard setup required |
| Reset password | Stylist | EN/ES | Supabase Auth template files/config added; hosted dashboard setup required |
| Welcome | Stylist | EN/ES | Branded renderer and profile-created event; proposed-template gate defaults off |
| New request to answer | Stylist | EN/ES | Built; proposed-template gate defaults off |

Never send with the `[MAILING ADDRESS]` placeholder. Proposed delivery is off unless `MOVA_EMAIL_PROPOSED_ENABLED=true`; review requests require the extra `MOVA_EMAIL_REVIEW_REQUESTS_ENABLED=true` gate and an actual `MOVA_EMAIL_POSTAL_ADDRESS`. Provider sending also requires its existing explicit live configuration. See `supabase/functions/_shared/providers/email/README.md` for secrets and rollout details.

Visual baselines in `tests/visual/` are updated in the same PR, with owner approval (gate G2a).
