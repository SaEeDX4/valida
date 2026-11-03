"""F-03 constraint model (r7) — a BROWSER model of three DOCUMENTED Outlook classic rules. NOT Word, NOT Outlook.

usage: python3 -I word_constraint_model.py <docs/qa/b6-3 dir>

Why: the r6 `mso-markup` previews laid out the Outlook-only wrapper in Chromium, which also applies the image's CSS
`width:100%; max-width:600px`. Outlook classic does not apply CSS width to <img> elements, so those previews let the
masthead shrink where Outlook would not. This model removes exactly the behaviour Outlook classic is documented not
to have, and nothing else:

  R1  CSS `width` / `max-width` / `height` on <img> are dropped; the image is laid out at its width/height
      ATTRIBUTES (600 x 108). Source: caniemail "width property" — Outlook for Windows 2007–2019: "Partial. Not
      supported on <body>, <span>, <div>, <p> or <img> elements."
  R2  `max-width` is dropped everywhere. Source: Outlook for Windows does not honour max-width (spec §6.1; Badsender,
      "Outlook email display problems", 2024). (caniemail "width attribute" adds that a PERCENTAGE width attribute
      on <img> resolves against the image file's own width — 1,200 px here — so a percentage is no way out; not
      modelled because the templates use pixel attributes.)
  R3  the Outlook-only conditional markup (<!--[if mso]> … <![endif]-->) is applied; the Outlook-only font rule is
      ignored (fonts do not change widths enough to matter here).

NOT modelled: Word's own table-layout algorithm (whether it shrinks a 600 px preferred-width cell), Outlook's margins,
DPI scaling, zoom implementation, media-query evaluation in Word (caniemail lists @media as supported in Outlook for
Windows 2007–2019; the template's <=480 px rule only changes gutters and the headline size). The model can therefore
show only what the documented IMAGE rule implies; it cannot show that Word behaves this way.

Variants (each with R1 applied, and once without R1 = what the r6 previews did):
  b6-3        the runtime wrapper (R-03-C): 100 % table, empty side cells, 600 px middle cell
  fixed-600   the b6-2 / review-mockup wrapper: a 600 px table
  fluid-100   R-03-B: a 100 % table with no 600 px cell
Widths (CSS px): 1440 desktop; 680; 610 (about 600 + Outlook's margins); 510 (the owner's narrow window at 200 %:
1,019 device px / 2, EV-S3-OC4 Z1); 400; 320 (Doc 16 §39 reflow width).
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

Q = os.path.abspath(sys.argv[1]) + '/'
P = Q + 'previews/'
OUT = P + 'word-model/'
os.makedirs(OUT, exist_ok=True)

OPEN_B63 = '<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td></td><td width="600" style="width:600px;"><![endif]-->'
CLOSE_B63 = '<!--[if mso]></td><td></td></tr></table><![endif]-->'
WRAPPERS = {
    'b6-3': (OPEN_B63, CLOSE_B63),
    'fixed-600': ('<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
                  '<!--[if mso]></td></tr></table><![endif]-->'),
    'fluid-100': ('<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
                  '<!--[if mso]></td></tr></table><![endif]-->'),
}


def apply_mso(html):
    html = re.sub(r'<!--\[if mso\]><style>.*?</style><!\[endif\]-->', '', html, flags=re.S)
    return re.sub(r'<!--\[if mso\]>(.*?)<!\[endif\]-->', r'\1', html, flags=re.S)


def drop_img_css_size(html):
    def fix(m):
        tag = m.group(0)
        return re.sub(r'style="([^"]*)"', lambda s: 'style="' + re.sub(r'(?:^|;)\s*(?:max-)?(?:width|height)\s*:[^;]*', '', s.group(1)).lstrip(';') + '"', tag)
    return re.sub(r'<img\b[^>]*>', fix, html)


def drop_max_width(html):
    return re.sub(r'max-width\s*:\s*[^;"]*;?', '', html)


METRICS_JS = r"""() => {
  const doc = document.documentElement, vw = doc.clientWidth;
  const texts = [...document.querySelectorAll('h1, p')].filter((e) => e.offsetParent !== null && e.textContent.trim());
  // the right end of the laid-out LINES of text (not the block box, which spans the column even for short text)
  const inkRight = (e) => { const r = document.createRange(); r.selectNodeContents(e); return Math.max(...[...r.getClientRects()].map((x) => x.right)); };
  const beyond = texts.filter((e) => inkRight(e) > vw + 0.5).map((e) => e.textContent.trim().slice(0, 48));
  const img = document.images[0];
  const h1 = document.querySelector('h1');
  return { viewport: vw, scrollWidth: doc.scrollWidth, overflowPx: Math.max(0, doc.scrollWidth - vw),
           imageWidth: img ? img.getBoundingClientRect().width : null,
           headlineRight: h1 ? Math.round(h1.getBoundingClientRect().right) : null,
           textBlocks: texts.length, textBlocksBeyondRightEdge: beyond.length, beyond };
}"""

if __name__ == '__main__':
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for msg in ('internal-long-values', 'acknowledgement'):
            src = open(P + f'as-built-{msg}.from-eml.html', encoding='utf-8').read()
            assert OPEN_B63 in src and CLOSE_B63 in src, 'b6-3 wrapper not found in the as-built HTML'
            for variant, (o, c) in WRAPPERS.items():
                html = src.replace(OPEN_B63, o).replace(CLOSE_B63, c)
                for model in ('outlook-rules', 'browser-image-scaling'):
                    h = apply_mso(html)
                    h = drop_max_width(h)
                    if model == 'outlook-rules':
                        h = drop_img_css_size(h)
                    path = OUT + f'{msg}-{variant}-{model}.html'
                    open(path, 'w', encoding='utf-8').write(h)
                    for w in (1440, 680, 610, 510, 400, 320):
                        ctx = browser.new_context(viewport={'width': w, 'height': 900}, device_scale_factor=1)
                        page = ctx.new_page()
                        page.goto('file://' + path)
                        page.wait_for_load_state('load')
                        m = page.evaluate(METRICS_JS)
                        png = None
                        if msg == 'internal-long-values' and variant == 'b6-3' and w == 510:
                            png = f'word-model/{msg}-{variant}-{model}-width-{w}.png'
                            page.screenshot(path=P + png, full_page=True)
                        results.append({'message': msg, 'wrapper': variant, 'model': model, 'width_css_px': w, 'png': png, **m})
                        ctx.close()
        version = browser.version
        browser.close()
    json.dump({'renderer': f'Chromium {version} (Playwright, headless) — a MODEL of documented Outlook classic rules R1–R3; NOT Word, NOT Outlook, NOT client evidence',
               'rules': {'R1': 'CSS width/max-width/height dropped on <img>; laid out at its width/height attributes (caniemail: width property not supported on <img> in Outlook for Windows 2007–2019)',
                         'R2': 'max-width dropped everywhere (not honoured by Outlook for Windows)',
                         'R3': 'Outlook-only conditional markup applied'},
               'models': {'outlook-rules': 'R1 + R2 + R3', 'browser-image-scaling': 'R2 + R3 only — the image may shrink, as in the r6 mso-markup previews'},
               'results': results}, open(P + 'word-model-index.json', 'w'), indent=1)
    print('Chromium', version, '- model of documented Outlook classic rules; NOT Word, NOT Outlook')
    print(f"{'message':<22}{'wrapper':<11}{'model':<23}{'width':>6}{'scrollW':>9}{'overflow':>9}{'img':>6}{'beyond':>8}")
    for r in results:
        print(f"{r['message']:<22}{r['wrapper']:<11}{r['model']:<23}{r['width_css_px']:>6}{r['scrollWidth']:>9}{r['overflowPx']:>9}{round(r['imageWidth'] or 0):>6}{r['textBlocksBeyondRightEdge']:>5}/{r['textBlocks']}")
