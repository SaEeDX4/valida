"""F-01 review mockups — PROPOSED candidate header assets for the B6 email logo (NOT approved, NOT integrated).

usage: python3 make_f01_candidates.py <repo root> <output dir>

Every candidate is built from APPROVED brand files only, by resampling and placing them on a solid
brand colour; the mark itself is never redrawn, recoloured or given effects (brand README rules 1-4).

  C0  current integrated asset (approved 2026-10-27, OD-2026-10-27-01) — copied for comparison only
  C1  the approved transparent lockup alone (valida-logo-horizontal-transparent.png), 316 x 72 —
      shown to demonstrate why it fails on a light background (white lettering)
  C2  masthead band: the whole 600 x 108 CSS-px header row as one image (1200 x 216 px, 2x):
      canvas #05070A + the transparent lockup at 158 x 36 CSS px, 40 px gutter, 36 px top
      (the current position). NO text in the image: a variant with the CAREERS label drawn into the band was
      considered and rejected (spec section 8 "no text is embedded in an image"; on a 390 px phone the label
      would shrink to about 8 px, below the 12 px minimum of section 5). C2 therefore retires the header label.
  C3  logo plate: the transparent lockup on a #05070A plate with clear space
      (206 x 72 CSS px = logo 158 x 36 + 24 px left/right + 18 px top/bottom; 412 x 144 px, 2x),
      corners rounded 8 CSS px and left transparent; the plate's left edge sits on the 40 px content gutter
"""
import hashlib, json, os, sys
from PIL import Image, ImageDraw

root, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
BRAND = os.path.join(root, 'frontend/public/brand')
TRANSPARENT = os.path.join(BRAND, 'valida-logo-horizontal-transparent.png')
CURRENT = os.path.join(root, 'backend/src/integrations/notifications/assets/valida-logo-email-316x72.png')
EXPECT = {
    TRANSPARENT: 'f274e8ba03aa54b710e07ec17fa70e68d568abdfc7b2504c40b49e7ca4393377',
    CURRENT: 'b8c541749d0869f2473cc3344e6de5e8ecea9813bb106feb1fc3531602c8341a',
}
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
for path, digest in EXPECT.items():
    assert sha(path) == digest, path

CANVAS = (0x05, 0x07, 0x0A)
SCALE = 2

src = Image.open(TRANSPARENT)
src.load()
assert src.mode == 'RGBA' and src.size == (1009, 230)
# Resample only (Pillow resamples RGBA with premultiplied alpha, so no dark or light halo is added).
logo = src.resize((158 * SCALE, 36 * SCALE), Image.Resampling.LANCZOS)


def save(img, name, note):
    path = os.path.join(out, name)
    img.save(path, format='PNG', optimize=True)
    return {'file': name, 'note': note, 'size_px': list(img.size), 'mode': img.mode,
            'bytes': os.path.getsize(path), 'base64_bytes': (os.path.getsize(path) + 2) // 3 * 4, 'sha256': sha(path)}


results = []
cur = Image.open(CURRENT)
results.append(save(cur.copy(), 'C0-current-316x72.png', 'current integrated asset, unchanged copy'))
results.append(save(logo.copy(), 'C1-transparent-lockup-316x72.png', 'approved transparent lockup, resampled only'))

# C2 — masthead band (one image for the whole header row; logo only, no text)
band = Image.new('RGB', (600 * SCALE, 108 * SCALE), CANVAS)
band.paste(logo, (40 * SCALE, 36 * SCALE), logo)
results.append(save(band, 'C2-masthead-1200x216.png', 'header row as one image: #05070A + transparent lockup at the current position; no text'))

# C3 — logo plate with clear space and rounded corners (transparent outside the plate)
pw, ph, r = 206 * SCALE, 72 * SCALE, 8 * SCALE
plate = Image.new('RGBA', (pw, ph), (0, 0, 0, 0))
mask = Image.new('L', (pw * 4, ph * 4), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw * 4 - 1, ph * 4 - 1], radius=r * 4, fill=255)
mask = mask.resize((pw, ph), Image.Resampling.LANCZOS)
fill = Image.new('RGBA', (pw, ph), CANVAS + (255,))
plate.paste(fill, (0, 0), mask)
plate.alpha_composite(logo, (24 * SCALE, 18 * SCALE))
results.append(save(plate, 'C3-plate-412x144.png', 'transparent lockup on a #05070A plate, 24/18 px clear space, 8 px radius, transparent corners'))

json.dump({'sources': {os.path.relpath(k, root): v for k, v in EXPECT.items()}, 'pillow': Image.__version__,
           'status': 'PROPOSED review mockups — not approved, not integrated', 'candidates': results},
          open(os.path.join(out, 'candidates.json'), 'w'), indent=2)
print(json.dumps(results, indent=2))
