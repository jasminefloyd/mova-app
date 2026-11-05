# Canvas annotations

Sticky notes and section titles from the "Mova App Screens" canvas, copied as written. Where a note and the engineering spec differ, **the spec wins** (it records the later decisions: D-15…D-26, A-16…A-30).

## Sections
- Onboarding · six steps to a published showcase
- Artist app · daily operations
- Artist app · growth, money & settings
- Guest booking · book as a guest or with an optional profile
- AI Revenue Center · seat filler & rebooking autopilot
- Reports & reputation
- AI Concierge · a second pair of hands for the stylist

## Notes
- All names, prices, times and money figures on these screens are illustrative sample data, not real customers or approved pricing. Grey photo blocks are placeholders for licensed portfolio imagery. The artist URL uses [DOMAIN] because the production domain is still open (A-07).
- SEAT FILLER (31–31d), adapted from the AI Seat Filler brief. A cancellation or a calendar scan opens a slot. Mova matches due clients by service and length, then drafts a text and a social post. The stylist approves the text, which sends in waves and stops when the slot is booked; everyone else gets a 'just taken' message. Social posts are always shared manually. Autopilot for slot texts is an optional setting. Each slot moves through: gap found → needs approval → live → filled / expired.
- SCOPE CHANGE: Rebooking autopilot sends without approving each message. The stylist approves the rules and templates once, and sends only go to clients who agreed to reminders. The blueprint currently lists automated outbound AI without artist review as not in V1, so this needs to be logged and approved. Win-backs stay manual. Wider marketing campaigns (15) stay tabled.
- LOCKED NAV: 5 tabs: Home, Calendar, Clients, AI Revenue (working name; the screen is titled AI Revenue Center), Reports. Business settings moved off the tab bar and open from the stylist's photo on Home (16 Settings). Money is in Reports and Settings.
- NEW SCOPE: Reviews. Mova asks for a review after completed visits only, marks them as verified, and shows them on the showcase. Google reviews are read in alongside them, which depends on Google Business Profile API approval (still open). The stylist can reply. Needs moderation, abuse reporting, and a policy against fake reviews.
- NEW SCOPE: AI Concierge for the stylist. It replies on Instagram, a Mova text number, missed calls and page chat, always identified as AI. It knows each location: it books at the stylist's own suite and only sends requests for salon times, and it never takes payment where the salon collects. Quotes, exceptions and complaints always go to the stylist. When she changes salons, its answers move with her. Dependencies: Meta Instagram messaging review, US business-texting registration (A2P 10DLC), AI vendor and evals. Voice answering comes later.
- TABLED: 15 Outreach approval. The whole marketing and outreach system will be redesigned later. Don't build from this screen.
- LOCKED: one Mova-wide client profile shared across every stylist a client books with ("My stylists"). Booking as a guest stays available.
- CONDITIONAL: Zelle (18 Get paid). Stripe doesn't support Zelle, so it needs its own provider integration. If no workable integration is found before launch, drop Zelle and keep Card, Cash and Other. Until then, the screen shows Zelle as 'Recorded only'. CARD: V1 uses Stripe pay links, sent by text or shown as a QR code at the chair. Tap to Pay comes in V1.1 with a native app shell, which needs Apple's Tap to Pay approval.
- CLIENT NOTES (12, 12b, 12c): General notes and per-visit notes belong to the stylist and are private to them. Clients can't see them, and neither can other stylists on the Mova-wide client profile. Sensitivities and allergies count as sensitive data and need privacy and retention rules.
