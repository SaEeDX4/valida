import json, sys
from playwright.sync_api import sync_playwright
Q = '/home/claude/recovery/valida/docs/qa/b6-stage2/'
F, P = Q + 'fixtures/', Q + 'previews/'
FALLBACK = "<style>*{font-family:Arial,Helvetica,sans-serif !important}</style>"
shots = [
  # (output name, source html, viewport width, dpr, options)
  ('as-built-internal-desktop-680', F + 'SYNTHETIC-internal.html', 680, 1, {}),
  ('as-built-internal-mobile-390', F + 'SYNTHETIC-internal.html', 390, 2, {}),
  ('as-built-internal-mobile-320', F + 'SYNTHETIC-internal.html', 320, 2, {}),
  ('as-built-acknowledgement-desktop-680', F + 'SYNTHETIC-acknowledgement.html', 680, 1, {}),
  ('as-built-acknowledgement-mobile-390', F + 'SYNTHETIC-acknowledgement.html', 390, 2, {}),
  ('as-built-acknowledgement-mobile-320', F + 'SYNTHETIC-acknowledgement.html', 320, 2, {}),
  ('as-built-internal-long-values-mobile-320', F + 'SYNTHETIC-internal-long-values.html', 320, 2, {}),
  ('as-built-internal-long-values-desktop-680', F + 'SYNTHETIC-internal-long-values.html', 680, 1, {}),
  ('as-built-internal-fallback-font-desktop-680', F + 'SYNTHETIC-internal.html', 680, 1, {'fallback': True}),
  ('PREVIEW-ONLY-candidate-logo-internal-desktop-680', P + 'PREVIEW-ONLY-with-candidate-logo-internal.html', 680, 2, {}),
  ('PREVIEW-ONLY-candidate-logo-acknowledgement-desktop-680', P + 'PREVIEW-ONLY-with-candidate-logo-acknowledgement.html', 680, 2, {}),
  ('PREVIEW-ONLY-candidate-logo-acknowledgement-mobile-390', P + 'PREVIEW-ONLY-with-candidate-logo-acknowledgement.html', 390, 2, {}),
  ('PREVIEW-ONLY-candidate-logo-internal-mobile-320', P + 'PREVIEW-ONLY-with-candidate-logo-internal.html', 320, 2, {}),
  ('PREVIEW-ONLY-candidate-logo-acknowledgement-images-blocked-680', P + 'PREVIEW-ONLY-with-candidate-logo-acknowledgement.html', 680, 2, {'block_images': True}),
]
results = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, src, width, dpr, opt in shots:
        context = browser.new_context(viewport={'width': width, 'height': 800}, device_scale_factor=dpr)
        page = context.new_page()
        if opt.get('block_images'):
            page.route('**/*.png', lambda route: route.abort())
        page.goto('file://' + src)
        if opt.get('fallback'):
            page.add_style_tag(content='*{font-family:Arial,Helvetica,sans-serif !important}')
        metrics = page.evaluate("""() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
            height: document.documentElement.scrollHeight,
            fonts: [...new Set([...document.querySelectorAll('h1,p')].map(e => getComputedStyle(e).fontFamily.split(',')[0]))],
            imagesShown: [...document.images].map(i => ({ w: i.width, h: i.height, loaded: i.complete && i.naturalWidth > 0, alt: i.alt })) })""")
        page.screenshot(path=f'{P}{name}.png', full_page=True)
        results.append({'file': f'{name}.png', 'source': src.replace(Q, ''), 'viewport': width, 'deviceScaleFactor': dpr, **opt,
                        'horizontalOverflow': metrics['scrollWidth'] > metrics['clientWidth'], **metrics})
        context.close()
    version = browser.version
    browser.close()
json.dump({'renderer': f'Chromium {version} (Playwright, headless) — BROWSER PREVIEW, NOT EMAIL-CLIENT EVIDENCE',
           'fonts_note': 'Inter is installed on this machine, so the as-built previews show Inter; most email clients do not have it and fall back to Segoe UI / Arial (see the fallback-font simulation).',
           'shots': results}, open(P + 'previews-index.json', 'w'), indent=2)
for r in results: print(f"{r['file']:<66} overflow={r['horizontalOverflow']} scrollW={r['scrollWidth']}/{r['clientWidth']} h={r['height']} fonts={r['fonts']} imgs={r['imagesShown']}")
print(version)
