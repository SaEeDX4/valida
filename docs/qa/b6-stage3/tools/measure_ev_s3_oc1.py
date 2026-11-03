"""Pixel measurements of the owner's Outlook classic screenshots (EV-S3-OC1). Reads the preserved originals only.

usage: python3 measure_ev_s3_oc1.py <folder with original-screenshots/>

Method (stated in the evidence addendum):
- Backgrounds are taken as the most frequent colour in each measured box.
- Text lines are found row by row inside the 600 px column (x 780-1360; S7 is 3 px narrower and shifted by -3);
  a pixel counts as ink when any channel differs from the box background by more than 24.
- For each line the ink colour reported is the ink pixel with the highest WCAG contrast against that background
  ("peak"), and the 90th percentile of ink-pixel contrast is reported beside it ("p90"). Outlook's text here is
  drawn mostly with solid pixels, so peak and p90 coincide; anti-aliased edge pixels sit below the ink threshold.
- Horizontal colour runs (>= 40 px of one colour, tolerance 6) are listed at four rows (y 300, 650, 700, 950) to locate
  the column and the document's right edge (F-02); at y 650 the runs are also listed with tolerance 0 (>= 30 px). The logo's black field is measured at x 780-1000, y 280-360.
- S3 (a small crop) is located in the full screenshots by exact pixel comparison.
- Sensitivity: each light-rendering ratio is recomputed with every channel moved by one level (text darker/lighter,
  background the opposite way).
"""
import json, os, sys
from collections import Counter
from PIL import Image

base = sys.argv[1]
SHOTS = {
    'S1': 'S1-c83e9689-image.png', 'S2': 'S2-9fcbb9cb-image.png', 'S4': 'S4-e75ba3ba-image.png',
    'S5': 'S5-e052b21d-image.png', 'S6': 'S6-a7ca6229-image.png', 'S7': 'S7-dc2e8650-image.png',
}


def lin(v):
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def lum(c):
    r, g, b = (lin(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def cr(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


hx = lambda c: '#%02X%02X%02X' % c
far = lambda p, q: max(abs(a - b) for a, b in zip(p, q)) > 24
report = {}
for key, name in SHOTS.items():
    im = Image.open(os.path.join(base, 'original-screenshots', name)).convert('RGB')
    W, H = im.size
    dx = -3 if key == 'S7' else 0
    entry = {'file': name, 'size': [W, H], 'runs': {}, 'lines': [], 'header_label': None, 'logo_field': None}
    for y in (300, 650, 700, 950):
        row = [im.getpixel((x, y)) for x in range(W)]
        runs, start = [], 0
        for x in range(1, W + 1):
            if x == W or max(abs(a - b) for a, b in zip(row[x], row[start])) > 6:
                if x - start >= 40:
                    runs.append([start, x - 1, hx(row[start])])
                start = x
        entry['runs'][y] = runs
        if y == 650:  # exact colours (tolerance 0): separates the column #E9EBEF from the canvas #ECEEF0 in light renderings
            exact, start = [], 0
            for x in range(1, W + 1):
                if x == W or row[x] != row[start]:
                    if x - start >= 30:
                        exact.append([start, x - 1, hx(row[start])])
                    start = x
            entry['runs_exact_650'] = exact
    x0, x1 = 780 + dx, 1360 + dx
    inked = []
    for y in range(200, H - 60):
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
    for g0, g1 in groups:
        if g1 - g0 < 3:
            continue
        box = [(x, y) for y in range(g0, g1 + 1) for x in range(x0, x1)]
        px = [im.getpixel(p) for p in box]
        bg = Counter(px).most_common(1)[0][0]
        ink = [p for p in px if far(p, bg)]
        if not ink:
            continue
        contrasts = sorted(cr(p, bg) for p in ink)
        peak = max(ink, key=lambda p: cr(p, bg))
        xs = [x for (x, y), p in zip(box, px) if far(p, bg)]
        entry['lines'].append({'y': [g0, g1], 'x': [min(xs), max(xs)], 'bg': hx(bg), 'peak_ink': hx(peak),
                               'peak_contrast': round(contrasts[-1], 2), 'p90_contrast': round(contrasts[int(len(contrasts) * 0.9)], 2),
                               'ink_pixels': len(ink)})
    box = [(x, y) for y in range(300, 335) for x in range(1250 + dx, 1345 + dx)]
    px = [im.getpixel(p) for p in box]
    bg = Counter(px).most_common(1)[0][0]
    ink = [p for p in px if far(p, bg)]
    peak = max(ink, key=lambda p: cr(p, bg))
    entry['header_label'] = {'bg': hx(bg), 'peak_ink': hx(peak), 'peak_contrast': round(cr(peak, bg), 2)}
    lx = [x for x in range(780 + dx, 1000 + dx) if im.getpixel((x, 320)) == (0, 0, 0)]
    ly = [y for y in range(280, 360) if im.getpixel((850 + dx, y)) == (0, 0, 0)]
    entry['logo_field'] = {'x': [min(lx), max(lx)], 'y': [min(ly), max(ly)], 'w': max(lx) - min(lx) + 1, 'h': max(ly) - min(ly) + 1}
    report[key] = entry
s3 = Image.open(os.path.join(base, 'original-screenshots', 'S3-3a183618-image.png')).convert('RGB')
crop_matches = []
for key in ('S1', 'S2', 'S4', 'S5', 'S6', 'S7'):
    big = Image.open(os.path.join(base, 'original-screenshots', SHOTS[key])).convert('RGB')
    box = (758, 271, 758 + s3.width, 271 + s3.height)
    crop_matches.append([key, list(box), big.crop(box).tobytes() == s3.tobytes()])
report['S3_crop_of'] = crop_matches


def shift(c, d):
    h = c.lstrip('#')
    return tuple(max(0, min(255, int(h[i:i + 2], 16) + d)) for i in (0, 2, 4))


sens = []
for fg, bg in (('#8D97A5', '#E9EBEF'), ('#007CC5', '#E9EBEF'), ('#5D6875', '#E9EBEF'), ('#5D6875', '#ECEEF0'), ('#2C3034', '#E9EBEF')):
    vals = [cr(shift(fg, d), shift(bg, -d)) for d in (-1, 1)]
    sens.append({'fg': fg, 'bg': bg, 'ratio': round(cr(shift(fg, 0), shift(bg, 0)), 3), 'min': round(min(vals), 3), 'max': round(max(vals), 3)})
report['sensitivity_light_pairs'] = sens
print(json.dumps(report, indent=1))
