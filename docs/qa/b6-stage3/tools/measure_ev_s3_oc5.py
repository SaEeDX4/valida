"""EV-S3-OC5 measurements (r8) — the owner's three ORIGINAL 07:12 Outlook classic screenshots of 2026-11-02, received
in the owner's D-6 ZIP (they are not the 07:37–07:38 captures registered as EV-S3-OC4, which stay unchanged).

usage: python3 -I measure_ev_s3_oc5.py <evidence dir EV-S3-OC5-…> > measurements.json.txt

Pixel facts only; no OCR. Two parts:

1. Layout (all three), the EV-S3-OC4 method (measure_ev_s3_oc4.py):
   - masthead band = pixels within 3 levels of #05070A; layout SCALE = the logo's ink width / 152 (its width at 1.0,
     EV-S3-OC3 §14), and = band width / 600 when the band is not cut off;
   - visible message area: from the first canvas-coloured (#ECEEF0) column left of the band to the column before the
     vertical scrollbar's #141414 track;
   - headline ink (within 40 levels of #2C3034): left and right ends, inside the message area only (between the band's
     left edge and the vertical scrollbar, and above any horizontal scrollbar);
   - horizontal scrollbar: thumb = the longest #999999-ish run; track = the #141414 bar less two square arrow buttons
     (approximate); visible fraction = thumb / track; implied layout width = visible width / fraction.
   Title-bar and subject-line crops are written to derived-title-crops/ for checking by eye.

2. Rendered text colours of the normal-size screenshot (151235, scale 1.0), the EV-S3-OC3 method
   (measure_ev_s3_oc3.py): text lines found by rows that differ from the line's background; per line the ink pixel
   with the highest WCAG 2.x contrast ("peak") and the 90th percentile; "exact" when the peak equals the known
   light-rendering colour of the source colour (measured earlier: #F4F7FA -> #2C3034, #B6C0CC -> #5D6875 in EV-S3-OC1,
   #83C6FF -> #006DA5 in EV-S3-OC3).
"""
import hashlib, json, os, sys
from collections import Counter
import numpy as np
from PIL import Image

D = os.path.abspath(sys.argv[1]) + '/'
SHOTS = {  # preserved file, owner's description, title-bar crop, subject-line crop
    'O1': ('image(20261102-151219).png', 'narrow window, owner-reported Zoom 200 %', (615, 210, 1050, 236), (435, 354, 1185, 380)),
    'O2': ('image(20261102-151223).png', 'maximized window, enlarged rendering', (210, 12, 1105, 38), (28, 155, 1275, 182)),
    'O3': ('image(20261102-151235).png', 'maximized window, normal-size rendering', (210, 12, 1105, 38), (28, 155, 1275, 182)),
}
os.makedirs(D + 'derived-title-crops', exist_ok=True)


def runs(mask):
    out, s = [], None
    for x, v in enumerate(mask):
        if v and s is None:
            s = x
        if not v and s is not None:
            out.append((s, x - 1)); s = None
    if s is not None:
        out.append((s, len(mask) - 1))
    return out


def lin(v):
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def lum(c):
    r, g, b = (lin(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def cr(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


hx = lambda c: '#%02X%02X%02X' % tuple(int(v) for v in c)
rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
res = {'tool': 'measure_ev_s3_oc5.py', 'method': 'see the module docstring', 'shots': {}}

for k, (name, desc, tcrop, scrop) in SHOTS.items():
    raw = open(D + 'original-screenshots/' + name, 'rb').read()
    img = Image.open(D + 'original-screenshots/' + name)
    img.crop(tcrop).save(D + f'derived-title-crops/{k}-title-bar.png')
    img.crop(scrop).save(D + f'derived-title-crops/{k}-subject-line.png')
    im = np.asarray(img.convert('RGB')).astype(int)
    H, W, _ = im.shape
    dark = (np.abs(im - np.array([5, 7, 10])) <= 3).all(2)
    rows = np.where(dark.sum(1) > 200)[0]
    cols = np.where(dark[rows.min():rows.max() + 1].sum(0) > 50)[0]
    band = {'x0': int(cols.min()), 'x1': int(cols.max()), 'y0': int(rows.min()), 'y1': int(rows.max()),
            'width': int(cols.max() - cols.min() + 1), 'height': int(rows.max() - rows.min() + 1)}
    inside = im[band['y0']:band['y1'] + 1, band['x0']:band['x1'] + 1]
    logo = np.where((inside.min(2) > 128).any(0))[0]
    logo_px = int(logo.max() - logo.min() + 1)
    scale = round(logo_px / 152, 3)
    y_mid = (band['y0'] + band['y1']) // 2
    edge = next((x - 1 for x in range(band['x1'], W) if tuple(im[y_mid, x]) == (20, 20, 20)), None)
    left = band['x0']
    while left > 0 and tuple(im[y_mid, left - 1]) == (236, 238, 240):
        left -= 1
    hbar, best = None, None
    for y in range(H // 2, H):
        rr = [r for r in runs((im[y, :, 0] >= 140) & (im[y, :, 0] <= 160) & (np.abs(im[y, :, 0] - im[y, :, 1]) < 3)) if r[1] - r[0] > 200]
        if rr and (best is None or rr[0][1] - rr[0][0] > best[1][1] - best[1][0]):
            best = (y, rr[0])
    if best:
        y, thumb = best
        bar_rows = [r for r in range(y - 30, y + 30) if (im[r, thumb[0]:thumb[1] + 1] == 20).all(1).mean() > 0.9 or (np.abs(im[r, thumb[0]:thumb[1] + 1, 0] - 153) < 8).mean() > 0.9]
        thick = (max(bar_rows) - min(bar_rows) + 1) if bar_rows else None
        trk = [r for r in runs((im[min(bar_rows), :, 0] == 20) & (im[min(bar_rows), :, 1] == 20)) if r[1] - r[0] > 200] if bar_rows else []
        hbar = {'row': int(y), 'thumb': [int(thumb[0]), int(thumb[1])], 'thumb_px': int(thumb[1] - thumb[0] + 1), 'bar_thickness_px': thick}
        if trk and thick:
            inner = (trk[0][0] + thick, trk[0][1] - thick)
            hbar.update({'bar': [int(trk[0][0]), int(trk[0][1])], 'track_inner_approx': [int(inner[0]), int(inner[1])],
                         'visible_fraction_approx': round((thumb[1] - thumb[0] + 1) / (inner[1] - inner[0] + 1), 3),
                         'thumb_at_left_end': bool(thumb[0] - inner[0] <= 2)})
    y0, y1 = band['y1'] + 1, min(H, band['y1'] + int(260 * scale))
    if hbar and hbar.get('bar_thickness_px'):  # only above the horizontal scrollbar (the message area)
        y1 = min(y1, hbar['row'] - hbar['bar_thickness_px'])
    ink = (np.abs(im[y0:y1] - np.array([44, 48, 52])).sum(2) < 40)
    ink[:, :band['x0']] = False
    if edge:
        ink[:, edge + 1:] = False
    big = [r for r in range(ink.shape[0]) if ink[r].sum() > 40]
    head = None
    if big:
        groups, g = [], [big[0]]
        for r in big[1:]:
            if r - g[-1] <= 3: g.append(r)
            else: groups.append(g); g = [r]
        groups.append(g)
        hg = max(groups, key=len)
        xs = np.where(ink[hg[0]:hg[-1] + 1].any(0))[0]
        head = {'x0': int(xs.min()), 'x1': int(xs.max()), 'y0': int(y0 + hg[0]), 'y1': int(y0 + hg[-1]),
                'gap_to_area_edge_px': (edge - int(xs.max())) if edge else None}
    out = {'file': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'pixels': [W, H],
           'owner_description': desc, 'masthead_band': band, 'band_cut_at_right_edge': bool(edge and band['x1'] >= edge),
           'logo_ink_px': logo_px, 'layout_scale_from_logo': scale,
           'message_area': {'x0': int(left), 'x1': edge, 'width_px': (edge - left + 1) if edge else None},
           'headline_ink': head, 'horizontal_scrollbar': hbar,
           'colours': {'message_below_band': hx(im[band['y1'] + 40, band['x0'] + 50]), 'canvas_left_of_band': hx(im[y_mid, max(0, band['x0'] - 3)])}}
    if edge and band['x1'] < edge:
        out['layout_scale_from_band_width'] = round(band['width'] / 600, 3)
    if hbar and hbar.get('visible_fraction_approx') and edge:
        out['implied_layout_width_px'] = round((edge - left + 1) / hbar['visible_fraction_approx'])
        out['implied_layout_width_css_px_at_scale_2'] = round(out['implied_layout_width_px'] / 2)
    res['shots'][k] = out

# Part 2 — rendered text colours of O3 (scale 1.0), the EV-S3-OC3 method
SOURCE = {'logo': None, 'eyebrow': '#83C6FF', 'headline': '#F4F7FA', 'body': '#B6C0CC', 'label': '#B6C0CC',
          'value': '#F4F7FA', 'note': '#B6C0CC'}
LIGHT_MEASURED = {'#F4F7FA': '#2C3034', '#B6C0CC': '#5D6875', '#83C6FF': '#006DA5'}
ROLES = ['logo', 'eyebrow', 'headline', 'body', 'label', 'value', 'value', 'label', 'value', 'value',
         'label', 'value', 'label', 'value', 'note', 'note']
far = lambda p, q: max(abs(a - b) for a, b in zip(p, q)) > 24
im = Image.open(D + 'original-screenshots/' + SHOTS['O3'][0]).convert('RGB')
b = res['shots']['O3']['masthead_band']
x0, x1 = b['x0'] + 5, b['x1'] - 4
inked = []
for y in range(280, 1020):
    px = [im.getpixel((x, y)) for x in range(x0, x1)]
    bg = Counter(px).most_common(1)[0][0]
    inked.append(y if any(far(p, bg) for p in px) else None)
groups, cur = [], None
for y in inked:
    if y is None:
        cur = None; continue
    if cur and y == cur[1] + 1:
        cur[1] = y
    else:
        cur = [y, y]; groups.append(cur)
groups = [g for g in groups if g[1] - g[0] >= 4]
assert len(groups) == len(ROLES), (len(groups), len(ROLES))
lines = []
for (g0, g1), role in zip(groups, ROLES):
    box = [(x, y) for y in range(g0, g1 + 1) for x in range(x0, x1)]
    px = [im.getpixel(p) for p in box]
    bg = Counter(px).most_common(1)[0][0]
    ink_px = [p for p in px if far(p, bg)]
    contrasts = sorted(cr(p, bg) for p in ink_px)
    peak = max(ink_px, key=lambda p: cr(p, bg))
    line = {'role': role, 'y': [g0, g1], 'bg': hx(bg), 'peak_ink': hx(peak), 'peak_contrast': round(contrasts[-1], 2),
            'p90_contrast': round(contrasts[int(len(contrasts) * 0.9)], 2), 'ink_pixels': len(ink_px)}
    src = SOURCE[role]
    if src:
        known = LIGHT_MEASURED[src]
        kc = cr(rgb(known), bg)
        line.update({'source': src, 'known_light_ink': known, 'known_ink_contrast': round(kc, 2),
                     'overshoot_pixels': sum(1 for c in contrasts if c > kc + 1e-9),
                     'reliability': 'exact' if hx(peak) == known else 'blended (peak = lower bound)'})
    lines.append(line)
res['O3_text_lines'] = lines
print(json.dumps(res, indent=1))
