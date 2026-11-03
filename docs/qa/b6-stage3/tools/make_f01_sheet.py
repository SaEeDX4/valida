"""One review sheet for F-01 and F-04: owner evidence beside PROPOSED browser mockups.

usage: python3 make_f01_sheet.py <docs/qa/b6-stage3 dir>
The two EVIDENCE rows are 1:1 crops of the owner's Outlook classic screenshots (S2 light, S1 dark; S4 light for
the internal notification). Every other row is a Chromium mockup — NOT Outlook output, NOT email-client evidence.
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

base = sys.argv[1]
P = os.path.join(base, 'proposals/f01-logo/previews/')
E = os.path.join(base, 'evidence/EV-S3-OC1-outlook-classic-offline/original-screenshots/')
OUT = os.path.join(base, 'proposals/f01-logo/F01-F04-review-sheet.png')
head = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Medium.otf', 20)
small = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Regular.otf', 15)
CW, CH = 680, 290  # one cell: the column's top 290 CSS px


def evidence(name, box):
    return Image.open(E + name).convert('RGB').crop(box)


def mobile(left_stem, right_stem):
    # two phone-width mockups (source colours) side by side in one cell row; each shown at 1 CSS px = 1 sheet px
    cells = []
    for stem in (left_stem, right_stem):
        im = Image.open(P + stem).convert('RGB')
        w = im.width // 2
        cell = Image.new('RGB', (CW, CH), (255, 255, 255))
        cell.paste(im.crop((0, 0, w * 2, CH * 2)).resize((w, CH), Image.Resampling.LANCZOS), (0, 0))
        cells.append(cell)
    return cells


def mock(stem, top=0):
    im = Image.open(P + stem).convert('RGB')
    return im.crop((0, top * 2, CW * 2, (top + CH) * 2)).resize((CW, CH), Image.Resampling.LANCZOS)


rows = [
    ('EVIDENCE — Outlook classic (owner screenshots, 1:1): current header', evidence('S2-9fcbb9cb-image.png', (730, 270, 1410, 560)), evidence('S1-c83e9689-image.png', (730, 270, 1410, 560))),
    ('C0 — current asset (approved 2026-10-27) — mockup', mock('acknowledgement-C0-ol-light-680.png'), mock('acknowledgement-C0-source-680.png')),
    ('C1 — approved transparent lockup alone — mockup (fails on light)', mock('acknowledgement-C1-ol-light-680.png'), mock('acknowledgement-C1-source-680.png')),
    ('C2 — masthead band, logo only (header label retired), PROPOSED (recommended) — mockup', mock('acknowledgement-C2-ol-light-680.png'), mock('acknowledgement-C2-source-680.png')),
    ('C3 — logo plate, PROPOSED (alternative) — mockup', mock('acknowledgement-C3-ol-light-680.png'), mock('acknowledgement-C3-source-680.png')),
    ('Phone width 390 px, source colours — left: C2 (logo scales to about 103 x 23), right: C3 (logo stays 158 x 36) — mockup', *mobile('acknowledgement-C2-source-390.png', 'acknowledgement-C3-source-390.png')),
    ('EVIDENCE — Outlook classic (owner screenshots S4 / S5, 1:1): internal metadata, current colours', evidence('S4-e75ba3ba-image.png', (730, 560, 1410, 850)), evidence('S5-e052b21d-image.png', (730, 560, 1410, 850))),
    ('C2 + P-04 (labels #B6C0CC, eyebrow #83C6FF) — mockup; light treatment of #83C6FF is PREDICTED', mock('internal-C2-P04-ol-light-680.png', 270), mock('internal-C2-P04-source-680.png', 270)),
]
W = 40 + CW * 2 + 20
H = 116 + len(rows) * (CH + 60)
sheet = Image.new('RGB', (W, H), (255, 255, 255))
d = ImageDraw.Draw(sheet)
d.text((20, 16), 'F-01 / F-04 review sheet — left: light rendering, right: dark rendering (except the phone-width row)', font=head, fill=(0, 0, 0))
d.text((20, 44), 'EVIDENCE rows: the owner\'s Outlook classic screenshots. All other rows: Chromium mockups with the measured Outlook colour substitution —', font=small, fill=(60, 60, 60))
d.text((20, 64), 'NOT Outlook output, NOT email-client evidence. Candidates C2, C3 and P-04 are PROPOSED, not approved.', font=small, fill=(60, 60, 60))
y = 96
for label, left, right in rows:
    d.text((20, y), label, font=small, fill=(0, 0, 0))
    y += 26
    for i, im in enumerate((left, right)):
        x = 20 + i * (CW + 20)
        sheet.paste(im, (x, y))
        d.rectangle([x - 1, y - 1, x + CW, y + CH], outline=(160, 160, 160))
    y += CH + 34
sheet.save(OUT, optimize=True)
print(OUT, sheet.size)
