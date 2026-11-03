"""Browser previews of the INTEGRATED build — Chromium (Playwright), NOT an email client.

usage: python3 make_previews_integrated.py <docs/qa/b6-stage2 dir>

Sources: previews/as-built-*.from-eml.html (the HTML part of each synthetic EML, the logo shown from the EML's own
image part) and, for the images-not-loaded shot, fixtures/SYNTHETIC-*.html (its cid: reference cannot resolve in a
browser, so the image does not load and its alt text is what remains).
"""
import json, os, sys
from playwright.sync_api import sync_playwright

Q = os.path.abspath(sys.argv[1]) + '/'
P, F = Q + 'previews/', Q + 'fixtures/'
shots = [
    ('as-built-internal-desktop-680', P + 'as-built-internal.from-eml.html', 680, 2, {}),
    ('as-built-internal-mobile-390', P + 'as-built-internal.from-eml.html', 390, 2, {}),
    ('as-built-internal-mobile-320', P + 'as-built-internal.from-eml.html', 320, 2, {}),
    ('as-built-acknowledgement-desktop-680', P + 'as-built-acknowledgement.from-eml.html', 680, 2, {}),
    ('as-built-acknowledgement-mobile-390', P + 'as-built-acknowledgement.from-eml.html', 390, 2, {}),
    ('as-built-acknowledgement-mobile-320', P + 'as-built-acknowledgement.from-eml.html', 320, 2, {}),
    ('as-built-internal-long-values-desktop-680', P + 'as-built-internal-long-values.from-eml.html', 680, 2, {}),
    ('as-built-internal-long-values-mobile-320', P + 'as-built-internal-long-values.from-eml.html', 320, 2, {}),
    ('as-built-internal-fallback-font-desktop-680', P + 'as-built-internal.from-eml.html', 680, 2, {'fallback': True}),
    ('as-built-acknowledgement-images-not-loaded-680', F + 'SYNTHETIC-acknowledgement.html', 680, 2, {'images_not_loaded': True}),
]
results = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, src, width, dpr, opt in shots:
        context = browser.new_context(viewport={'width': width, 'height': 800}, device_scale_factor=dpr)
        page = context.new_page()
        page.goto('file://' + src)
        if opt.get('fallback'):
            page.add_style_tag(content='*{font-family:Arial,Helvetica,sans-serif !important}')
        page.wait_for_load_state('load')
        metrics = page.evaluate("""() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
            height: document.documentElement.scrollHeight,
            fonts: [...new Set([...document.querySelectorAll('h1,p')].map(e => getComputedStyle(e).fontFamily.split(',')[0]))],
            images: [...document.images].map(i => ({ w: i.width, h: i.height, loaded: i.complete && i.naturalWidth > 0, natural: [i.naturalWidth, i.naturalHeight], alt: i.alt, srcScheme: i.getAttribute('src').split(':')[0] })),
            careersLabelVisible: [...document.querySelectorAll('.v-label')].some(e => getComputedStyle(e).display !== 'none') })""")
        page.screenshot(path=f'{P}{name}.png', full_page=True)
        results.append({'file': f'{name}.png', 'source': src.replace(Q, ''), 'viewport': width, 'deviceScaleFactor': dpr, **opt,
                        'horizontalOverflow': metrics['scrollWidth'] > metrics['clientWidth'], **metrics})
        context.close()
    version = browser.version
    browser.close()
json.dump({'renderer': f'Chromium {version} (Playwright, headless) — BROWSER PREVIEW, NOT EMAIL-CLIENT EVIDENCE',
           'build': 'integrated (approved logo, OD-2026-10-27-01)',
           'fonts_note': 'Inter is installed on this machine, so these previews show Inter; Space Grotesk is not installed and is not delivered (no web fonts). Most email clients fall back to Segoe UI / Arial (see the fallback-font simulation).',
           'shots': results}, open(P + 'previews-index.json', 'w'), indent=2)
for r in results:
    print(f"{r['file']:<52} overflow={r['horizontalOverflow']} {r['scrollWidth']}/{r['clientWidth']} h={r['height']} fonts={r['fonts']} imgs={[(i['w'], i['h'], i['loaded'], i['srcScheme']) for i in r['images']]} careers={r['careersLabelVisible']}")
print(version)
