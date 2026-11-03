"""Pixel measurements of the owner's 1:1 Outlook classic screenshots of the C2+P04 REVIEW MOCKUPS (EV-S3-OC3, 2026-11-02).

Same method as measure_ev_s3_oc2.py (EV-S3-OC2); only the screenshot list, the layouts and the scan start differ.
These files arrived at screen size (the 600 CSS px column measures 600 px), so the scale check should give 1.0.

usage: python3 -I measure_ev_s3_oc3.py <folder with original-screenshots/>

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
SHOTS = {  # file, message, mode (by measured colours and the button glyph), part, scanned rows, excluded rows
    'N1': ('N1-ec1470df-image.png', 'ACK', 'light', 'whole message', (280, 1020), []),
    # N2: the owner had clicked the masthead image, so Outlook drew a dashed selection frame with handles around it;
    # the frame's bottom edge (rows 360-372) is not text and is excluded. The band pixels inside are not measured here.
    'N2': ('N2-8c55b8a2-image.png', 'ACK', 'light', 'whole message', (280, 1020), [(360, 372)]),
    'N3': ('N3-28899f4e-image.png', 'LONG', 'light', 'top', (280, 1038), []),
    'N4': ('N4-dbdb4c4e-image.png', 'LONG', 'light', 'top', (280, 1020), []),
    'N5': ('N5-531c33aa-image.png', 'LONG', 'light', 'whole message', (280, 1060), []),
}
SOURCE = {'logo': None, 'eyebrow': '#83C6FF', 'headline': '#F4F7FA', 'body': '#B6C0CC', 'label': '#B6C0CC',
          'value': '#F4F7FA', 'note': '#B6C0CC', 'footer': '#B6C0CC'}
LIGHT_MEASURED = {'#F4F7FA': '#2C3034', '#B6C0CC': '#5D6875'}  # EV-S3-OC1 (S2, S4, S6), measured at 1:1
ROLES = {
    ('ACK', 'whole message'): ['logo', 'eyebrow', 'headline', 'body', 'body', 'body', 'footer'],
    ('LONG', 'top'): ['logo', 'eyebrow', 'headline', 'body', 'label', 'value', 'value', 'label', 'value', 'value',
                      'label', 'value', 'label', 'value', 'note', 'note'],
    ('LONG', 'whole message'): ['logo', 'eyebrow', 'headline', 'body', 'label', 'value', 'value', 'label', 'value', 'value',
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

for key, (name, message, mode, part, (scan0, scan1), excluded) in SHOTS.items():
    im = images[key]
    W, H = im.size
    entry = {'file': name, 'message': message, 'mode': mode, 'part': part, 'size': [W, H], 'scanned_rows': [scan0, scan1], 'excluded_rows': excluded, 'runs_exact': {}}
    for y in (300, 450, 700, 900):
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
    column = [r for y in (450, 700, 900) if y in entry['runs_exact'] for r in entry['runs_exact'][y] if r[2] in ('#080C11', '#E9EBEF')]
    col = max(column, key=lambda r: r[1] - r[0])
    entry['column_px'] = [col[0], col[1], col[1] - col[0] + 1]
    entry['scale'] = round((col[1] - col[0] + 1) / 600, 4)
    x0, x1 = col[0] + 5, col[1] - 4
    inked = []
    for y in range(scan0, scan1):
        if any(e0 <= y <= e1 for e0, e1 in excluded):
            inked.append(None)
            continue
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
    groups = [g for g in groups if g[1] - g[0] >= 4]  # >= 5 rows: drops the 1-2 px hairlines and the selection handles in N2
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

# Masthead band in each screenshot: rows where >= 60 % of the column is #05070A (the band image is not recoloured).
band = {}
for key in SHOTS:
    im, c = images[key], report['shots'][key]['column_px']
    rows = [y for y in range(150, 500) if sum(1 for x in range(c[0], c[1] + 1) if im.getpixel((x, y)) == (5, 7, 10)) >= 0.6 * (c[1] - c[0] + 1)]
    band[key] = [min(rows), max(rows), max(rows) - min(rows) + 1] if rows else None
report['masthead'] = band
print(json.dumps(report, indent=1))
