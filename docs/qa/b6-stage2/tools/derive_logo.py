import hashlib, json, struct, sys
from PIL import Image, ImageChops, ImageStat
import PIL
SRC = '/home/claude/recovery/valida/frontend/public/brand/valida-logo-horizontal-dark.png'
OUT = '/home/claude/recovery/valida/docs/qa/b6-stage2/logo/valida-logo-email-316x72.candidate.png'
src_bytes = open(SRC, 'rb').read()
assert hashlib.sha256(src_bytes).hexdigest() == '920db434d9e20eb99ec8ba417b1e164eb2e72db8e31eb6a8f04f99f814d2dc5e'
im = Image.open(SRC); im.load()
assert im.mode == 'RGB' and im.size == (1009, 230)
out = im.resize((316, 72), resample=Image.Resampling.LANCZOS)   # the ONLY operation
out.save(OUT, format='PNG', optimize=True)                      # lossless; no metadata added
ob = open(OUT, 'rb').read()
def chunks(b):
    i, r = 8, []
    while i < len(b):
        n = struct.unpack('>I', b[i:i+4])[0]; r.append(b[i+4:i+8].decode()); i += 12 + n
    return r
chk = Image.open(OUT); chk.load()
# Fidelity: compare with an independent area-average (BOX) reduction of the same source.
ref = im.resize((316, 72), resample=Image.Resampling.BOX)
diff = ImageChops.difference(chk, ref)
st = ImageStat.Stat(diff)
corners = [chk.getpixel(p) for p in [(0,0),(315,0),(0,71),(315,71)]]
info = {
  'tool': f'Pillow {PIL.__version__}, Python {sys.version.split()[0]}',
  'operation': 'Image.resize((316, 72), Image.Resampling.LANCZOS) on the 8-bit RGB source; saved as PNG (optimize=True). No crop, recolour, sharpen, effect, redraw or margin.',
  'source': {'path': 'frontend/public/brand/valida-logo-horizontal-dark.png', 'sha256': hashlib.sha256(src_bytes).hexdigest(), 'bytes': len(src_bytes), 'size': list(im.size), 'mode': im.mode, 'png_chunks': sorted(set(chunks(src_bytes)))},
  'derived': {'sha256': hashlib.sha256(ob).hexdigest(), 'bytes': len(ob), 'base64_bytes': (len(ob)+2)//3*4, 'size': list(chk.size), 'mode': chk.mode, 'png_chunks': sorted(set(chunks(ob)))},
  'aspect': {'source': round(1009/230, 4), 'derived': round(316/72, 4), 'difference_percent': round(abs(316/72 - 1009/230)/(1009/230)*100, 3), 'scale_x': round(316/1009, 5), 'scale_y': round(72/230, 5)},
  'check_vs_box_reduction': {'mean_abs_diff_per_channel': [round(v, 2) for v in st.mean], 'max_abs_diff_per_channel': [e[1] for e in diff.getextrema()]},
  'corner_pixels': corners,
  'source_extrema': im.getextrema(), 'derived_extrema': chk.getextrema(),
}
json.dump(info, open('/home/claude/recovery/valida/docs/qa/b6-stage2/logo/logo-derivation.json', 'w'), indent=2)
print(json.dumps(info, indent=2))
