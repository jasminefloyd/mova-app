# Mova component guide

This is the component set from spec §2.5, measured from the canvas. **P02 builds these in `apps/web/src/components/`**. Every screen in `SCREEN_MAP.md` is assembled only from these components and the tokens in `tokens/`.

General rules (from spec §2.3 / §2.5):
- **Tokens, not hex.** Only `var(--…)` or the Tailwind theme mapped from `tokens.json`. A lint rule should reject raw colours in `apps/web/src`.
- **Touch targets** are at least 44 × 44 px, including icon buttons and links inside cards.
- **Never use colour alone.** Status always has an icon and text; locations always have their name next to the colour.
- **Every interactive component has these states:** default, hover (desktop), focus-visible (2px forest ring with a 2px ivory offset), pressed, disabled and loading.
- **Text fits 320–430 px wide in en-US and es-US.** Spanish strings run about 20–30% longer, so nothing truncates critical copy.
- **Motion respects reduced-motion.**
- **Native elements where they exist:** buttons are `<button>`, toggles are real checkboxes, radio groups use `<input type="radio">` or `role="radiogroup"`, and sheets are dialogs.

Measurements are CSS px at the 390 px reference width. "Seen on" lists canvas screen numbers (see `screens/`).

---

## Actions

### Button
| Variant | Height / radius | Fill / border | Text | Seen on |
|---|---|---|---|---|
| `primary` | 54 / 27 (pill) | `--forest`, no border | `--ivory`, DM Sans 700 16 | Continue, Publish, Pay & book, Mark complete, Approve & send |
| `secondary` | 46 / 23 | `--surface`, 1px `--line-control` | `--ink-primary`, DM Sans 600 14 | Record pay, Reschedule, View my page |
| `destructive` | as `secondary` | as `secondary` | `--danger` 600 | Cancel (09), Decline (10) |
| `ghost` | 44, no fill | transparent | `--ink-primary` 700 (or `--danger` for Sign out) | Retake, Skip, Sign out |
| `compact` | 40 / 20 | as `secondary` | 600 13 | Export (36), header actions |
| `on-dark` | 44–48 / pill | `--ivory` on `--forest` surfaces | `--forest` 700 | Connect with Stripe (05) |

- **Loading:** keep the width, show a spinner in place of the label, and set `aria-busy`.
- **Disabled:** 40% opacity, not focusable as a click target, reason shown nearby (e.g. Import disabled until duplicates resolved, 13).
- **Sticky action bar:** primary actions sit in a bottom bar (`--surface-page`, top border 1px `--line-bar`, padding 12 20 26). A primary button can have a secondary row under it (09).

### IconButton
44 × 44 hit area with a 22 px glyph. It requires `aria-label`. Used for back chevron, close ×, overflow ⋯, and add + (FAB on 08: 56 px circle, `--forest`, `--shadow-raised`).

### Link
DM Sans 700 13–14, `--ink-primary`, underlined only where inline in body copy. Minimum height 32 in lists (`All notes`, `Notes for today`).

## Inputs

### TextField
- Height 52, radius 14, 1px `--line-control`, `--surface` background, DM Sans 400 16 (never below 16).
- Label above in 600 13 `--ink-muted`; helper or error text below in 12 (error in `--danger` with an icon).
- Prefix slot for things like `[DOMAIN]/artists/` on 02. Inline availability state for handles: ✓ Available or error.
- Seen on 01, 02, 03, 04, 18, 26, 27, 39.

### TextArea
As TextField, minimum 96 high (bio on 02, review comment on 39). A character counter appears where a limit exists (1,000 on 39).

### Toggle
- Track 52 × 32 radius 16; knob 24 white.
- On: `--forest` track (on light surfaces) or `--sage` (on `--forest` surfaces). Off: `--line-control` track.
- Must be a real `<input type="checkbox" role="switch">` inside a `<label>` with visible text. Seen on 03, 05, 06, 12c, 21, 34, 38, 41, 43.

### Checkbox
22 px box, radius 6; checked state is `--forest` with an ivory check. Used for consent choices on 26 and 27. **Consent boxes are never pre-checked** except "Text me about this appointment" (transactional, §5.5).

### RadioCard / OptionGroup
- Option buttons 48 high, radius 14.
- Selected: 2px `--forest` border with `--forest` fill and `--ivory` 700 text (method picker on 18), or white with a forest border and a dot (booking mode on 04).
- Unselected: 1px `--line-control`.
- `role="radiogroup"`, arrow-key navigation.

### Segmented
Two to three options inside one pill with a selected forest segment. Used for Looks | Services (23/24), Profile & notes | Visits (12), period 7/30/90 days (37), $ | % (03).

### Chip (filter / choice)
- Height 36, radius 18. Selected: `--forest` fill, `--ivory` 600 13. Unselected: white with 1px `--line-control`.
- `aria-pressed` for toggles.
- Used for specialties on 02 (maximum 5), filters on 11, 36 and 38, and price chips on 42.

### DayStrip
Horizontally scrollable day buttons about 58 × 66, radius 14, each with weekday, date and "N open". The selected day is forest. Full days are disabled and say "Full", which is not shown by colour alone. Seen on 25 and 08.

### TimeSlot
- Height 46, radius 14. Selected: mint fill with a forest border. Grouped under a location header with a mode StatusChip.
- Request-mode slots use a dashed `--status-pending-border` (25).

### PhotoCrop
- Circular crop with a zoom slider and a small-size preview.
- Empty state: dashed face guide on `--surface-alt` plus 3 tips, and Take photo / Choose photo / Later. Preview state: Use this photo / Retake.
- Seen on 02b (both states exported).

## Display

### StatusChip
- Pill with radius 12, padding 5 10, DM Sans 700 13. **Icon + text always.**
- Variants:
  - `confirmed`: mint with check;
  - `pending` / `request`: warm with dashed border and clock;
  - `live`: mint with a dot;
  - `needs-approval`: warm;
  - `filled`, `expired`, `cancelled`: `--danger` text on `--surface-warm` with ×;
  - `info`: `--surface-alt`.
- Used on almost every artist screen.

### Badge / Count
Small count pill, radius 10, min-width 20. Also the unread dot (10 px `--accent-warm-strong`) with a visually-hidden label.

### Card
- `--surface`, 1px `--line`, radius 20 (content) or 18 (list cards), padding 14 16.
- Variants:
  - `inverse`: `--surface-inverse` with ivory text (client card, autopilot on, settings header);
  - `warm`: `--surface-warm`, no border (Before you start, risk flags).
- Card titles are Manrope 700 16.

### ListRow
- Minimum height 52, divider 1px `--line-subtle` between rows (not after the last one).
- Slots: leading (avatar, icon or time), title 600 15, subtitle 13 `--ink-muted`, trailing (value, StatusChip, toggle or chevron).
- The whole row is a link when it navigates.

### DefinitionList
Label/value rows inside a Card: label 14 `--ink-muted`, value 14 600 right-aligned (09, 10, 31d, 34).

### Avatar / ProfilePhoto
- Circle on a `--peach` fill. When there's no photo, the placeholder silhouette is in `--accent-warm-strong`.
- Sizes: 32 (rows), 40 (thread), 56 (settings), 104 (showcase header), 120+ (scan landing 30, claim 31d).
- Initials fallback (forest on mint) where the canvas shows initials (11).
- Always `role="img"` with an `aria-label` naming the person.

### KPITile
- Label 11–12 600 uppercase-ish `--ink-muted`, value Manrope 800 20–28, delta 12 with ▲/▼ and text ("+12% vs last week").
- The Home strip (07) is three tiles on `--surface-inverse`; Reports (37) uses light tiles.
- Tapping opens Reports.

### MiniBarChart
- Single-hue bars (`--botanical`; the current period in `--forest`), radius 3, no gridlines, values on tap/hover.
- **Must have a table view** (F20-AC03).
- Used on 37 (revenue by week) and 17 (breakdown bar + legend with text labels).

### Timeline
Vertical list with a 28 px icon circle per event and text status (Sent, Skipped, Held, Not delivered, Rebooked; or wave 1/2/3). Icons differ by shape, not only colour. Seen on 31c and 36.

### MessageBubble
- Variants:
  - `client`: white with a `--line` border, left;
  - `ai`: `--forest`, ivory text, right, labelled "Ari's assistant · AI" above;
  - `artist`: `--botanical`, right, labelled with the artist's name;
  - `system`: centred, 12 `--ink-muted`, for things like "Booking request created · review it".
- Photo attachments sit in rounded 14 thumbnails.
- Seen on 41 and 45; the Spanish thread is on 45.

### QRDisplay
- High-contrast forest-on-white QR with a quiet zone of at least 4 modules and error correction M or better (F10).
- Artist version is full-bleed on forest (21); client card version is small inside the card (28, 29). Optional centre photo where shown.

### ClientCard
- `--surface-inverse` card: "mova" wordmark, "CLIENT CARD", client name, "With {artist}", next appointment line (or "Requested · …"), small QR.
- Followed by the wallet buttons. **Use the official Apple Wallet / Google Wallet badges, not the black placeholders** (A-06/A-19). There's also a "Save the card as an image" link.
- Seen on 28 and 29.

### StepperProgress
Onboarding progress: segments 4 high, radius 2, done = `--forest`, to do = `--line-step-off`. Plus "Step N of 6" text (01–06).

### EmptyState / ErrorState / OfflineBanner / Skeleton
- Not drawn on the canvas, and required on every screen (§2.3, §2.4 "pattern library acceptable").
- Empty: icon + one line + primary action. Error: message + Retry. Offline: banner "You're offline. Changes need a connection." with network actions disabled.
- Skeleton blocks use `--surface-alt`.
- Design these once in P02 for owner approval (G2a).

### Toast
Bottom, above the tab bar, `--surface-inverse` with ivory text, 4 s, `role="status"`, with an optional action ("Undo").

## Navigation and containers

### TabBar
- Height 82 including the safe area, `--surface`, top border 1px `--line-bar`, padding 8 6 22.
- Five items, each a 22 px icon over an 11 px label: **Home, Calendar, Clients, AI Revenue, Reports** (D-15). "AI Revenue" comes from a single i18n key.
- Active item: mint pill 52 × 30 radius 15 behind the icon, label `--forest` 700, `aria-current="page"`. Inactive: `--ink-tab-inactive` 600.
- Only shown on the five tab roots.

### ScreenHeader
- 44 px back chevron or close × on the left; optional centred title 15 700; up to 2 trailing actions.
- The large title below is h1 Manrope 800 28 with letter-spacing −0.4.
- Settings (16) opens from the Home avatar and uses close ×.

### Sheet
- Bottom sheet over a `--scrim` backdrop, top radius 28, `--surface-page`, with a grab handle.
- `role="dialog"`, `aria-modal`, focus trap, Escape / swipe-down / Close all dismiss, and focus returns to the trigger.
- Used for 18 Get paid, 27 Sign in and 44 Running late.

### SectionOverline
h2 in DM Sans 700 13 uppercase, letter-spacing 0.4, `--ink-muted`: "Today", "Needs you · 3", "Coming up".

### LocationTag
Colour dot (8 px, `--location-n`) + location name, both always. Optional mode StatusChip. Used on 07, 08, 09, 19 and 25.

### HonestyBanner
A `--surface-inverse` or warm card with a clock icon that explains request-mode reality: "Not confirmed yet. Check Luxe Salon's book first…" (10), "Salon bookings don't appear here" (08), "Mova doesn't process or verify" (05). Copy comes from i18n and must not be shortened in a way that changes its meaning.

---

## Component → screen coverage
P02 must render every component in every state in a component gallery route (dev only), then:
- write visual baselines at 360/390/430;
- get owner sign-off (gate G2a).

Screens are accepted against `screens/png/*.png` (QA cases `TC-SCR-*`).
