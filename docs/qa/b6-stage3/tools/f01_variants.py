"""F-01 / F-04 review variants of the b6-2 HTML — PROPOSED, for review mockups only (not product code).

Shared by make_f01_previews.py (Chromium previews) and make_review_emls.py (offline review EMLs), so both
show exactly the same markup. Every substitution is asserted to match the expected number of times, so a
change in the integrated template makes these tools fail instead of silently producing a different mockup.

  C0  current header, current approved asset (unchanged markup)
  C1  current header markup, image = the approved transparent lockup (shown only to demonstrate the failure)
  C2  masthead band: the whole header row becomes one 600 x 108 image (logo only, no text); the CAREERS
      header label is retired (it is presentational and already absent from the plain-text part)
  C3  logo plate: 206 x 72 image (logo + clear space on the canvas colour), header padding 18 px 40 px,
      so the header keeps its 108 px height; the CAREERS label is unchanged
  P-04  metadata labels and footer #7E8997 -> #B6C0CC; eyebrow #66B3FF -> #83C6FF
"""
import re

CID = 'cid:valida-logo.b6@cybervalida.com'
HEADER = re.compile(r'<tr><td class="v-gutter v-header".*?</td></tr>\n', re.S)
C2_ALT_STYLE = ("display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"
                "font-family:'Inter','Segoe UI',Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;color:#F4F7FA;")


def _sub(html, old, new, count):
    found = html.count(old)
    assert found == count, (old[:60], found, count)
    return html.replace(old, new)


def apply(html, variant, p04, image_src=None):
    """Return the variant HTML. image_src replaces the CID only for browser previews; None keeps the CID."""
    if variant == 'C2':
        src = image_src or CID
        band = ('<tr><td bgcolor="#05070A" style="background-color:#05070A;padding:0;font-size:0;line-height:0;">'
                f'<img src="{src}" width="600" height="108" alt="Valida" style="{C2_ALT_STYLE}">'
                '</td></tr>\n')
        html, n = HEADER.subn(lambda m: band, html, count=1)
        assert n == 1
    elif variant == 'C3':
        html = _sub(html, 'width="158" height="36" alt="Valida" style="display:block;width:158px;height:36px;',
                    'width="206" height="72" alt="Valida" style="display:block;width:206px;height:72px;', 1)
        html = _sub(html, '<td width="158" valign="middle" bgcolor="#05070A" style="background-color:#05070A;padding:0;width:158px;">',
                    '<td width="206" valign="middle" bgcolor="#05070A" style="background-color:#05070A;padding:0;width:206px;">', 1)
        html = _sub(html, 'style="background-color:#05070A;padding:36px 40px;"', 'style="background-color:#05070A;padding:18px 40px;"', 1)
        if image_src:
            html = _sub(html, CID, image_src, 1)
    elif variant in ('C0', 'C1'):
        if image_src:
            html = _sub(html, CID, image_src, 1)
    else:
        raise ValueError(variant)
    if p04:
        labels = html.count('letter-spacing:0.08em;text-transform:uppercase;color:#7E8997')
        html = re.sub(r'(letter-spacing:0\.08em;text-transform:uppercase;color:)#7E8997', r'\1#B6C0CC', html)
        html = _sub(html, 'font-size:13px;line-height:20px;font-weight:400;color:#7E8997', 'font-size:13px;line-height:20px;font-weight:400;color:#B6C0CC', 1)
        html = _sub(html, 'text-transform:uppercase;color:#66B3FF;', 'text-transform:uppercase;color:#83C6FF;', 1)
        assert labels in (0, 4), labels
        assert '#7E8997' not in html and '#66B3FF' not in html
    return html
