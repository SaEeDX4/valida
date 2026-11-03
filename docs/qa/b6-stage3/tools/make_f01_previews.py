"""F-01 / F-04 review previews — PROPOSED, browser mockups only (Chromium), NOT Outlook output.

usage: python3 make_f01_previews.py <repo root>

Inputs: the integrated synthetic fixtures (docs/qa/b6-stage2/fixtures/SYNTHETIC-*.html) and the candidate
assets made by make_f01_candidates.py. Outputs go to docs/qa/b6-stage3/proposals/f01-logo/previews/.

Two colour treatments per variant:
  source     the template's own colours (what Outlook classic showed, pixel for pixel, in its dark rendering)
  ol-light   a SIMULATION of Outlook classic's light rendering: every template colour replaced by the colour
             Outlook classic actually produced for it in the owner's screenshots (EV-S3-OC1, measured);
             images are left unchanged, as Outlook left them. A colour that has no measurement (only #83C6FF,
             a proposed colour) uses a PREDICTED value from a lightness-inversion fit and is labelled so.
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

root = os.path.abspath(sys.argv[1])
FIX = os.path.join(root, 'docs/qa/b6-stage2/fixtures')
OUT = os.path.join(root, 'docs/qa/b6-stage3/proposals/f01-logo/previews')
os.makedirs(OUT, exist_ok=True)

MEASURED = {  # source colour -> Outlook classic light rendering, measured in EV-S3-OC1 (S2, S4, S6)
    '#05070A': '#ECEEF0', '#080C11': '#E9EBEF', '#F4F7FA': '#2C3034', '#B6C0CC': '#5D6875',
    '#7E8997': '#8D97A5', '#66B3FF': '#007CC5', '#1E242B': '#DADEE3', '#328FFF': '#3490FF',
}
PREDICTED = {'#83C6FF': '#00689D'}  # PREDICTED, not measured (see the findings document, F-04)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from f01_variants import apply  # the same markup as the offline review EMLs (make_review_emls.py)

IMAGES = {'C0': 'C0-current-316x72.png', 'C1': 'C1-transparent-lockup-316x72.png',
          'C2': 'C2-masthead-1200x216.png', 'C3': 'C3-plate-412x144.png'}


def build(name, variant, p04):
    html = open(os.path.join(FIX, f'SYNTHETIC-{name}.html'), encoding='utf-8').read()
    return apply(html, variant, p04, image_src=f'../{IMAGES[variant]}')


def light(html):
    table = {**MEASURED, **PREDICTED}
    return re.sub(r'#[0-9A-Fa-f]{6}\b', lambda m: table.get(m.group(0).upper(), m.group(0)), html)


shots = []
cases = [('acknowledgement', v, False) for v in ('C0', 'C1', 'C2', 'C3')] + [('internal', 'C2', True), ('internal', 'C0', False)]
with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, variant, p04 in cases:
        base = build(name, variant, p04)
        for mode, html in (('source', base), ('ol-light', light(base))):
            stem = f'{name}-{variant}{"-P04" if p04 else ""}-{mode}'
            path = os.path.join(OUT, f'{stem}.html')
            open(path, 'w', encoding='utf-8').write(html)
            for width in ((680, 390, 320) if name == 'acknowledgement' and variant in ('C2', 'C3') else (680,)):
                ctx = browser.new_context(viewport={'width': width, 'height': 700}, device_scale_factor=2)
                page = ctx.new_page()
                page.goto('file://' + path)
                page.wait_for_load_state('load')
                png = os.path.join(OUT, f'{stem}-{width}.png')
                page.screenshot(path=png, full_page=True)
                info = page.evaluate("() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, images: [...document.images].map(i => [i.width, i.height, i.complete && i.naturalWidth > 0]) })")
                shots.append({'file': os.path.basename(png), 'fixture': name, 'variant': variant, 'p04': p04, 'treatment': mode, 'viewport': width, **info})
                ctx.close()
    version = browser.version
    browser.close()
json.dump({'renderer': f'Chromium {version} (Playwright) — BROWSER MOCKUP, NOT OUTLOOK, NOT EMAIL-CLIENT EVIDENCE',
           'ol_light': 'simulation by colour substitution measured from EV-S3-OC1; #83C6FF is PREDICTED', 'status': 'PROPOSED',
           'measured_map': MEASURED, 'predicted_map': PREDICTED, 'shots': shots}, open(os.path.join(OUT, 'previews-index.json'), 'w'), indent=2)
for s in shots:
    print(s['file'], s['overflow'], s['images'])
