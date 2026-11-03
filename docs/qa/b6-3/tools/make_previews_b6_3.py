"""Development previews of the b6-3 build — Chromium (Playwright). NOT an email client; NOT Outlook; NOT a phone.

usage: python3 -I make_previews_b6_3.py <docs/qa/b6-3 dir> <docs/qa/b6-stage2 dir>

Sources (all generated from the REAL runtime templates and adapter by make_fixtures_b6_3.mjs):
  previews/as-built-<msg>.from-eml.html   the HTML part of each synthetic EML, the image shown from the EML's own
                                           image part (data: URI) — the bytes the message carries
  fixtures/SYNTHETIC-<msg>.html            the same HTML with its cid: reference, which a browser cannot resolve:
                                           used for the IMAGES-NOT-LOADED simulation (the alt text is what remains)

Scenarios (each is a browser APPROXIMATION and is labelled as such in previews-index.json):
  width         viewport widths 280 (stress), 320, 360, 390, 430, 600, 680, 1024, 1440 CSS px
  page-zoom     whole-page zoom emulated as a narrower viewport at a higher device scale: a 1280 px window at 200 %
                (640 CSS px), an 800 px window at 200 % (400), a 600 px window at 200 % (300), 1280 at 400 % (320)
  text-200      text-only enlargement emulated by doubling every computed font size and line height (layout widths
                unchanged) at 680 and 390 CSS px
  images-off    the cid: HTML (image cannot load) at 680 and 390 CSS px
  ol-light      Outlook classic LIGHT rendering SIMULATED by colour substitution, using only colours MEASURED in the
                owner's Outlook screenshots (EV-S3-OC1, EV-S3-OC3); images unchanged, as Outlook left them
  fallback-font Arial everywhere (a client without Inter / Segoe UI)
  mso-markup    the Outlook-only conditional markup UNCOMMENTED so that a BROWSER lays out the wrapper table — shows
                the intent of the b6-3 wrapper, and the b6-2 fixed wrapper for comparison. Word's table layout may
                differ: this is NOT Outlook evidence.
Metrics per shot: horizontal overflow, content beyond the right edge, image size and aspect ratio, image loaded,
smallest computed font size, lowest computed text contrast (WCAG 2.x, text colour against the nearest painted
background), column width, approximate characters per body line, whether the privacy note and footer are present.
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

Q = os.path.abspath(sys.argv[1]) + '/'
S2 = os.path.abspath(sys.argv[2]) + '/'
P, F = Q + 'previews/', Q + 'fixtures/'
OUT = P + 'shots/'
os.makedirs(OUT, exist_ok=True)
MSGS = ['acknowledgement', 'acknowledgement-long-values', 'internal', 'internal-long-values']
# Measured Outlook classic light-rendering colours (source -> rendered); see the EV-S3-OC1 / EV-S3-OC3 measurements.
MEASURED_LIGHT = {'#05070A': '#ECEEF0', '#080C11': '#E9EBEF', '#F4F7FA': '#2C3034', '#B6C0CC': '#5D6875',
                  '#83C6FF': '#006DA5', '#1E242B': '#DADEE3', '#328FFF': '#3490FF'}

METRICS_JS = r"""() => {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 4).map(Number);
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0)) return c.slice(0, 3); const a = e.getAttribute && e.getAttribute('bgcolor'); if (a) return [1, 3, 5].map((i) => parseInt(a.substr(i, 2), 16)); } return [255, 255, 255]; };
  const doc = document.documentElement, vw = doc.clientWidth;
  const texts = [...document.querySelectorAll('h1, p')].filter((e) => e.offsetParent !== null && e.textContent.trim());
  const beyond = texts.filter((e) => e.getBoundingClientRect().right > vw + 0.5).map((e) => e.textContent.trim().slice(0, 40));
  const contrasts = texts.map((e) => ({ t: e.textContent.trim().slice(0, 30), r: ratio(rgb(getComputedStyle(e).color), bgOf(e)), px: parseFloat(getComputedStyle(e).fontSize) }));
  const img = document.images[0];
  const column = document.querySelector('table[style*="max-width:600px"]');
  const body = [...document.querySelectorAll('p')].find((e) => /contact you using the details|recorded in Valida/.test(e.textContent));
  let cpl = null;
  if (body) { const r = document.createRange(); r.selectNodeContents(body); const rects = [...r.getClientRects()]; const w = Math.max(...rects.map((x) => x.width)); const ctx = document.createElement('canvas').getContext('2d'); const cs = getComputedStyle(body); ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; cpl = Math.round(w / (ctx.measureText(body.textContent).width / body.textContent.length)); }
  return {
    viewport: vw, scrollWidth: doc.scrollWidth, horizontalOverflow: doc.scrollWidth > vw, textBeyondRightEdge: beyond,
    image: img ? { w: img.width, h: img.height, ratio: img.height ? +(img.width / img.height).toFixed(3) : null, loaded: img.complete && img.naturalWidth > 0, natural: [img.naturalWidth, img.naturalHeight], alt: img.alt } : null,
    smallestFontPx: Math.min(...contrasts.map((c) => c.px)), lowestContrast: contrasts.reduce((a, c) => (c.r < a.r ? c : a), { r: 99 }),
    columnWidth: column ? Math.round(column.getBoundingClientRect().width) : null, approxCharsPerBodyLine: cpl,
    privacyNotePresent: texts.some((e) => /stored privately/.test(e.textContent)),
    footerPresent: texts.some((e) => /^Valida (Careers|· Recruitment operations)$/.test(e.textContent.trim())),
    careersLabelPresent: texts.some((e) => e.textContent.trim() === 'CAREERS'),
    altTextVisible: img ? !(img.complete && img.naturalWidth > 0) : null,
  };
}"""

TEXT_200 = """() => { for (const e of document.querySelectorAll('h1, p')) { const cs = getComputedStyle(e);
  e.style.setProperty('font-size', (parseFloat(cs.fontSize) * 2) + 'px', 'important');
  if (cs.lineHeight.endsWith('px')) e.style.setProperty('line-height', (parseFloat(cs.lineHeight) * 2) + 'px', 'important'); } }"""


def light(html):
    return re.sub(r'#[0-9A-Fa-f]{6}\b', lambda m: MEASURED_LIGHT.get(m.group(0).upper(), m.group(0)), html)


def mso_uncommented(html):
    html = re.sub(r'<!--\[if mso\]><style>.*?</style><!\[endif\]-->', '', html, flags=re.S)
    return re.sub(r'<!--\[if mso\]>(.*?)<!\[endif\]-->', r'\1', html, flags=re.S)


derived = {}
for m in MSGS:
    src = open(P + f'as-built-{m}.from-eml.html', encoding='utf-8').read()
    derived[(m, 'ol-light')] = light(src)
    derived[(m, 'mso-b6-3')] = mso_uncommented(src)
b62 = open(S2 + 'previews/as-built-internal-long-values.from-eml.html', encoding='utf-8').read()
derived[('internal-long-values', 'mso-b6-2-for-comparison')] = mso_uncommented(b62)
for (m, kind), html in derived.items():
    open(P + f'derived-{kind}-{m}.html', 'w', encoding='utf-8').write(html)

shots = []
for m in MSGS:
    for w in (280, 320, 360, 390, 430, 600, 680, 1024, 1440):
        shots.append((f'{m}-width-{w}', P + f'as-built-{m}.from-eml.html', w, 2, 'width', {}))
    for name, w, dpr in (('page-zoom-200-window-1280', 640, 4), ('page-zoom-200-window-800', 400, 4), ('page-zoom-200-window-600', 300, 4), ('page-zoom-400-window-1280', 320, 8)):
        shots.append((f'{m}-{name}', P + f'as-built-{m}.from-eml.html', w, dpr, 'page-zoom', {}))
    for w in (680, 390):
        shots.append((f'{m}-text-200-width-{w}', P + f'as-built-{m}.from-eml.html', w, 2, 'text-200', {'text200': True}))
        shots.append((f'{m}-images-off-width-{w}', F + f'SYNTHETIC-{m}.html', w, 2, 'images-off', {}))
    shots.append((f'{m}-ol-light-width-680', P + f'derived-ol-light-{m}.html', 680, 2, 'ol-light', {}))
    for w in (1440, 680, 400):
        shots.append((f'{m}-mso-markup-b6-3-width-{w}', P + f'derived-mso-b6-3-{m}.html', w, 2, 'mso-markup', {}))
shots.append(('internal-fallback-font-width-680', P + 'as-built-internal.from-eml.html', 680, 2, 'fallback-font', {'fallback': True}))
for w in (1440, 680, 400):
    shots.append((f'internal-long-values-mso-markup-b6-2-for-comparison-width-{w}', P + 'derived-mso-b6-2-for-comparison-internal-long-values.html', w, 2, 'mso-markup (b6-2, comparison)', {}))

SAVE_PNG = re.compile(r'^(acknowledgement|internal-long-values)-(width-(280|320|390|680|1440)|page-zoom-200-window-800|page-zoom-400-window-1280|text-200-width-390|images-off-width-680|ol-light-width-680|mso-markup-b6-3-width-(1440|400))$|mso-markup-b6-2|fallback-font')
results = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, src, width, dpr, kind, opt in shots:
        ctx = browser.new_context(viewport={'width': width, 'height': 900}, device_scale_factor=dpr)
        page = ctx.new_page()
        page.goto('file://' + src)
        page.wait_for_load_state('load')
        if opt.get('fallback'):
            page.add_style_tag(content='*{font-family:Arial,Helvetica,sans-serif !important}')
        if opt.get('text200'):
            page.evaluate(TEXT_200)
        metrics = page.evaluate(METRICS_JS)
        png = None
        if SAVE_PNG.search(name):
            png = f'shots/{name}.png'
            page.screenshot(path=P + png, full_page=True, scale='css' if dpr > 2 else 'device')
        results.append({'name': name, 'scenario': kind, 'source': os.path.relpath(src, Q), 'viewport_css_px': width, 'device_scale_factor': dpr, 'png': png, **metrics})
        ctx.close()
    version = browser.version
    browser.close()
json.dump({'renderer': f'Chromium {version} (Playwright, headless) — DEVELOPMENT PREVIEW: not an email client, not Outlook, not a phone',
           'labels': {'page-zoom': 'whole-page zoom EMULATED (narrower viewport, higher device scale) in a browser',
                      'text-200': 'text-only enlargement EMULATED by doubling computed font sizes and line heights',
                      'images-off': 'image NOT LOADED (cid: cannot resolve in a browser) — simulation of blocked images',
                      'ol-light': 'Outlook classic light rendering SIMULATED with measured colours (EV-S3-OC1, EV-S3-OC3)',
                      'mso-markup': 'Outlook-only markup uncommented and laid out by a BROWSER — not Word, not Outlook'},
           'shots': results}, open(P + 'previews-index.json', 'w'), indent=1)
for r in results:
    print(f"{r['name']:<62} vw{r['viewport']:>5} overflow={str(r['horizontalOverflow']):<5} beyond={len(r['textBeyondRightEdge'])} img={r['image'] and (r['image']['w'], r['image']['h'], r['image']['loaded'])} minFont={r['smallestFontPx']} minCR={round(r['lowestContrast']['r'],2)} col={r['columnWidth']} cpl={r['approxCharsPerBodyLine']} note={r['privacyNotePresent']} footer={r['footerPresent']} CAREERS={r['careersLabelPresent']}")
