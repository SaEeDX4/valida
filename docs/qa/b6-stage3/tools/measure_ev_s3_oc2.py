"""Pixel measurements of the owner's Outlook classic screenshots of the C2+P04 REVIEW MOCKUPS (EV-S3-OC2).

usage: python3 -I measure_ev_s3_oc2.py <folder with original-screenshots/>

Reads the preserved originals only. The method is the EV-S3-OC1 method (measure_ev_s3_oc1.py), adapted to these
files, which arrived RESIZED (2048 x 863 px, RGB) rather than at screen size:

- Scale: the 600 CSS px column (the widest exact-colour run of the column colour at y 250, 300, 500 or 700) divided by 600; a value below 1 means the image was
  resampled after capture, which blends small text with its background.
- Backgrounds: the most frequent colour in each line's box inside the column (x 622-1090).
- Text lines: rows with any pixel differing from the background by more than 24 in any channel, grouped into lines.
- Text colour: the ink pixel with the highest WCAG 2.x contrast against the background ("peak"), with the 90th
  percentile ("p90").
- Each line's role is assigned from its order in the known mockup layout; its source colour (C2+P04) and, where one
  was measured in EV-S3-OC1, its previously measured Outlook light-rendering colour are attached.
- Reliability: "exact" when the peak equals the line's known ink colour (the source colour in dark rendering, the
  EV-S3-OC1 measured colour in light rendering); otherwise "blended". For a blended line the peak is reported as a
  LOWER BOUND, provided the resampling does not overshoot: the script counts, per line, pixels whose contrast exceeds
  the known ink colour's contrast ("overshoot") — a non-zero count would invalidate the lower-bound reading.
- For lines with no measured light-rendering colour (the proposed eyebrow colour #83C6FF), the peak is a lower bound
  under the same no-overshoot condition, which cannot be checked against a known ink colour for that line.
- Masthead: the band region is compared pixel for pixel between the light and dark screenshot of the same message.
"""
import json, os, sys
from collections import Counter
from PIL import Image

base = sys.argv[1]
SHOTS = {  # file, message, mode (by measured colours and the button glyph), part
    'M1': ('M1-67347845-image.png', 'ACK', 'dark', 'whole message'),
    'M2': ('M2-66d35a91-image.png', 'ACK', 'light', 'whole message'),
    'M3': ('M3-e7a21878-image.png', 'LONG', 'dark', 'top'),
    'M4': ('M4-dbf0529e-image.png', 'LONG', 'light', 'top'),
    'M5': ('M5-985e7ca7-image.png', 'LONG', 'dark', 'lower section'),
    'M6': ('M6-2d1ecfb1-image.png', 'LONG', 'light', 'lower section'),
}
SOURCE = {'logo': None, 'eyebrow': '#83C6FF', 'headline': '#F4F7FA', 'body': '#B6C0CC', 'label': '#B6C0CC',
          'value': '#F4F7FA', 'note': '#B6C0CC', 'footer': '#B6C0CC'}
LIGHT_MEASURED = {'#F4F7FA': '#2C3034', '#B6C0CC': '#5D6875'}  # EV-S3-OC1 (S2, S4, S6), measured at 1:1
ROLES = {
    ('ACK', 'whole message'): ['logo', 'eyebrow', 'headline', 'body', 'body', 'body', 'footer'],
    ('LONG', 'top'): ['logo', 'eyebrow', 'headline', 'body', 'label', 'value', 'value', 'label', 'value', 'value',
                      'label', 'value', 'label', 'value', 'note', 'note'],
    ('LONG', 'lower section'): ['eyebrow', 'headline', 'body', 'label', 'value', 'value', 'label', 'value', 'value',
                                'label', 'value', 'label', 'value', 'note', 'note', 'footer'],
}
SIZE = {'logo': 'image', 'eyebrow': '12 px, 500', 'headline': '32 px, 600 (large)', 'body': '16 px', 'label': '12 px',
        'value': '15 px', 'note': '14 px', 'footer': '13 px'}


def lin(v):
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def lum(c):
    r, g, b = (lin(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def cr(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


hx = lambda c: '#%02X%02X%02X' % tuple(c)
rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
far = lambda p, q: max(abs(a - b) for a, b in zip(p, q)) > 24
images = {k: Image.open(os.path.join(base, 'original-screenshots', v[0])).convert('RGB') for k, v in SHOTS.items()}
report = {'method': 'see the module docstring of tools/measure_ev_s3_oc2.py', 'shots': {}}

for key, (name, message, mode, part) in SHOTS.items():
    im = images[key]
    W, H = im.size
    entry = {'file': name, 'message': message, 'mode': mode, 'part': part, 'size': [W, H], 'runs_exact': {}}
    for y in (250, 300, 500, 700, 800):
        row = [im.getpixel((x, y)) for x in range(W)]
        runs, start = [], 0
        for x in range(1, W + 1):
            if x == W or row[x] != row[start]:
                if x - start >= 30:
                    runs.append([start, x - 1, hx(row[start])])
                start = x
        entry['runs_exact'][y] = runs
    # The column: the widest exact-colour run of the column colour on any of the sampled rows (a row crossing text
    # is broken into shorter runs, so the widest run is the clean one).
    column = [r for y in (250, 300, 500, 700) for r in entry['runs_exact'][y] if r[2] in ('#080C11', '#E9EBEF')]
    col = max(column, key=lambda r: r[1] - r[0])
    entry['column_px'] = [col[0], col[1], col[1] - col[0] + 1]
    entry['scale'] = round((col[1] - col[0] + 1) / 600, 4)
    x0, x1 = col[0] + 5, col[1] - 4
    inked = []
    for y in range(195, H - 50):
        px = [im.getpixel((x, y)) for x in range(x0, x1)]
        bg = Counter(px).most_common(1)[0][0]
        inked.append(y if any(far(p, bg) for p in px) else None)
    groups, cur = [], None
    for y in inked:
        if y is None:
            cur = None
            continue
        if cur and y == cur[1] + 1:
            cur[1] = y
        else:
            cur = [y, y]
            groups.append(cur)
    groups = [g for g in groups if g[1] - g[0] >= 2]
    roles = ROLES[(message, part)]
    assert len(groups) == len(roles), (key, len(groups), len(roles))
    lines = []
    for (g0, g1), role in zip(groups, roles):
        box = [(x, y) for y in range(g0, g1 + 1) for x in range(x0, x1)]
        px = [im.getpixel(p) for p in box]
        bg = Counter(px).most_common(1)[0][0]
        ink = [p for p in px if far(p, bg)]
        contrasts = sorted(cr(p, bg) for p in ink)
        peak = max(ink, key=lambda p: cr(p, bg))
        xs = [x for (x, y), p in zip(box, px) if far(p, bg)]
        line = {'role': role, 'size': SIZE[role], 'y': [g0, g1], 'x': [min(xs), max(xs)], 'bg': hx(bg), 'peak_ink': hx(peak),
                'peak_contrast': round(contrasts[-1], 2), 'p90_contrast': round(contrasts[int(len(contrasts) * 0.9)], 2),
                'ink_pixels': len(ink)}
        src = SOURCE[role]
        if src:
            known = src if mode == 'dark' else LIGHT_MEASURED.get(src)
            line['source'] = src
            line['known_ink'] = known
            if known:
                kc = cr(rgb(known), bg)
                line['known_ink_contrast'] = round(kc, 2)
                line['overshoot_pixels'] = sum(1 for c in contrasts if c > kc + 1e-9)
                line['reliability'] = 'exact' if hx(peak) == known else 'blended (peak = lower bound)'
            else:
                line['reliability'] = 'no measured ink colour for this source colour; peak = lower bound if no overshoot'
        lines.append(line)
    entry['lines'] = lines
    report['shots'][key] = entry

# Masthead band: the same pixels in light and dark?
band = {}
for light, dark in (('M2', 'M1'), ('M4', 'M3')):
    c = report['shots'][light]['column_px']
    box = (c[0], 215, c[1] + 1, 285)
    band[f'{light} vs {dark}'] = {'box': list(box), 'identical': images[light].crop(box).tobytes() == images[dark].crop(box).tobytes()}
# Band extent in the light screenshots: rows where >= 90 % of the column is #05070A or the logo.
for key in ('M2', 'M4'):
    im, c = images[key], report['shots'][key]['column_px']
    rows = [y for y in range(150, 420) if sum(1 for x in range(c[0], c[1] + 1) if im.getpixel((x, y)) == (5, 7, 10)) >= 0.6 * (c[1] - c[0] + 1)]
    band[f'{key} band rows (>= 60 % #05070A across the column)'] = [min(rows), max(rows), max(rows) - min(rows) + 1]
report['masthead'] = band
print(json.dumps(report, indent=1))
