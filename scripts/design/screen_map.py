"""Write docs/design/SCREEN_MAP.md from the export manifest + spec §2.1/§2.3/§13. Usage: python3 -I screen_map.py <docs_design_dir>"""
import json, sys, collections
d = sys.argv[1]
man = json.load(open(f'{d}/screens/manifest.json'))
by = collections.OrderedDict()
for m in man:
    by.setdefault(m['number'], []).append(m)

# number: (route, shell, features/ACs, phase, components)
S = {
 '01': ('/onboarding/account', 'Onboarding', 'F01, F13 · F01-AC02, F01-AC06', 'P03', 'TextField, RadioCard (app language), Button primary, Segmented EN/ES, StepperProgress'),
 '02': ('/onboarding/profile', 'Onboarding', 'F01 · F01-AC03, F01-AC06', 'P03', 'ProfilePhoto, TextField (handle prefix + availability), Chip (specialties ≤5), TextArea, StepperProgress'),
 '02b': ('/onboarding/photo', 'Onboarding', 'F01 · F01-AC04', 'P03', 'PhotoCrop (empty + preview), Button primary/ghost, StepperProgress'),
 '03': ('/onboarding/services · /app/settings/services', 'Onboarding / Artist', 'F03 · F03-AC01, F02-AC03', 'P04', 'Card, TextField, Toggle, Segmented $/%, ListRow, Button'),
 '04': ('/onboarding/location · /app/settings/locations', 'Onboarding / Artist', 'F03 · F03-AC02, F03-AC05', 'P05', 'TextField, RadioCard (booking mode, collector), Chip (days), HonestyBanner, Button'),
 '05': ('/onboarding/payments', 'Onboarding', 'F06, F23 · A-02, A-16', 'P03 (skeleton) / P08', 'Card inverse, Toggle, HonestyBanner, Button on-dark'),
 '06': ('/onboarding/publish', 'Onboarding', 'F01 · F01-AC01, F01-AC05', 'P03', 'Card (preview), checklist ListRow, Toggle (search index), Button primary'),
 '07': ('/app/home', 'Artist (tab 1)', 'D-26, F20, F18, F22 · F20-AC01', 'P06 / P12 / P14', 'ScreenHeader + Avatar (→16), KPITile ×3, SectionOverline, ListRow (Needs you), Timeline-like Today list, LocationTag, StatusChip, TabBar'),
 '08': ('/app/calendar · /app/calendar/:date', 'Artist (tab 2)', 'F04', 'P06', 'DayStrip/week strip, Chip (location filter), day timeline blocks, HonestyBanner, FAB IconButton, TabBar'),
 '09': ('/app/appointments/:id', 'Artist', 'F04, F06, F17 · F17-AC02', 'P06 / P07 / P08', 'StatusChip, DefinitionList, Card (payment), Card warm (Before you start), sticky action bar, Button primary/secondary/destructive'),
 '10': ('/app/requests/:id', 'Artist', 'F04 · F04-AC01, F04-AC06', 'P06', 'StatusChip pending + expiry, HonestyBanner, RadioCard (first/alt time), DefinitionList, Button'),
 '11': ('/app/clients', 'Artist (tab 3)', 'F05 · F05-AC01', 'P07', 'TextField search, Chip filters, ListRow + Avatar initials + StatusChip, IconButton, TabBar'),
 '12': ('/app/clients/:id', 'Artist', 'F17 · F17-AC01, F15-AC04', 'P07', 'Avatar, Button, Segmented, Card warm, ListRow (notes by category), consent summary'),
 '12b': ('/app/clients/:id/visits', 'Artist', 'F17', 'P07', 'Segmented, ListRow (visit summaries, photo count), StatusChip'),
 '12c': ('/app/clients/:id/visits/:appointmentId', 'Artist', 'F17 · F17-AC02, F17-AC03', 'P07', 'photo grid (private), TextArea, Chip (products), Toggle (show next visit), Button'),
 '13': ('/app/clients/import', 'Artist', 'F05 · F05-AC03, F05-AC04, F05-AC05', 'P07', 'KPITile counts, Card (duplicate resolver), Button Merge / Keep both, HonestyBanner, disabled Button'),
 '14': ('/app/revenue', 'Artist (tab 4 "AI Revenue")', 'F19 · F19-AC01…04', 'P12', 'Card inverse (forecast, Estimate label), ListRow tiles with counts, Link, TabBar'),
 '15': ('— TABLED, do not build (D-25)', '—', '—', '—', '—'),
 '16': ('/app/settings', 'Artist (modal from Home avatar)', 'D-15', 'P02 / P03', 'Card inverse (profile), Button secondary ×2, ListRow nav, Button ghost (Sign out)'),
 '16a': ('/app/settings/services', 'Artist (Settings)', 'F03', 'P04', 'ScreenHeader, ServiceCard, DepositSummary, LocationOverrideRow, StatusChip, Button'),
 '16b': ('/app/settings/portfolio', 'Artist (Settings)', 'F02 · F02-AC04, F03', 'P04', 'ScreenHeader, PortfolioItem, Thumbnail, AltTextStatus, ServiceLink, ReorderControl, StatusChip, Button'),
 '17': ('/app/settings/money', 'Artist', 'F06 · F06-AC01, F06-AC03', 'P08', 'month picker, MiniBarChart breakdown + legend + table view, DefinitionList, ListRow activity'),
 '18': ('/app/settings/money/get-paid/:appointmentId', 'Artist (sheet)', 'F23 · F23-AC01…04', 'P08', 'Sheet, TextField amount, RadioCard method group, per-method panel, Button primary (label per method)'),
 '19': ('/app/settings/locations', 'Artist', 'F03', 'P05', 'Card per location, LocationTag, StatusChip mode, KPITile small (buffer/notice/horizon), Button'),
 '20': ('/app/settings/calendar-sync', 'Artist', 'F07', 'P09', 'HonestyBanner (one-way), Card (Google), RadioCard privacy, masked URL + Button copy/reset'),
 '21': ('/app/settings/qr', 'Artist', 'F10 · F10-AC01, F10-AC02', 'P10', 'full-bleed inverse screen, ProfilePhoto, QRDisplay, Button ghost (Share link / Share image)'),
 '22': ('/app/settings/plan', 'Artist', 'F12 · A-01, A-26', 'P15', 'StatusChip "Proposed pricing · not final", Card ×3 (plans), Button'),
 '23': ('/artists/:handle?locale={en-US,es-US}', 'Public (SSR on Vercel)', 'F02, F21 · F02-AC01, F02-AC02, F02-AC05, F21-AC04', 'P04', 'cover, ProfilePhoto 104, rating (hidden until A-20), LocationTag, Segmented Looks/Services, look tiles + Button, sticky Button'),
 '24': ('/artists/:handle?tab=services&locale={en-US,es-US}', 'Public', 'F02, F03 · F02-AC03', 'P04', 'same header as 23, ListRow service rows with deposit text + Button compact'),
 '25': ('/artists/:handle/book', 'Public', 'F04 · F04-AC04, F03-AC05', 'P06', 'Card summary, DayStrip, TimeSlot groups by LocationTag + StatusChip mode, summary line, sticky Button'),
 '26': ('/artists/:handle/book (details)', 'Public', 'F04, F15 · F04-AC05, F15-AC01', 'P06 / P08 / P10', 'Card summary, Link (Sign in), TextField ×3, Checkbox consents, Stripe Payment Element, policy text, Button primary'),
 '27': ('/signin (sheet or page)', 'Client', 'F15 · F15-AC02', 'P10', 'Sheet, benefits list, TextField contact, Checkbox marketing opt-in, Button, Link (guest)'),
 '28': ('/b/:token', 'Public / Client', 'F04, F16 · F04-AC01, F16-AC01', 'P06 / P10', 'StatusChip confirmed/request, DefinitionList, ClientCard + wallet badges, Link save image, Button (calendar, manage)'),
 '29': ('/me', 'Client', 'F15, F16 · F15-AC05, F15-AC06', 'P10', 'ClientCard, ListRow upcoming, ListRow My stylists, Toggle per stylist, Link edit/sign out/delete'),
 '30': ('/s/:handle', 'Public', 'F16 · F16-AC04, F16-AC05', 'P10', 'ProfilePhoto hero, Button primary (Book), wallet badges, Button ghost (Add to My stylists), Link'),
 '31': ('/app/revenue/slots', 'Artist', 'F18', 'P12', 'KPITile results strip, Card per slot + StatusChip, ListRow history'),
 '31b': ('/app/revenue/slots/:slotEventId', 'Artist', 'F18 · F18-AC03, F18-AC07', 'P12', 'DefinitionList (match count, waves), Card (SMS preview + just-taken), Card (social post) + Button share, sticky Button primary'),
 '31c': ('/app/revenue/slots/:slotEventId/live', 'Artist', 'F18 · F18-AC04, F18-AC08', 'P12', 'StatusChip live/filled, Card inverse (filled), Timeline waves, Button (next wave / stop)'),
 '31d': ('/claim/:token', 'Public', 'F18 · F18-AC05, F18-AC06', 'P12', 'ProfilePhoto, DefinitionList slot details, Button Claim, ListRow other times (just-taken state)'),
 '32': ('/app/revenue/pipeline', 'Artist', 'F08 · F08-AC06', 'P12', 'KPITile month totals, SectionOverline groups, ListRow + StatusChip'),
 '33': ('/app/revenue/winback', 'Artist', 'F08 · F08-AC07', 'P12', 'Card per client, TextArea (artist offer), Button Send (manual), locked ListRow (opted out)'),
 '34': ('/app/revenue/autopilot', 'Artist', 'F08, F18 · F08-AC04 · A-21', 'P12', 'Card inverse + Toggle master switch, DefinitionList rules, ListRow links'),
 '35': ('/app/revenue/autopilot/messages', 'Artist', 'F08 · F08-AC05', 'P12', 'Card per template + StatusChip, Segmented EN/ES preview, variable Chips, Button Edit/Approve'),
 '36': ('/app/revenue/autopilot/activity', 'Artist', 'F08 · F08-AC08', 'P12', 'Chip filters, SectionOverline by day, Timeline (icon + text status), Button compact Export'),
 '37': ('/app/reports', 'Artist (tab 5)', 'F20 · F20-AC01, F20-AC03, F20-AC04', 'P14', 'Segmented period, KPITile, MiniBarChart + table view, ListRow sections, TabBar'),
 '38': ('/app/reports/reputation', 'Artist', 'F21 · F21-AC03, F21-AC05', 'P14', 'rating summary + breakdown bars, Chip filters, Card per review + Button Reply, Toggle ask-for-review'),
 '39': ('/review/:token', 'Public', 'F21 · F21-AC01, F21-AC02', 'P14', 'ProfilePhoto, star radiogroup, Chip tags, TextArea, Button, Link Also on Google'),
 '40': ('/app/revenue/concierge', 'Artist', 'F22', 'P13', 'StatusChip status, KPITile today, SectionOverline, ListRow Needs you + Handled, Link Teach it'),
 '41': ('/app/revenue/concierge/:conversationId', 'Artist', 'F22 · F22-AC01, F22-AC02, F22-AC06', 'P13', 'MessageBubble (client/ai/artist/system), Toggle per-chat AI, TextField reply'),
 '42': ('/app/revenue/concierge/quotes/:id', 'Artist', 'F22 · F22-AC04', 'P13', 'photo grid, DefinitionList details, Card warm (risk flag), Chip prices, Button primary + Link strand test'),
 '43': ('/app/revenue/concierge/setup', 'Artist', 'F22 · A-23, A-25, A-30', 'P13', 'ListRow channels + status, Toggle permissions, locked "Always you" row, ListRow knowledge, tone/language'),
 '44': ('/app/appointments/:id (sheet)', 'Artist (sheet)', 'F04 · F04-AC08', 'P06', 'Sheet, Segmented 5/10/15/20+, Card message preview, HonestyBanner (salon not notified), Button'),
 '45': ('/chat/:handle · SMS thread (client view)', 'Public / channel', 'F22, F13 · F22-AC01, F22-AC07', 'P13', 'disclosure header, MessageBubble (es-US), photo messages'),
}
assert set(S) == set(by), set(S) ^ set(by)

L = ['# Mova screen map', '',
     'Every canvas artboard mapped to its route, app shell, features and acceptance criteria, build phase, and the components it is built from. '
     'This is the starting point for `docs/engineering/SCREEN_INVENTORY.md` (P00-T05): copy it there and add implementation files as they land.', '',
     f'**{len(by)} mapped screens** ({sum(1 for m in man if m.get("canvas_file") != "Owner-approved derived reference")} original canvas renders plus {sum(1 for m in man if m.get("canvas_file") == "Owner-approved derived reference")} owner-approved derived references; screen 15 TABLED) → **{len(man)} reference renders** including state variants.', '',
     'Every screen must also implement the states the canvas does not draw: **loading (skeleton), empty, error + retry, offline, permission denied, validation** (§2.3), '
     'at 320–430 px, in en-US and es-US, with 44 px targets, keyboard order, screen-reader labels and reduced motion. Visual acceptance: QA case `TC-SCR-<number>-01`.', '',
     '| # | Screen | Reference render(s) | Route | Shell | Features · key ACs | Phase | Built from |', '|---|---|---|---|---|---|---|---|']
for num, items in by.items():
    route, shell, feats, phase, comps = S[num]
    title = items[0]['title'].split(' ', 1)[1]
    refs = '<br>'.join(f'[{(i["state"] or "default")}](screens/png/{i["id"]}.png) · [html](screens/html/{i["id"]}.html)' for i in items)
    L.append(f'| {num} | {title} | {refs} | `{route}` | {shell} | {feats} | {phase} | {comps} |')
L += ['', '## Screens with no artboard yet (spec §2.4)', '',
      'These are required for V1. The phase that needs them cannot be accepted until the product owner approves a design (QA cases `TC-SCR-TBD-01…10`).', '',
      '| Needed by | Screen / state |', '|---|---|',
      '| P06 | Cancel / reschedule flows (artist and client), refund confirmation, policy display |',
      '| P06 | Client manage-appointment page variants (reschedule picker, cancel confirm) |',
      '| P11 | Notification & language settings; in-app notification inbox |',
      '| P16 | Privacy & data: export, delete account, delete client, retention notices |',
      '| P13 | Spanish variants of guest flows 23–31d (layout check with long strings) |',
      '| P14 | Review reply composer; report review |',
      '| P13 | Concierge exception "Decide" sheet; web chat widget on showcase |',
      '| All | Loading / empty / error / offline states (pattern library acceptable) |',
      '| P10 | `/c/:token` rebook/check-in page; delete-profile confirmation |',
      '']
open(f'{d}/SCREEN_MAP.md', 'w').write('\n'.join(L))
print('screen map rows', len(by))
