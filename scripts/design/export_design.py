"""Export every canvas artboard (and each state variant) to static reference HTML for docs/design.
Usage: python3 -I export_design.py <canvas_project_dir> <docs_design_dir>
Writes screens/html/<id>.html (fonts referenced from ../../fonts/) and screens/manifest.json.
"""
import json, os, re, sys

src, out = sys.argv[1], sys.argv[2]
html_dir = os.path.join(out, 'screens', 'html')
os.makedirs(html_dir, exist_ok=True)
canvas = json.load(open(os.path.join(src, 'canvas.json'), encoding='utf-8'))

FONTS = [('Manrope', 600, 'manrope-latin-600-normal.woff2'), ('Manrope', 700, 'manrope-latin-700-normal.woff2'),
         ('Manrope', 800, 'manrope-latin-800-normal.woff2'), ('DM Sans', 400, 'dm-sans-latin-400-normal.woff2'),
         ('DM Sans', 500, 'dm-sans-latin-500-normal.woff2'), ('DM Sans', 600, 'dm-sans-latin-600-normal.woff2'),
         ('DM Sans', 700, 'dm-sans-latin-700-normal.woff2')]
FONT_CSS = ''.join(f"@font-face{{font-family:'{f}';font-weight:{w};font-display:block;src:url('../../fonts/{p}') format('woff2');}}" for f, w, p in FONTS)


def share_cells():  # same pseudo-QR as the canvas renderVals (seeded LCG), decorative only
    n, seed = 25, 11
    def rnd():
        nonlocal seed
        seed = (seed * 9301 + 49297) % 233280
        return seed / 233280
    def finder(r, c):
        for r0, c0 in [(0, 0), (0, n - 7), (n - 7, 0)]:
            if r0 - 1 <= r <= r0 + 7 and c0 - 1 <= c <= c0 + 7:
                dr, dc = r - r0, c - c0
                if dr < 0 or dr > 6 or dc < 0 or dc > 6:
                    return False
                return max(abs(dr - 3), abs(dc - 3)) != 2
        return None
    cells = []
    for r in range(n):
        for c in range(n):
            f = finder(r, c)
            dark = (rnd() < 0.48) if f is None else f
            cells.append({'style': 'background: #18392F;' if dark else 'background: #FFFFFF;'})
    return cells


def methods(sel):
    on = 'height: 48px; border-radius: 14px; border: 2px solid #18392F; background: #18392F; color: #F7F5EF; font: 700 14px DM Sans, sans-serif;'
    off = 'height: 48px; border-radius: 14px; border: 1px solid #C8CFC5; background: #FFFFFF; color: #18392F; font: 600 14px DM Sans, sans-serif;'
    return [{'label': l, 'checked': 'true' if i == sel else 'false', 'style': on if i == sel else off}
            for i, l in [('card', 'Card'), ('zelle', 'Zelle'), ('cash', 'Cash'), ('other', 'Other')]]


def stars(n=5):
    on = 'width: 52px; height: 52px; border: 0; border-radius: 26px; background: transparent; color: #C98F66; font-size: 38px; line-height: 1;'
    off = 'width: 52px; height: 52px; border: 0; border-radius: 26px; background: transparent; color: #C8CFC5; font-size: 38px; line-height: 1;'
    return [{'label': f'{i} star' + ('' if i == 1 else 's'), 'on': 'true' if i <= n else 'false', 'style': on if i <= n else off} for i in range(1, 6)]


CTA = {'card': 'Send $135.00 pay link', 'zelle': 'Save Zelle payment', 'cash': 'Save cash payment', 'other': 'Save payment'}
# state variants per artboard, mirroring each artboard's renderVals()
VARIANTS = {
    'Onb-Photo': [('empty', {'isEmpty': True, 'isPreview': False}), ('preview', {'isEmpty': False, 'isPreview': True})],
    'App-RecordPayment': [(m, {'methods': methods(m), 'isCard': m == 'card', 'isZelle': m == 'zelle', 'isCash': m == 'cash', 'isOther': m == 'other', 'cta': CTA[m]})
                          for m in ('card', 'zelle', 'cash', 'other')],
    'App-ShareCard': [(None, {'cells': share_cells()})],
    'App-SlotLive': [('live', {'isLive': True, 'isFilled': False}), ('filled', {'isLive': False, 'isFilled': True})],
    'Pub-ClaimSlot': [('open', {'isOpen': True, 'isFilled': False}), ('just-taken', {'isOpen': False, 'isFilled': True})],
    'Pub-Review': [(None, {'stars': stars(5)})],
    'Pub-Status': [('confirmed', {'isConfirmed': True, 'isRequest': False, 'nextLine': 'Next · Thu, Nov 12 · 10:15 AM'}),
                   ('request', {'isConfirmed': False, 'isRequest': True, 'nextLine': 'Requested · Thu, Nov 12 · 1:00 PM'})],
}


SHORT = {'01': 'account', '02': 'artist-profile', '02b': 'profile-photo', '03': 'services-deposits', '04': 'work-location', '05': 'payments',
         '06': 'preview-publish', '07': 'home', '08': 'calendar', '09': 'appointment-detail', '10': 'booking-request', '11': 'clients',
         '12': 'client-profile-notes', '12b': 'client-visits', '12c': 'visit-notes', '13': 'client-import', '14': 'ai-revenue-center',
         '15': 'outreach-TABLED', '16': 'settings', '17': 'money', '18': 'get-paid', '19': 'locations-hours', '20': 'calendar-sync',
         '21': 'show-my-qr', '22': 'plan', '23': 'showcase-looks', '24': 'showcase-services', '25': 'choose-date-time', '26': 'details-deposit',
         '27': 'sign-in', '28': 'booking-status', '29': 'client-profile-card', '30': 'qr-scanned', '31': 'fill-open-slots',
         '31b': 'review-slot-campaign', '31c': 'live-campaign', '31d': 'claim-spot', '32': 'rebooking-pipeline', '33': 'win-back',
         '34': 'autopilot-rules', '35': 'autopilot-messages', '36': 'autopilot-activity', '37': 'reports', '38': 'reputation',
         '39': 'leave-review', '40': 'concierge-inbox', '41': 'conversation-thread', '42': 'quote-request', '43': 'concierge-setup',
         '44': 'running-late', '45': 'client-chat-spanish'}


def slug(title):
    num = title.split(' ', 1)[0]
    return num, SHORT[num]


# canvas file -> base id (e.g. "09-appointment-detail")
BASE = {}
for f, b in canvas['boards'].items():
    num, s = slug(b['title'])
    BASE[f[:-len('.dc.html')]] = (num, f'{num}-{s}', b['title'])


def target_for(stem):
    """Reference HTML filename a link to this artboard should point at (first variant)."""
    num, base, _ = BASE[stem]
    v = VARIANTS.get(stem, [(None, {})])[0][0]
    return f'{base}--{v}.html' if v else f'{base}.html'


def render(text, vals):
    body = text.split('<x-dc>', 1)[1].split('</x-dc>', 1)[0]
    helmet = re.search(r'<helmet>(.*?)</helmet>', body, re.S)
    styles = ''.join(re.findall(r'<style>(.*?)</style>', helmet.group(1), re.S)) if helmet else ''
    body = re.sub(r'<helmet>.*?</helmet>', '', body, flags=re.S)

    def do_for(m):
        lst, alias, tmpl = m.group(1), m.group(2), m.group(3)
        res = []
        for it in vals.get(lst, []):
            s = tmpl
            for k, v in it.items():
                s = re.sub(r'\{\{\s*' + alias + r'\.' + k + r'\s*\}\}', str(v), s)
            res.append(s)
        return ''.join(res)
    body = re.sub(r'<sc-for list="\{\{\s*(\w+)\s*\}\}" as="(\w+)"[^>]*>(.*?)</sc-for>', do_for, body, flags=re.S)
    body = re.sub(r'<sc-if value="\{\{\s*(\w+)\s*\}\}"[^>]*>(.*?)</sc-if>', lambda m: m.group(2) if vals.get(m.group(1)) else '', body, flags=re.S)
    body = re.sub(r'\s(onClick)="[^"]*"', '', body)
    body = re.sub(r'\{\{\s*(true|false)\s*\}\}', lambda m: m.group(1), body)
    body = re.sub(r'\{\{\s*(\w+)\s*\}\}', lambda m: str(vals.get(m.group(1), '')), body)
    body = re.sub(r'href="([A-Za-z-]+)\.dc\.html"', lambda m: f'href="{target_for(m.group(1))}"' if m.group(1) in BASE else m.group(0), body)
    lang = re.search(r'<html lang="([\w-]+)"', text).group(1)
    title = re.search(r'<title>(.*?)</title>', text).group(1)
    return (f'<!doctype html>\n<html lang="{lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=390">\n'
            f'<title>{title} · reference</title>\n<!-- REFERENCE ONLY. Exported from the "Mova App Screens" canvas. Build with the app\'s components; '
            f'never copy this markup or its sample data into the app. -->\n<style>{FONT_CSS}{styles}html,body{{margin:0;background:#F7F5EF}}</style>\n'
            f'</head>\n<body>{body}</body>\n</html>\n')


manifest = []
for stem, (num, base, title) in sorted(BASE.items(), key=lambda kv: canvas['order'].index(kv[0] + '.dc.html')):
    text = open(os.path.join(src, stem + '.dc.html'), encoding='utf-8').read()
    for v, vals in VARIANTS.get(stem, [(None, {})]):
        html = render(text, vals)
        if '{{' in html or '<sc-' in html:
            raise SystemExit(f'unresolved template in {stem} {v}')
        name = f'{base}--{v}' if v else base
        open(os.path.join(html_dir, name + '.html'), 'w', encoding='utf-8').write(html)
        manifest.append({'id': name, 'number': num, 'title': title, 'state': v, 'canvas_file': stem + '.dc.html',
                         'tabled': 'TABLED' in title, 'html': f'screens/html/{name}.html', 'png': f'screens/png/{name}.png'})
json.dump(manifest, open(os.path.join(out, 'screens', 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
print(len(BASE), 'artboards ->', len(manifest), 'screens incl. state variants')
