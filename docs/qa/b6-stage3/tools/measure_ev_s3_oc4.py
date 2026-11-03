"""EV-S3-OC4 measurements (r7) — three owner screenshots of Outlook classic received 2026-11-02 (America/Los_Angeles).

usage: python3 -I measure_ev_s3_oc4.py <evidence dir EV-S3-OC4-…> > measurements.json.txt

Measures only what the pixels show (no OCR):
  - the masthead band (pixels within 3 levels of #05070A, which Outlook leaves untouched in images): its box, and the
    layout SCALE = the logo's ink width / 152 (its width at scale 1.0, EV-S3-OC3 §14) — the band WIDTH cannot be
    used when the band is cut off at the right edge;
  - the headline's ink (pixels within 40 levels of #2C3034, the light rendering of #F4F7FA): its left and right ends;
  - the right edge of the visible message area (where the vertical scrollbar's #141414 track starts);
  - a horizontal scrollbar: its thumb (the longest #999999 run) and its track (the #141414 bar less two square arrow
    buttons — approximate); visible fraction = thumb / track; implied layout width = visible width / fraction;
  - the message and canvas colours in the light rendering.
Also writes title-bar crops (derived-title-crops/) so the window title can be checked by eye.
"""
import hashlib, json, os, sys
import numpy as np
from PIL import Image

D = os.path.abspath(sys.argv[1]) + '/'
SHOTS = {  # preserved file, owner's description (cdebfd82 instruction §2), title-bar crop box
    'Z1': ('Z1-88773f01-image.png', 'narrow window, owner-reported Zoom 200 %', (585, 165, 1275, 192)),
    'Z2': ('Z2-a1d58126-image.png', 'maximized window, enlarged rendering', (210, 12, 1255, 38)),
    'Z3': ('Z3-a1b8b6fc-image.png', 'maximized window, normal-size rendering', (210, 12, 1255, 38)),
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


res = {'tool': 'measure_ev_s3_oc4.py', 'method': __doc__.strip().splitlines()[0], 'shots': {}}
for k, (name, desc, crop) in SHOTS.items():
    raw = open(D + 'original-screenshots/' + name, 'rb').read()
    img = Image.open(D + 'original-screenshots/' + name)
    im = np.asarray(img.convert('RGB')).astype(int)
    H, W, _ = im.shape
    img.crop(crop).save(D + f'derived-title-crops/{k}-title.png')
    dark = (np.abs(im - np.array([5, 7, 10])) <= 3).all(2)
    rows = np.where(dark.sum(1) > 200)[0]
    cols = np.where(dark[rows.min():rows.max() + 1].sum(0) > 50)[0]
    band = {'x0': int(cols.min()), 'x1': int(cols.max()), 'y0': int(rows.min()), 'y1': int(rows.max()),
            'width': int(cols.max() - cols.min() + 1), 'height': int(rows.max() - rows.min() + 1)}
    # scale from the logo's ink (light pixels inside the band): 152 px wide at scale 1.0 (EV-S3-OC3 §14) — usable
    # even when the band is cut off at the right edge
    inside = im[band['y0']:band['y1'] + 1, band['x0']:band['x1'] + 1]
    logo = np.where((inside.min(2) > 128).any(0))[0]
    logo_px = int(logo.max() - logo.min() + 1)
    scale = round(logo_px / 152, 3)
    # right edge of the message area: first column right of the band where the vertical scrollbar track starts
    y_mid = (band['y0'] + band['y1']) // 2
    edge = None
    for x in range(band['x1'], W):
        if tuple(im[y_mid, x]) == (20, 20, 20):
            edge = x - 1; break
    # message-area left edge: first canvas-coloured column left of the band on the same row
    left = band['x0']
    while left > 0 and tuple(im[y_mid, left - 1]) in ((236, 238, 240),):
        left -= 1
    # headline ink below the band
    y0, y1 = band['y1'] + 1, min(H, band['y1'] + int(260 * scale))
    ink = (np.abs(im[y0:y1] - np.array([44, 48, 52])).sum(2) < 40)
    ink[:, :band['x0']] = False  # only inside the message column (the window chrome and wallpaper are outside)
    if edge:
        ink[:, edge + 1:] = False
    big = [r for r in range(ink.shape[0]) if ink[r].sum() > 40]
    head = None
    if big:
        # the headline is the tallest ink group: take the group with the most rows
        groups, g = [], [big[0]]
        for r in big[1:]:
            if r - g[-1] <= 3: g.append(r)
            else: groups.append(g); g = [r]
        groups.append(g)
        hg = max(groups, key=len)
        sub = ink[hg[0]:hg[-1] + 1, band['x0']:(edge or W - 1) + 1]
        xs = np.where(sub.any(0))[0] + band['x0']
        head = {'x0': int(xs.min()), 'x1': int(xs.max()), 'y0': int(y0 + hg[0]), 'y1': int(y0 + hg[-1]),
                'css_px_wide': round((xs.max() - xs.min() + 1) / scale, 1)}
    # horizontal scrollbar: the row with the longest #999999 run (the thumb); the dark #141414 bar around it gives
    # the track and the bar thickness; each arrow button is taken as square (side = bar thickness) — approximate
    hbar, best = None, None
    for y in range(H // 2, H):
        rr = [r for r in runs((im[y, :, 0] >= 140) & (im[y, :, 0] <= 160) & (np.abs(im[y, :, 0] - im[y, :, 1]) < 3)) if r[1] - r[0] > 200]
        if rr and (best is None or rr[0][1] - rr[0][0] > best[1][1] - best[1][0]):
            best = (y, rr[0])
    if best:
        y, thumb = best
        bar_rows = [r for r in range(y - 30, y + 30) if (im[r, thumb[0]:thumb[1] + 1] == 20).all(1).mean() > 0.9 or (np.abs(im[r, thumb[0]:thumb[1] + 1, 0] - 153) < 8).mean() > 0.9]
        thick = (max(bar_rows) - min(bar_rows) + 1) if bar_rows else None
        above = min(bar_rows)
        trk = [r for r in runs((im[above, :, 0] == 20) & (im[above, :, 1] == 20)) if r[1] - r[0] > 200]
        hbar = {'row': int(y), 'thumb': [int(thumb[0]), int(thumb[1])], 'thumb_px': int(thumb[1] - thumb[0] + 1), 'bar_thickness_px': thick}
        if trk and thick:
            inner = (trk[0][0] + thick, trk[0][1] - thick)
            hbar.update({'bar': [int(trk[0][0]), int(trk[0][1])], 'track_inner_approx': [int(inner[0]), int(inner[1])],
                         'track_px_approx': int(inner[1] - inner[0] + 1),
                         'visible_fraction_approx': round((thumb[1] - thumb[0] + 1) / (inner[1] - inner[0] + 1), 3),
                         'thumb_at_left_end': bool(thumb[0] - inner[0] <= 2)})
    out = {'file': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'pixels': [W, H],
           'owner_description': desc, 'masthead_band': band, 'layout_scale': scale,
           'band_width_css_px_visible': round(band['width'] / scale, 1),
           'message_area': {'x0': int(left), 'x1': edge, 'width_px': (edge - left + 1) if edge else None,
                            'width_css_px': round((edge - left + 1) / scale, 1) if edge else None},
           'headline_ink': head,
           'headline_fully_visible': (head['x1'] <= edge) if (head and edge) else None,
           'horizontal_scrollbar': hbar,
           'colours': {'message_below_band': '#%02X%02X%02X' % tuple(im[band['y1'] + 40, band['x0'] + 50]),
                       'canvas_left_of_band': '#%02X%02X%02X' % tuple(im[y_mid, max(0, band['x0'] - 3)])}}
    out['logo_ink_px'] = logo_px
    if edge and band['x1'] < edge:  # the band is not cut off: its width gives the scale exactly
        out['layout_scale_from_band_width'] = round(band['width'] / 600, 3)
    if hbar and hbar.get('visible_fraction_approx') and edge:
        out['implied_layout_width_px'] = round((edge - left + 1) / hbar['visible_fraction_approx'])
        out['implied_layout_width_css_px'] = round(out['implied_layout_width_px'] / scale)
    res['shots'][k] = out
print(json.dumps(res, indent=1))
