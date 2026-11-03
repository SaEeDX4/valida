from PIL import Image, ImageDraw, ImageFont
D = '/home/claude/recovery/valida/docs/qa/b6-stage2/logo/'
src = Image.open('/home/claude/recovery/valida/frontend/public/brand/valida-logo-horizontal-dark.png').convert('RGB')
der = Image.open(D + 'valida-logo-email-316x72.candidate.png').convert('RGB')
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
W, pad = 1009 + 80, 40
rows = [
  ('A. SOURCE — official brand file, actual pixels (1009 × 230, sha256 920db434…dc5e)', src),
  ('B. DERIVED CANDIDATE — actual pixels (316 × 72, sha256 b8c54174…341a) — PENDING OWNER APPROVAL', der),
  ('C. DERIVED CANDIDATE enlarged ×3.193 with nearest-neighbour (pixel inspection only; not how it displays)', der.resize((1009, 230), Image.Resampling.NEAREST)),
  ('D. SOURCE reduced to the same 316 × 72 with an area-averaging (BOX) filter — reference only, not delivered', src.resize((316, 72), Image.Resampling.BOX)),
]
H = pad + sum(30 + r[1].height + pad for r in rows) + 60
sheet = Image.new('RGB', (W, H), (18, 22, 28))
d = ImageDraw.Draw(sheet)
d.text((pad, 14), 'Valida email logo — side-by-side comparison (review material)', font=fb, fill=(244, 247, 250))
y = pad + 20
for label, img in rows:
    d.text((pad, y), label, font=f, fill=(182, 192, 204)); y += 30
    sheet.paste(img, (pad, y)); d.rectangle([pad - 1, y - 1, pad + img.width, y + img.height], outline=(60, 68, 78))
    y += img.height + pad
d.text((pad, y - 10), 'Generated with Pillow 12.3.0. The comparison sheet is review material only; it is not the asset.', font=f, fill=(126, 137, 151))
sheet.save(D + 'logo-side-by-side.png', optimize=True)
print(sheet.size)
